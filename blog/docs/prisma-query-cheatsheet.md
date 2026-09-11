# Prisma 查询速查：SQL ↔ Prisma 对照表

> 面向有 SQL 直觉但不熟 Prisma DSL 的学习者。
> 核心心智：**SQL 的关键字 → Prisma 的对象属性**；嵌套对象 ≈ SQL 的子查询/JOIN。
> 项目中的 client：`PrismaService`（继承生成的 PrismaClient），模型访问是 `prisma.article` 这种小写开头。

---

## 1. 基础 CRUD

| SQL | Prisma |
|---|---|
| `SELECT * FROM "Article"` | `prisma.article.findMany()` |
| `SELECT * FROM "Article" WHERE id = 1` | `prisma.article.findUnique({ where: { id: 1 } })` |
| `SELECT ... WHERE title = 'x' LIMIT 1` | `prisma.article.findFirst({ where: { title: 'x' } })` |
| `INSERT INTO ...` | `prisma.article.create({ data: {...} })` |
| `UPDATE ... WHERE id = 1` | `prisma.article.update({ where: { id: 1 }, data: {...} })` |
| `DELETE FROM ... WHERE id = 1` | `prisma.article.delete({ where: { id: 1 } })` |
| `UPDATE ... WHERE published = false`（多行） | `prisma.article.updateMany({ where: {...}, data: {...} })` |
| 有则改、无则增 | `prisma.tag.upsert({ where: { name }, create: {...}, update: {...} })` |

> `findUnique` 的 `where` 只能用**唯一字段**（id / @unique）；非唯一字段用 `findFirst` / `findMany`。

---

## 2. WHERE 条件（最常用的部分）

| SQL | Prisma |
|---|---|
| `= 'x'` | `{ title: 'x' }`（直接写值就是等于） |
| `!= 'x'` | `{ title: { not: 'x' } }` |
| `> 10` / `>= 10` | `{ viewCount: { gt: 10 } }` / `{ gte: 10 }` |
| `< 10` / `<= 10` | `{ lt: 10 }` / `{ lte: 10 }` |
| `IN (1,2,3)` | `{ id: { in: [1, 2, 3] } }` |
| `NOT IN (...)` | `{ id: { notIn: [1, 2, 3] } }` |
| `LIKE '%nestjs%'` | `{ title: { contains: 'nestjs' } }` |
| `LIKE 'nestjs%'` / `'%nestjs'` | `{ startsWith: 'nestjs' }` / `{ endsWith: 'nestjs' }` |
| `ILIKE`（忽略大小写） | `{ contains: 'x', mode: 'insensitive' }` |
| `IS NULL` / `IS NOT NULL` | `{ deletedAt: null }` / `{ deletedAt: { not: null } }` |

**多条件 = 逻辑运算**：

```typescript
// WHERE a AND b：直接并列写在一个对象里
where: { published: true, deletedAt: null }

// WHERE a OR b
where: { OR: [{ title: { contains: 'A' } }, { title: { contains: 'B' } }] }

// WHERE NOT (...)
where: { NOT: { published: false } }

// 嵌套组合：已发布 AND (标题含A OR 标题含B)
where: {
  published: true,
  OR: [{ title: { contains: 'A' } }, { title: { contains: 'B' } }],
}
```

---

## 3. 关系过滤（SQL 里要写 JOIN 的）

```typescript
// 查"作者叫伟哥"的文章（SQL: JOIN User ON ... WHERE nickname = '伟哥'）
prisma.article.findMany({
  where: { author: { nickname: '伟哥' } },
});

// 查"带有 nestjs 标签"的文章（N:M，SQL: 两次 JOIN）
prisma.article.findMany({
  where: { tags: { some: { name: 'nestjs' } } },   // some = 至少一个匹配
});

// 三个关系量词：
// some  = 至少一个满足（最常用）
// every = 全部都满足
// none  = 一个都不满足（如：没有评论的文章 { comments: { none: {} } }）
```

---

## 4. 排序与分页

| SQL | Prisma |
|---|---|
| `ORDER BY created_at DESC` | `orderBy: { createdAt: 'desc' }` |
| 多字段排序 | `orderBy: [{ published: 'desc' }, { createdAt: 'desc' }]` |
| `LIMIT 10 OFFSET 20` | `take: 10, skip: 20`（页码分页） |
| 游标分页（无限滚动） | `take: 10, cursor: { id: 100 }, skip: 1` |

```typescript
// 典型分页查询（P4 会用）
prisma.article.findMany({
  where: { published: true, deletedAt: null },
  orderBy: { createdAt: 'desc' },
  take: pageSize,
  skip: (page - 1) * pageSize,
});
// 配合 prisma.article.count({ where }) 拿总数算 totalPages
```

---

## 5. 字段裁剪与关联加载（select vs include）

```typescript
// include：全字段 + 额外加载关联（SQL 里没有直接对应，≈ JOIN 后拼对象）
prisma.article.findMany({
  include: {
    author: { select: { id: true, nickname: true } }, // 关联内部还能再裁
    tags: true,
  },
});

// select：只要指定的列（SQL: SELECT title, viewCount）
prisma.article.findMany({
  select: { id: true, title: true, viewCount: true },
});

// 统计关联数量（SQL: COUNT 子查询）
prisma.article.findMany({
  include: { _count: { select: { comments: true } } },
});
// 结果里每条有 _count.comments
```

