import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Roles } from '../decorators/roles.decorator.js';
import { Public } from '../decorators/roles.decorator.js';
import type { FakeUser } from './auth.guard.js';

@Injectable()
export class RolesGuard implements CanActivate {
  // 验证点：@UseGuards 传类时框架实例化，Reflector 可注入
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride：方法级覆盖类级（就近优先）
    const roles = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPublic = this.reflector.getAllAndOverride<boolean>(Public, [
      context.getHandler(),
      context.getClass(),
    ]);
    console.log('[RolesGuard] 路由要求的角色:', roles);
    console.log('[RolesGuard] 路由是否公开:', isPublic);

    // 没有 @Roles 元数据 → 该路由无角色要求，放行
    if (!roles || roles.length === 0 || isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as unknown as Record<string, unknown>).user as
      | FakeUser
      | undefined;
    return !!user && roles.some((role) => user.roles.includes(role));
  }
}
