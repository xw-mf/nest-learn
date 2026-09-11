import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../redis/cache.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { AddCommentDto, CreateArticleDto, UpdateArticleDto } from './dto/article.dto.js';
import { Prisma } from '../generated/prisma/client.js';

// 查询参数单独定义（satisfies 保留具体形状）
const articleListQuery = {
  where: { published: true, deletedAt: null },
  orderBy: { createdAt: 'desc' },
  include: { author: { select: { id: true, nickname: true } } },
} satisfies Prisma.ArticleFindManyArgs;

// 从查询推导出列表项类型：字段、关联、可空性全自动
type ArticleListItem = Prisma.ArticleGetPayload<typeof articleListQuery>;


@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
  ) {}

  private readonly LIST_VERSION_KEY = 'articles:list:version';

  private async getArticleListCacheKey() {
    return (await this.cache.getJson<number>(this.LIST_VERSION_KEY)) ?? 0;
  }

  private async getArticleListCache() {
    return this.cache.getJson<ArticleListItem[]>(`articles:list:${await this.getArticleListCacheKey()}`);
  }

  private async setArticleListCache(data: ArticleListItem[]) {
    return this.cache.setJson(`articles:list:${await this.getArticleListCacheKey()}`, data, 60);
  }

  // 发文章（带标签）：嵌套写入在 Prisma 里天然是一个事务——全成功或全回滚
  async create(dto: CreateArticleDto, authorId: number) {
    const { tags, ...articleData } = dto;
    return this.prisma.article.create({
      data: {
        ...articleData,
        authorId,
        tags: {
          // 标签存在就连上，不存在就顺手建（connectOrCreate）
          connectOrCreate: (tags ?? []).map((name) => ({
            where: { name },
            create: { name },
          })),
        },
      },
      include: { author: { select: { id: true, nickname: true } }, tags: true },
    }).then(async (article) => {
      await this.cache.client.incr(this.LIST_VERSION_KEY);
      return article;
    });
  }

  // N+1 对照：逐条查作者（N 篇文章 = 1 + N 次查询）
  async listN1Naive() {
    const articles = await this.prisma.article.findMany({ where: { deletedAt: null } });
    const withAuthors = [];
    for (const a of articles) {
      const author = await this.prisma.user.findUnique({ where: { id: a.authorId } });
      withAuthors.push({ ...a, author });
    }
    return withAuthors;
  }

  // include 版：Prisma 批量解决（1 + 关系数次查询，与 N 无关）
  listN1Include() {
    return this.prisma.article.findMany({
      where: { deletedAt: null },
      include: { author: true },
    });
  }

  // 浏览量 +1 的原子版（并发安全）：SET viewCount = viewCount + 1
  viewAtomic(id: number) {
    return this.prisma.article.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
  }

  // 浏览量 +1 的朴素版（先读后写，并发下丢更新——教学对照用，勿用于生产）
  async viewNaive(id: number) {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException('文章不存在');
    return this.prisma.article.update({
      where: { id },
      data: { viewCount: article.viewCount + 1 },
    });
  }

  // 公开列表：已发布 + 未删除
  async findAll() {
    const cached = await this.getArticleListCache();
    if (cached) {
      console.log(`[Cache] HIT ${await this.getArticleListCacheKey()}`);
      return cached;
    }

    console.log(`[Cache] MISS ${await this.getArticleListCacheKey()}，回源数据库`);
    const data = await this.prisma.article.findMany({
      where: { published: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, nickname: true } } },
    });
    await this.setArticleListCache(data);
    console.log(`[Cache] SET ${await this.getArticleListCacheKey()}`);
    return data;
  }

  // 文章详情：Cache-Aside + 互斥重建（防击穿）
  async findOne(id: number, userId: number) {
    // ① 取数据：缓存逻辑整体收进私有方法（四个分支都在里面）
    const article = await this.getArticleDetail(id);
    // ② 后处理：单一出口，只做一次
    // 查询文章的收藏状态
    const favorited = userId ? !!(await this.prisma.favorite.findUnique({
      where: {
        articleId_userId: {
          articleId: id,
          userId
        }
      }
    })) : false
    return { ...article, favorited };
  }

  private async getArticleDetail(id: number) {
    const key = `article:detail:${id}`;
    type Detail = Awaited<ReturnType<typeof this.queryFromDb>>;

    const cached = await this.cache.getJson<NonNullable<Detail>>(key);
    if (cached && 'isNull' in cached) {
      throw new NotFoundException('文章不存在'); // 空值哨兵（防穿透）
    }
    if (cached) {
      console.log(`[Cache] HIT ${key}`);
      return cached;
    }

    // MISS → 抢锁重建：SET lockKey 1 EX 5 NX（抢到='OK'，没抢到=null）
    const lockKey = `article:lock:${id}`;
    const gotLock = await this.cache.client.set(lockKey, '1', 'EX', 5, 'NX');

    if (gotLock === 'OK') {
      try {
        // 双检：等锁期间可能已被别的请求重建好
        const recheck = await this.cache.getJson<NonNullable<Detail>>(key);
        if (recheck && 'isNull' in recheck) throw new NotFoundException('文章不存在');
        if (recheck) {
          console.log(`[Cache] HIT after lock ${key}（双检命中）`);
          return recheck;
        }

        console.log(`[Cache] MISS ${key}，持锁回源`);
        const article = await this.queryFromDb(id);
        if (!article) {
          await this.cache.setNull(key);
          throw new NotFoundException('文章不存在');
        }
        await this.cache.setJson(key, article, 60);
        return article;
      } finally {
        await this.cache.del(lockKey); // 必须释放（异常也要放）
      }
    }

    // 没抢到锁：等持有者重建（100ms 后重读）
    await new Promise((r) => setTimeout(r, 100));
    const retry = await this.cache.getJson<NonNullable<Detail>>(key);
    if (retry && 'isNull' in retry) throw new NotFoundException('文章不存在');
    if (retry) {
      console.log(`[Cache] HIT after wait ${key}`);
      return retry;
    }

    // 兜底：持有者异常没建成 → 自己回源（防锁崩死循环）
    console.log(`[Cache] 等待超时，兜底回源 ${key}`);
    const article = await this.queryFromDb(id);
    if (!article) {
      await this.cache.setNull(key);
      throw new NotFoundException('文章不存在');
    }
    await this.cache.setJson(key, article, 60);
    return article
  }

  private queryFromDb(id: number) {
    return this.prisma.article.findFirst({
      where: { id, deletedAt: null },
      include: { author: { select: { id: true, nickname: true } }, tags: true },
    });
  }

  // 更新文章（含标签全量替换）：交互式事务——先清空旧标签，再挂新标签
  // 任一步失败 → 整体回滚，不会出现"标签清了但没挂上"的中间态
  async update(id: number, dto: UpdateArticleDto) {
    const { tags, ...data } = dto;
    return this.prisma
      .$transaction(async (tx) => {
        if (tags) {
          await tx.article.update({
            where: { id },
            data: { tags: { set: [] } }, // 先断开所有旧标签
          });
        }
        return tx.article.update({
          where: { id },
          data: {
            ...data,
            ...(tags && {
              tags: {
                connectOrCreate: tags.map((name) => ({
                  where: { name },
                  create: { name },
                })),
              },
            }),
          },
          include: { tags: true },
        });
      })
      .then(async (article) => {
        await this.cache.client.incr(this.LIST_VERSION_KEY);
        await this.cache.del(`article:detail:${id}`); // 更库后删缓存（先库后缓存）
        return article;
      });
  }

  // 软删除：标记而非物理删除（P1 的设计在此落地）
  async remove(id: number) {
    return this.prisma.article
      .update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      .then(async (article) => {
        await this.cache.client.incr(this.LIST_VERSION_KEY);
        await this.cache.del(`article:detail:${id}`);
        return article;
      });
  }

  async addComment(articleId: number, dto: AddCommentDto, authorId: number) {
    // return this.prisma.comment.create({
    //   data: { ...dto, articleId, authorId },
    // });
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { ...dto, articleId, authorId },
      });
      await tx.article.update({ where: { id: articleId }, data: { commentCount: { increment: 1 } } });
      return comment;
    }).then(async (comment) => {
      await this.notifyQueue.add('send-comment-notification', { articleId, commentId: comment.id });
      return comment;
    });
  }

  removeComment(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.delete({ where: { id } });
      await tx.article.update({ where: { id: comment.articleId }, data: { commentCount: { decrement: 1 } } });
      return comment;
    });
  }

  // 点赞：upsert 保证幂等——重复调用不产生重复数据（双击/重试/并发都安全）
  async like(articleId: number, userId: number) {
    await this.prisma.like.upsert({
      where: { articleId_userId: { articleId, userId } }, // @@unique([articleId, userId])
      create: { articleId, userId },
      update: {}, // 已赞过 → 什么都不做，照样返回成功
    });
    return { liked: true };
  }

  // 取消点赞：deleteMany 天然幂等——不存在也不报错
  async unlike(articleId: number, userId: number) {
    await this.prisma.like.deleteMany({
      where: { articleId, userId },
    });
    return { liked: false };
  }

  async favorite(articleId: number, userId: number) {
    await this.prisma.favorite.upsert({
      where: {
        articleId_userId: {
          articleId,
          userId
        }
      },
      create: {
        articleId,
        userId
      },
      update: {}
    })
    return { favorited: true };
  }

  async unfavorite(articleId: number, userId: number) {
    await this.prisma.favorite.deleteMany({
      where: {
        articleId,
        userId
      }
    })
    return { favorited: false };
  }

  findMyArticles(authorId: number) {
    // 登录后看自己的全部文章，含草稿
    return this.prisma.article.findMany({
      where: {
        authorId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, nickname: true } },
        tags: true,
      },
    });
  }

  async publish(id: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.article.update({ where: { id }, data: { published: true } });
      // throw new Error('模拟第二步失败'); // 不 catch：异常穿透出回调 → Prisma 回滚
      return await tx.publishLog.create({ data: { articleId: id } });
    }).then(async (log) => {
      // 事务已提交 → 投递异步任务（发通知是慢操作，不阻塞响应）
      await this.notifyQueue.add('send-publish-notification', { articleId: id });
      return log;
    });
  }
}