> ⚠️ `select` 和 `include` 同一层级**只能二选一**，但各自内部可以无限嵌套。

---

## 6. 写入时的关联操作（SQL 里要拆好几条语句的）

```typescript
// 建文章同时挂上已有标签（SQL: INSERT 文章 + INSERT 中间表）
prisma.article.create({
  data: {
    title: 'x',
    authorId: 1,
    tags: { connect: [{ id: 1 }, { id: 2 }] },     // 关联已存在的
  },
});

// 建文章同时新建标签（级联写入）
prisma.article.create({
  data: {
    title: 'x',
    authorId: 1,
    tags: { create: [{ name: '新标签' }] },          // 顺带创建
  },
});

// 更新文章：换掉标签（先断开旧的，再连新的）
prisma.article.update({
  where: { id: 1 },
  data: { tags: { set: [{ id: 3 }] } },            // set = 全量替换
  // 还有 disconnect / connect / deleteMany 等操作符
});

// 计数器自增（SQL: SET viewCount = viewCount + 1）
prisma.article.update({
  where: { id: 1 },
  data: { viewCount: { increment: 1 } },           // 原子操作！并发安全
});
```

---

## 7. 聚合与分组

```typescript
// SELECT COUNT(*), AVG(viewCount) FROM "Article"
prisma.article.aggregate({
  _count: true,
  _avg: { viewCount: true },
  _max: { viewCount: true },
});

// GROUP BY
prisma.article.groupBy({
  by: ['authorId'],
  _count: true,
  having: { authorId: { in: [1, 2] } },
});
```

---

## 8. 事务（P4 详讲，先混个脸熟）

```typescript
// 批量事务：全成功或全回滚
await prisma.$transaction([
  prisma.article.create({ data: {...} }),
  prisma.tag.update({ where: {...}, data: {...} }),
]);

// 交互式事务：中间可以判断逻辑
await prisma.$transaction(async (tx) => {
  const article = await tx.article.update({...});
  await tx.tag.create({ data: {...} });
  // throw 就整体回滚
});
```

---

## 9. 兜底：原生 SQL

```typescript
// 实在写不出来的复杂查询
const rows = await prisma.$queryRaw`
  SELECT * FROM "Article" WHERE "viewCount" > ${minViews}
`;
// 注意用模板参数传值（自动防注入），不要字符串拼接
```

---

## 10. 类型工程：DTO vs Entity，出参类型用 `GetPayload` 推导

**核心原则：入参类型（DTO）和出参类型（Entity/Payload）是两种东西，永远不要混用。**

同一个"文章"，两个方向是两个形状：

| | CreateArticleDto（入参） | ArticleListItem（出参） |
|---|---|---|
| 用途 | 客户端 → 服务端（校验） | 服务端 → 客户端（响应/缓存） |
| tags | `string[]`（标签名） | `Tag[]`（完整对象） |
| id / createdAt / viewCount / author | 没有 | 有 |

混用的后果：类型标错 → TS 要么放跑脏数据、要么报一堆看不懂的错。

**出参类型不要手写，用 `Prisma.XxxGetPayload` 从查询推导**——查询即类型的单一事实来源：

```typescript
import { Prisma } from '../generated/prisma/client.js';

// 查询参数单独定义（satisfies 保留具体形状，不宽化成泛型参数）
const articleListQuery = {
  where: { published: true, deletedAt: null },
  orderBy: { createdAt: 'desc' },
  include: { author: { select: { id: true, nickname: true } } },
} satisfies Prisma.ArticleFindManyArgs;

// 从查询推导：字段、关联、可空性全自动
type ArticleListItem = Prisma.ArticleGetPayload<typeof articleListQuery>;
// 等价于 Article & { author: { id: number; nickname: string } }

// 用法：查询和类型共享同一份定义，改查询类型自动跟随
const list = await prisma.article.findMany(articleListQuery); // ArticleListItem[]
```

**为什么这是关键习惯**：

1. **改查询不用改类型**——include 加了 tags，返回类型自动多 tags，不存在两边漂移；
2. **可空性正确**——`findUnique` 推导出的类型自带 `| null`，编译器逼你处理"查不到"的情况；
3. **缓存/响应/DTO 转换的类型都有出处**——比如 P5 的列表缓存类型就该是 `ArticleListItem[]`，而不是 `any` 或错误的 DTO。

> 入参侧的对偶原则：DTO 用 class + class-validator（07 章），因为它是"运行时校验"的载体；出参侧没有校验需求，纯类型推导即可。

---

## 记忆锚点

| SQL 思维 | Prisma 思维 |
|---|---|
| 关键字（WHERE/ORDER BY） | 对象属性（where/orderBy） |
| 表达式（a = 1 AND b > 2） | 嵌套对象（{ a: 1, b: { gt: 2 } }） |
| JOIN | where 里的关系过滤 + include/select 加载 |
| 子查询 | some/every/none 量词 |
| 存储过程/多语句 | $transaction / 级联写入 |

练手建议：把 `ArticlesService` 里每个方法都想想对应的 SQL 是什么，写不出来的查这张表。
