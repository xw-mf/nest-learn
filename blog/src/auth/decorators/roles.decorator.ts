import { Reflector } from '@nestjs/core';

// 角色元数据装饰器：@Roles(['ADMIN'])
export const Roles = Reflector.createDecorator<string[]>();
