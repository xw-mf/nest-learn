import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

// 支持归属校验的资源（都需有 authorId 字段）
export type OwnableModel = 'article' | 'comment';

export const OWNERSHIP_MODEL_KEY = 'ownershipModel';

// 元数据声明：这个接口操作哪种资源
// 用法：@CheckOwnership('comment') + @UseGuards(OwnershipGuard)
export const CheckOwnership = (model: OwnableModel) =>
  SetMetadata(OWNERSHIP_MODEL_KEY, model);

/**
 * 通用资源归属守卫：只有资源作者本人或 ADMIN 能操作
 * 防横向越权（IDOR）：改 URL 里的 id 就能碰别人的资源
 * 资源类型由 @CheckOwnership() 元数据声明（08 章元数据驱动模式）
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const model = this.reflector.get<OwnableModel>(
      OWNERSHIP_MODEL_KEY,
      context.getHandler(),
    );
    if (!model) return true; // 没声明资源 → 本守卫不管

    const req = context.switchToHttp().getRequest<Request>();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new NotFoundException('资源不存在');
    }

    // 两个模型都有 authorId，归属判断可以通用；
    // 但 Prisma 的 delegate 类型是各自特化的，联合类型无法直接调用——收敛成最小接口
    const delegate = this.prisma[model] as unknown as {
      findUnique(args: {
        where: { id: number };
      }): Promise<{ authorId: number; deletedAt?: Date | null } | null>;
    };
    const resource = await delegate.findUnique({ where: { id } });
    if (!resource || resource.deletedAt) {
      throw new NotFoundException('资源不存在'); // 先查存在性，不泄露归属情报
    }

    const user = (req as unknown as Record<string, unknown>).user as JwtPayload;
    if (user.role === 'ADMIN') return true; // 纵向放行
    if (resource.authorId !== user.sub) {
      throw new ForbiddenException('只能操作自己的内容'); // 横向拦截
    }

    // 资源挂到 req 上，控制器免二次查询（有 DI 的机制干活，装饰器取值）
    (req as unknown as Record<string, unknown>).resource = resource;
    return true;
  }
}
