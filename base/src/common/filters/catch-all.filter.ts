import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { LabService } from '../../lab/lab.service.js';

// HttpException 的详细信息在 getResponse() 里，不在 message 上
function extractMessage(exception: unknown): unknown {
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      return (body as { message: unknown }).message;
    }
    return typeof body === 'string' ? body : exception.message;
  }
  return exception instanceof Error ? exception.message : 'unknown';
}

@Catch() // 无参数：捕获一切异常
export class CatchAllFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    // 验证点：通过 APP_FILTER 注册的全局过滤器支持 DI
    private readonly labService: LabService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    
    const req = ctx.getRequest<Request>();
    const traceId = (req as unknown as Record<string, unknown>).traceId ?? null;

    httpAdapter.reply(
      ctx.getResponse(),
      {
        code: status,
        message: extractMessage(exception),
        timestamp: new Date().toISOString(),
        from: `CatchAllFilter(lab:${this.labService.instanceId})`,
        errorCode: exception instanceof HttpException ? exception.errorCode : null,
        traceId,
        data: null
      },
      status,
    );
  }
}
