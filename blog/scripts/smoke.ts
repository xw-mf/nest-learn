// P1 冒烟测试：验证 Prisma Client + 驱动适配器 + 数据库链路
// 运行：node --experimental-strip-types scripts/smoke.ts（Node 22.18+ 原生跑 TS）
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// 创建：用户 + 文章 + 标签（级联写入）
const user = await prisma.user.create({
  data: {
    email: 'wei@example.com',
    password: 'not-a-real-hash-yet',
    nickname: '伟哥',
    articles: {
      create: {
        title: '第一篇文章',
        content: 'Hello Nest + Prisma',
        published: true,
        tags: {
          create: [{ name: 'nestjs' }, { name: 'backend' }],
        },
      },
    },
  },
  include: { articles: { include: { tags: true } } },
});
console.log('创建的用户:', JSON.stringify(user, null, 2));

// 查询：已发布文章列表（走 @@index([published, createdAt])）
const articles = await prisma.article.findMany({
  where: { published: true },
  orderBy: { createdAt: 'desc' },
  include: { author: { select: { nickname: true } }, tags: true },
});
console.log('已发布文章数:', articles.length);

await prisma.$disconnect();
