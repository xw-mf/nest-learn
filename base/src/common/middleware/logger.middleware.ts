import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { LabService } from '../../lab/lab.service.js';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  // 验证点：类中间件能否 DI（LabModule 是 @Global，LabService 全局可注入）
  constructor(private readonly labService: LabService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // 验证点：中间件修改 req，控制器能否读到
    (req as unknown as Record<string, unknown>).requestTime = Date.now();
    console.log(
      `[LoggerMiddleware] ${req.method} ${req.baseUrl}${req.path} | LabService实例: ${this.labService.instanceId}`,
    );
    next();
  }
}
