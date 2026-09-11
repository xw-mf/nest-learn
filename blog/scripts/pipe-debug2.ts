import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UpdateArticleDto } from '../src/articles/dto/article.dto.js';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const result = await pipe.transform(
  { title: 'P5 缓存测试' },
  { type: 'body', metatype: UpdateArticleDto },
);
console.log('结果:', JSON.stringify(result));
