import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  ImATeapotException,
  Inject,
  Optional,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UseFilters } from '@nestjs/common';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { LabService } from './lab.service.js';

@Controller('lab')
export class LabController {
  constructor(
    private readonly labService: LabService,
    // 同一个 token 再注一次：验证单例
    private readonly labService2: LabService,
    @Inject('LAB_ALIAS') private readonly aliased: LabService,
    @Inject('LAB_VALUE') private readonly value: unknown,
    @Inject('LAB_FACTORY') private readonly factoryResult: unknown,
    @Inject('LAB_ASYNC') private readonly asyncResult: unknown,
    // 未注册的 token + @Optional()：注入 undefined 而非报错
    @Optional() @Inject('TOTALLY_MISSING') private readonly missing?: unknown,
  ) {}

  // === 06 章异常实验探针 ===

  @Get('boom')
  @UseFilters(HttpExceptionFilter) // 方法级绑定
  boom() {
    // 自定义响应体 + cause（cause 不应序列化进响应）
    throw new HttpException(
      { status: 403, error: '自定义错误体' },
      403,
      { cause: new Error('根因只进日志') },
    );
  }

  @Get('native')
  nativeError() {
    throw new Error('plain error'); // 非 HttpException，默认层应兜底 500
  }

  @Get('teapot')
  teapot() {
    throw new ImATeapotException('short and stout', { errorCode: 'TEAPOT_X' });
  }

  @Get('badreq')
  badReq() {
    throw new BadRequestException('password too weak', { errorCode: 'WEAK_PASSWORD' });
  }

  @Get('raw')
  raw() {
    throw new HttpException('forbidden', 403, { errorCode: 'ACCOUNT_SUSPENDED' });
  }

  @Get()
  probe(@Req() req: Request) {
    // 突变传播：往别名上写，从本体读——验证两者背后是同一个对象
    (this.aliased as unknown as Record<string, unknown>).tag =
      'mutated-via-alias';

    return {
      // 中间件写入的 requestTime 是否到达控制器（05 章验证点）
      middlewareRequestTime:
        (req as unknown as Record<string, unknown>).requestTime ?? null,
      sameTokenTwice: this.labService === this.labService2,
      aliasIsSameInstance: this.labService === this.aliased,
      propagation:
        (this.labService as unknown as Record<string, unknown>).tag ?? null,
      instanceId: this.labService.instanceId,
      value: this.value,
      factoryResult: this.factoryResult,
      asyncResult: this.asyncResult,
      optionalMissingIsUndefined: this.missing === undefined,
    };
  }
}
