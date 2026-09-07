import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

export interface UnifiedResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 统一成功响应格式（和 06 章过滤器的错误格式对应）
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, UnifiedResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<UnifiedResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: 'ok',
        data,
      })),
    );
  }
}
