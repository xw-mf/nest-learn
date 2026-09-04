import { Inject, Injectable } from '@nestjs/common';
import { MODULE_OPTIONS_TOKEN } from './config.module-definition.js';
import { type ConfigModuleOptions } from './interface/config-module-options.interface.js';

@Injectable()
export class ConfigService {
  constructor(@Inject(MODULE_OPTIONS_TOKEN) private readonly options: ConfigModuleOptions) {}

  get config() {
    return this.options;
  }
}