import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Inject,
	Param,
	Post,
	Put,
	Query,
} from '@nestjs/common';
import { CreateCatDto, UpdateCatDto } from './dto/create-cat.dto.js'; // 注意 .js 后缀
import { CatsService } from './cats.service.js';

@Controller('cats')
export class CatsController {
	constructor(
		private readonly catsService: CatsService,
		@Inject('CATS_STORAGE_LIMIT') private readonly catsStorageLimit: number
	) {}

	@Post()
	create(@Body() createCatDto: CreateCatDto) {
		return this.catsService.create(createCatDto);
	}

	@Get()
	findAll() {
		return this.catsService.findAll();
	}

	@Get('/storage-limit')
	getStorageLimit() {
		return this.catsStorageLimit;
	}

	// 静态路由在前
	@Get('breeds')
	findBreeds() {
		return ['Persian', 'Siamese', 'Maine Coon'];
	}

	// 参数路由在后
	@Get(':id')
	findOne(@Param('id') id: string) {
		return `This action returns a #${id} cat`;
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