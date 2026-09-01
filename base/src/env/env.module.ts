import { DynamicModule, Module } from '@nestjs/common';
import { ENV_OPTIONS, type EnvOptions } from './env.constants.js';
import { EnvService } from './env.service.js';

@Module({
  providers: [EnvService], // 静态部分：无论是否 register 都存在
  exports: [EnvService],
})
export class EnvModule {
  static register(options: EnvOptions): DynamicModule {
    return {
      module: EnvModule,
      providers: [{ provide: ENV_OPTIONS, useValue: options }],
      exports: [ENV_OPTIONS],
    };
  }
}
