import { Reflector } from '@nestjs/core';

// 强类型元数据装饰器：@Roles(['admin'])
// 前端类比：≈ Vue Router 的 route.meta.roles
export const Roles = Reflector.createDecorator<string[]>();

export const Public = Reflector.createDecorator<boolean>();
