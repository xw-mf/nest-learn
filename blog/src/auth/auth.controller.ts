import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser, type JwtPayload } from './decorators/current-user.decorator.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // 登录 60 秒最多 5 次：防密码爆破
  @HttpCode(HttpStatus.OK) // 登录是"动作"不是"创建资源"，用 200 不用 201
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('profile') // 无 @Public → 全局守卫拦截，验证 token
  profile(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
