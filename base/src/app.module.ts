import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createObserveModule } from '@nestjs/observe';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { CatchAllFilter } from './common/filters/catch-all.filter.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CatsModule } from './cats/cats.module.js';
import { LabModule } from './lab/lab.module.js';
import { ConsumerModule } from './consumer/consumer.module.js';
import { LoggerMiddleware } from './common/middleware/logger.middleware.js';
import { traceMiddleware } from './common/middleware/trace.middleware.js';
import { costTimeMiddleware } from './common/middleware/costtime.middleware.js';
import { traceIdMiddleware } from './common/middleware/trace-id.middleware.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';

// 实验用：会抛 401 的认证中间件（验证中间件异常被异常层捕获）
function authProbeMiddleware(req: Request, res: Response, next: NextFunction) {
  void res; // Express 中间件签名要求保留
  if (!req.headers.authorization) {
    throw new UnauthorizedException('middleware 抛出的 401');
  }
  next();
}

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'base',
    }),
    LabModule,
    ConsumerModule,
    CatsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局过滤器（APP_FILTER 方式：支持 DI）
    { provide: APP_FILTER, useClass: CatchAllFilter },
    // 全局校验管道（实验C：whitelist 剥离多余字段 + transform 类型转换）
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(traceIdMiddleware).forRoutes('*');
    
    consumer
      .apply(LoggerMiddleware, traceMiddleware) // 多中间件：验证执行顺序
      .exclude({ path: 'lab', method: RequestMethod.GET })
      .forRoutes('lab'); // 路径范围：只作用于 /lab，验证全局前缀是否影响匹配
    
    consumer.apply(costTimeMiddleware).forRoutes('cats');

    consumer.apply(authProbeMiddleware).forRoutes('consumer/env');
  }
}
