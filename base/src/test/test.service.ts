import { Injectable } from '@nestjs/common';

@Injectable()
export class TestService {
  getInfo() {
    return { name: 'base', version: '1.0.0' }
  }
}