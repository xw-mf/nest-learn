import { applyDecorators, UseGuards } from '@nestjs/common';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from '../guards/roles.guard.js';

// 组合装饰器：@Auth('admin') 一次声明 = 挂角色元数据 + 绑 RolesGuard
// （AuthGuard 已全局注册，无需重复绑）
export function Auth(...roles: string[]) {
  return applyDecorators(Roles(roles), UseGuards(RolesGuard));
}
