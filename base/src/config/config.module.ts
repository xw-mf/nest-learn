import { Module } from '@nestjs/common';
import { ConfigService } from './config.service.js';
import { ConfigurableModuleClass } from './config.module-definition.js';

@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule extends ConfigurableModuleClass {}