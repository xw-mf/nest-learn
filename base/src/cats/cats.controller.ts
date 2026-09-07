import {
	Body,
	Controller,
	DefaultValuePipe,
	Delete,
	Get,
	HttpCode,
	Inject,
	Param,
	ParseIntPipe,
	Post,
	Put,
	Query,
	UseGuards,
	UseInterceptors,
	UsePipes,
	ValidationPipe,
} from '@nestjs/common';
import { CreateCatDto, UpdateCatDto } from './dto/create-cat.dto.js'; // 注意 .js 后缀
import { CatsService } from './cats.service.js';
import { CatNotFoundException } from './exception/cat-not-found.exception.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Public, Roles } from '../common/decorators/roles.decorator.js';
import { CostTimeInterceptor } from '../common/interceptors/costtime.interceptor.js';
import { User } from '../common/decorators/user.decorator.js';
import type { FakeUser } from '../common/guards/auth.guard.js';
import { TransformUppercasePipe } from '../common/pipes/transform-uppercase.pipe.js';

@Controller('cats')
@UseGuards(RolesGuard)
@Roles(['user']) // 类级元数据：整个控制器至少要求 user 角色
@UseInterceptors(CostTimeInterceptor)
export class CatsController {
	constructor(
		private readonly catsService: CatsService,
		@Inject('CATS_STORAGE_LIMIT') private readonly catsStorageLimit: number
	) {}

	@Post()
	@Roles(['admin']) // 方法级：覆盖类级的 ['user']
	@UsePipes(new ValidationPipe()) // 方法级绑定（实验B）
	create(@Body() createCatDto: CreateCatDto) {
		console.log('DTO 是否为类实例:', createCatDto instanceof CreateCatDto);
		return this.catsService.create(createCatDto);
	}

	@Get()
	findAll(
		@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
		@Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
	) {
		return this.catsService.findAll(page, pageSize);
	}

	@Get('/storage-limit')
	getStorageLimit() {
		return this.catsStorageLimit;
	}

	// 静态路由在前
	@Get('me')
	getMe(@User() user: FakeUser, @User('name', TransformUppercasePipe) name: string) {
		return { user, name };
	}

	@Get('breeds')
	@Public(true) // 方法级：覆盖类级的 ['user']
	findBreeds() {
		return ['Persian', 'Siamese', 'Maine Coon'];
	}

	// 参数路由在后（ParseIntPipe：转换+校验一体）
	@Get(':id')
	findOne(@Param('id', ParseIntPipe) id: number) {
		const cat = this.catsService.findOne(id);
		if (!cat) {
			throw new CatNotFoundException(id);
		}
		return cat;
	}

	@Put(':id')
	update(@Param('id') id: string, @Body() updateCatDto: UpdateCatDto) {
		return `This action updates a #${id} cat`;
	}

	@Delete(':id')
	@HttpCode(204)
	remove(@Param('id') id: string) {
		// 204 No Content：成功但不返回body
	}

	@Get('files/*path')
	getFile(@Param('path') path: string[]) {
		console.log(path);
		return `This action returns a file: ${path.join('/')}`;
	}
}