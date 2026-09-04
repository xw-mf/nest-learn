import { Module } from '@nestjs/common';
import { EnvModule } from '../env/env.module.js';

@Module({
  imports: [EnvModule.register({ prefix: 'infrastructure' })],
  controllers: [],
  providers: [],
  exports: [EnvModule],
})
export class InfrastructureModule {}