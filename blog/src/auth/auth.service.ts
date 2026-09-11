import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';
import type { JwtPayload } from './decorators/current-user.decorator.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('邮箱已被注册');
    }
    // bcrypt 哈希（自带随机盐），数据库永远不存明文
    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({ ...dto, password });
    // 剥离密码字段，绝不返回给客户端
    const { password: _password, ...result } = user;
    return result;
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    // 注意：不区分"邮箱不存在"和"密码错误"——防用户枚举攻击
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return { accessToken: await this.jwtService.signAsync(payload) };
  }
}
