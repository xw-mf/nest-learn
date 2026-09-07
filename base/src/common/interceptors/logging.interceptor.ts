import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    console.log(`[LoggingInterceptor] Before ${req.method} ${req.url}`);
    const now = Date.now();
    return next
      .handle()
      .pipe(
        tap(() =>
          console.log(`[LoggingInterceptor] After... ${Date.now() - now}ms`),
        ),
      );
  }
}
