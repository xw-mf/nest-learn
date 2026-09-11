import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
// 公开路由标记（全局守卫读到它直接放行）
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
