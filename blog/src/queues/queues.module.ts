import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationProcessor } from './notification.processor.js';

@Module({
  imports: [
    // BullMQ 复用现有 Redis（localhost:6379）
    BullModule.forRoot({
      connection: { host: 'localhost', port: 6379 },
    }),
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [NotificationProcessor],
})
export class QueuesModule {}
