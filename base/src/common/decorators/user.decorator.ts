import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FakeUser } from '../guards/auth.guard.js';

// @User()      → 整个 user 对象（AuthGuard 挂在 req 上的）
// @User('name') → user.name（传 key 取单个属性）
export const User = createParamDecorator(
  (data: keyof FakeUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = (req as unknown as Record<string, unknown>).user as
      | FakeUser
      | undefined;
    return data ? user?.[data] : user;
  },
);
