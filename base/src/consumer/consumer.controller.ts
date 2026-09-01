import { Controller, Get } from '@nestjs/common';
import { LabService } from '../lab/lab.service.js';
import { EnvService } from '../env/env.service.js';

@Controller('consumer')
export class ConsumerController {
  constructor(
    private readonly labService: LabService,
    private readonly envService: EnvService,
  ) {}

  @Get('env')
  envProbe() {
    return this.envService.describe();
  }

  @Get()
  probe() {
    return { instanceId: this.labService.instanceId };
  }
}
