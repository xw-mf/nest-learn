import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Auth } from './common/decorators/auth.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('admin-zone')
  @Auth('admin')
  adminZone() {
    return { zone: 'admin only' };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('info')
  getInfo() {
    return this.appService.getInfo();
  }
}
