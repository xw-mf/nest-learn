import type { NextFunction, Request, Response } from 'express';

/**
 * 计时中间件
 * - 耗时计算：'finish' 事件（响应完全发出）—— 只适合打日志/上报指标
 * - 写响应头：拦截 writeHead（头即将发出的最后一刻）—— 此时头还没发，可以写
 */
export function costTimeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = Date.now();

  // writeHead 是 Node 底层真正"写响应头"的方法；包一层，抢在头发出前注入耗时头
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
    res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
    return originalWriteHead(...args);
  }) as typeof res.writeHead;

  // finish 里只做"发完之后才能做"的事：日志、指标
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} cost time: ${duration}ms`);
  });

  next();
}
