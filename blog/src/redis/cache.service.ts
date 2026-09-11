import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

// 空值哨兵：防缓存穿透（详见 P5 文档）
const NULL_SENTINEL = '__NULL__';

@Injectable()
export class CacheService implements OnModuleDestroy {
  readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  /**
   * 读缓存：返回值有三种状态
   * - 有数据 → 对象
   * - 空值哨兵 → { isNull: true }（之前查过、库里没有）
   * - 缓存不存在 → null（需要回源）
   */
  async getJson<T>(key: string): Promise<T | { isNull: true } | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    if (raw === NULL_SENTINEL) return { isNull: true };
    return JSON.parse(raw) as T;
  }

  /** 写缓存：TTL 加随机抖动，防缓存雪崩（大量 key 同时过期） */
  async setJson(key: string, value: unknown, ttlSeconds: number) {
    const jitter = Math.floor(Math.random() * 30); // 0~30s 随机抖动
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds + jitter);
  }

  /** 写空值哨兵（短 TTL）：防缓存穿透 */
  async setNull(key: string, ttlSeconds = 30) {
    await this.client.set(key, NULL_SENTINEL, 'EX', ttlSeconds);
  }

  /** 删除缓存：数据变更时调用（保证一致性） */
  async del(key: string) {
    await this.client.del(key);
  }

  onModuleDestroy() {
    this.client.quit();
  }
}
