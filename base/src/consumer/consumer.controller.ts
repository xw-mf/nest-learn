import { Controller, Get, UseFilters } from '@nestjs/common';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { LabService } from '../lab/lab.service.js';
import { EnvService } from '../env/env.service.js';
import { ConfigService } from '../config/config.service.js';

@Controller('consumer')
@UseFilters(HttpExceptionFilter) // 控制器级绑定
export class ConsumerController {
  constructor(
    private readonly labService: LabService,
    private readonly envService: EnvService,
    private readonly configService: ConfigService,
  ) {}

  @Get('env')
  envProbe() {
    return this.envService.describe();
  }

  @Get()
  probe() {
    return { instanceId: this.labService.instanceId };
  }

  @Get('config')
  configProbe() {
    return this.configService.config;
  }
}
