import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import type { JwtPayload } from './decorators/current-user.decorator.js';

// 全局认证守卫：默认所有路由要登录，@Public() 声明例外
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    // auth.guard.ts 的 isPublic 分支改成"放行但仍尝试解析 token"
    // 因为获取文章详情接口是 public 的，用户分为登录查看或未登录查看
    // 登录用户查看需要查询收藏状态，所以需要解析 token，但解析失败也不影响放行
    if (isPublic) {
      const token = this.extractToken(req);
      if (token) {
        try {
          const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
          (req as unknown as Record<string, unknown>).user = payload; // 挂到 req 上
        } catch {
          throw new UnauthorizedException('token 无效或已过期');
        }
      }
      return true;
    };

    if (!token) {
      throw new UnauthorizedException('未登录'); // 401：认不出你是谁
    }
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      (req as unknown as Record<string, unknown>).user = payload; // 挂到 req 上
    } catch {
      throw new UnauthorizedException('token 无效或已过期');
    }
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
