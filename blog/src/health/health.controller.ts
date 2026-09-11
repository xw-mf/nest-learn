import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../redis/cache.service.js';

// 健康检查：负载均衡器/编排系统靠它判断实例是否可接管流量
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Public() // 健康检查必须免登录（LB 没有 token）
  @Get()
  async check() {
    const checks: Record<string, 'up' | 'down'> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
    }

    try {
      await this.cache.client.ping();
      checks.redis = 'up';
    } catch {
      checks.redis = 'down';
    }

    const allUp = Object.values(checks).every((s) => s === 'up');
    return { status: allUp ? 'ok' : 'degraded', ...checks };
  }
}
