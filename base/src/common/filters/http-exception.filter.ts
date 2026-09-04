import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    res.status(exception.getStatus()).json({
      code: exception.getStatus(),
      message: exception.message,
      path: req.url,
      timestamp: new Date().toISOString(),
      from: 'HttpExceptionFilter',
    });
  }
}
