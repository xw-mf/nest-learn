import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// 数据层是全应用的基础设施（04 章：少数合理的全局模块之一）
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}