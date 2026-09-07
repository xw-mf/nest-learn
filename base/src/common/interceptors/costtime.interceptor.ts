import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';

@Injectable()
export class CostTimeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const start = Date.now();
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        res.setHeader('X-Response-Time', `${duration}ms`);
      }),
    );
  }
}