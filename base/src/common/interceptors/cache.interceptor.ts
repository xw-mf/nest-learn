import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';

// 缓存拦截器原型：命中缓存时根本不调用 handle()，处理器不会执行
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    void context;
    const isCached = true;
    if (isCached) {
      console.log('[CacheInterceptor] 命中缓存，handler 不会执行');
      return of(['from-cache']);
    }
    return next.handle();
  }
}
