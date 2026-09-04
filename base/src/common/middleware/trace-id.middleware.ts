import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const traceId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', traceId);
  (req as unknown as Record<string, unknown>).traceId = traceId;
  next();
}