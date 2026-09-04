import type { NextFunction, Request, Response } from 'express';

// 函数式中间件：无依赖时的简化写法
export function traceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader('X-Trace', 'functional-mw');
  console.log('[traceMiddleware] 函数式中间件执行');
  next();
}
