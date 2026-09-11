import 'dotenv/config'; // 必须最先加载：后续模块（JwtModule 等）要读环境变量
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger API 文档（/docs）
  const config = new DocumentBuilder()
    .setTitle('Blog API')
    .setDescription('博客 CMS 接口文档')
    .setVersion('1.0')
    .addBearerAuth() // 文档里可直接带 token 调试
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
