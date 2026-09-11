import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from './decorators/current-user.decorator.js';
import { Roles } from './decorators/roles.decorator.js';

// 纵向授权守卫：角色检查（全局 AuthGuard 已把 payload 挂到 req.user）
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true; // 无角色要求 → 登录即可

    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as unknown as Record<string, unknown>).user as
      | JwtPayload
      | undefined;
    return !!user && roles.includes(user.role);
  }
}
