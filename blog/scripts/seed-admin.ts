// 创建管理员账号（管理员不走公开注册，脚本写入——P2 练习 3 的落地）
// 运行：npx tsx scripts/seed-admin.ts
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const email = 'admin@blog.dev';
const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log('管理员已存在，跳过');
} else {
  const admin = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash('admin123456', 10),
      nickname: '管理员',
      role: 'ADMIN',
    },
  });
  console.log('管理员已创建:', admin.email, admin.role);
}
await prisma.$disconnect();
