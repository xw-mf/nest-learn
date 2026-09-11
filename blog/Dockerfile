# 多阶段构建：builder 编译，runner 只留运行必需
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# CI 纪律：generate 显式跑（生成物不进 git）
RUN npx prisma generate && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
# 迁移文件 + 配置 + 生成的客户端（运行迁移和运行时要）
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma7.config.ts ./
COPY --from=builder /app/src/generated ./src/generated
EXPOSE 3000
# 启动前先应用迁移（生产用 migrate deploy，不生成新迁移）
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
