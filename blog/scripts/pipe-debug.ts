import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { RegisterDto } from '../src/auth/dto/auth.dto.js';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const result = await pipe.transform(
  { email: 'wei@blog.dev', password: 'password123', nickname: '伟哥' },
  { type: 'body', metatype: RegisterDto },
);
console.log('transform 结果:', JSON.stringify(result), '| email:', result?.email);
console.log('instanceof RegisterDto:', result instanceof RegisterDto);
