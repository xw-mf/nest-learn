import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getInfo() {
    return { name: 'base', version: '1.0.0' }
  }
}
