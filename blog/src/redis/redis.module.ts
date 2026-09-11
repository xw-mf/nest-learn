import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';

@Global() // 缓存是全应用基础设施（和 Prisma 同级）
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class RedisModule {}
