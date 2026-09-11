import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ArticlesModule } from './articles/articles.module.js';
import { RedisModule } from './redis/redis.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    UsersModule,
    AuthModule,
    ArticlesModule,
    QueuesModule,
    HealthModule,
    // 全局限流：默认 60 秒 60 次（宽松兜底）
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局 ip 限流
    // {
    //   provide: APP_GUARD,
    //   useClass: ThrottlerGuard
    // },
  ],
})
export class AppModule {}
