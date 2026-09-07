import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Public } from '../decorators/roles.decorator.js';

export interface FakeUser {
  name: string;
  roles: string[];
}

/**
 * 实验用认证守卫：把 Authorization 头解析成"用户"，挂到 req 上
 * Bearer admin → { roles: ['admin'] }
 * Bearer user  → { roles: ['user'] }
 * 其他/缺失   → 拒绝（canActivate 返回 false）
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.headers.authorization;

    // 和 RolesGuard 读同一份元数据：公开路由直接放行
    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (token === 'Bearer admin') {
      (req as unknown as Record<string, unknown>).user = {
        name: 'admin',
        roles: ['admin', 'user'], // 角色继承：admin 拥有 user 的全部权限
      } satisfies FakeUser;
      return true;
    }
    if (token === 'Bearer user') {
      (req as unknown as Record<string, unknown>).user = {
        name: 'user',
        roles: ['user'],
      } satisfies FakeUser;
      return true;
    }
    return false;
  }
}
