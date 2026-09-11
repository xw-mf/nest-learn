import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// JWT payload 的形状（AuthGuard 验签后挂在 req.user 上）
export interface JwtPayload {
  sub: number; // user id，JWT 标准字段
  email: string;
  role: 'USER' | 'ADMIN';
}

// @CurrentUser() 直接拿当前登录用户（10 章参数装饰器的实战应用）
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = (req as { user?: JwtPayload }).user;
    return data ? user?.[data] : user;
  },
);
