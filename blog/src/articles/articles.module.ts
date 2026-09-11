import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';
import { OwnershipGuard } from './ownership.guard.js';

@Module({
  imports: [BullModule.registerQueue({ name: 'notifications' })], // 消费方注册队列（forFeature 模式）
  controllers: [ArticlesController],
  providers: [ArticlesService, OwnershipGuard],
})
export class ArticlesModule {}
