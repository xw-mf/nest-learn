import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  // 纵向越权测试端点：只有 ADMIN 能看全量用户
  @Get()
  @Roles(['ADMIN'])
  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, nickname: true, role: true },
    });
  }
}
