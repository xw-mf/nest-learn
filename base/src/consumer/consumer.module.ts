import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller.js';
// import { EnvModule } from '../env/env.module.js';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { ConfigModule } from '../config/config.module.js';

@Module({
  // imports: [EnvModule.register({ prefix: 'from-dynamic-options' })],
  imports: [
    InfrastructureModule,
    ConfigModule.register({
      folder: 'config',
      isGlobal: true
    })
  ],
  controllers: [ConsumerController],
})
export class ConsumerModule {}
