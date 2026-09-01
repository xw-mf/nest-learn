import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller.js';
import { EnvModule } from '../env/env.module.js';

@Module({
  imports: [EnvModule.register({ prefix: 'from-dynamic-options' })],
  controllers: [ConsumerController],
})
export class ConsumerModule {}
