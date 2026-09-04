import { Inject, Injectable } from '@nestjs/common';
import { ENV_OPTIONS, type EnvOptions } from './env.constants.js';

@Injectable()
export class EnvService {
  constructor(@Inject(ENV_OPTIONS) private readonly options: EnvOptions) {}

  describe() {
    return { prefix: this.options.prefix || this.options.fallbackPrefix };
  }
}
