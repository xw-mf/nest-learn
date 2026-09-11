import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type JwtPayload } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ArticlesService } from './articles.service.js';
import { AddCommentDto, CreateArticleDto, UpdateArticleDto } from './dto/article.dto.js';
import { CheckOwnership, OwnershipGuard } from './ownership.guard.js';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Post() // 登录才能发（全局守卫）
  create(@Body() dto: CreateArticleDto, @CurrentUser() user: JwtPayload) {
    return this.articlesService.create(dto, user.sub);
  }

  @Public() // 博客语义：读公开，写要登录
  @Get()
  findAll() {
    return this.articlesService.findAll();
  }

  @Get('mine')
  findMyArticles(@CurrentUser('sub') authorId: number) {
    return this.articlesService.findMyArticles(authorId);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser('sub') userId: number) {
    return this.articlesService.findOne(id, userId);
  }

  @Put(':id')
  @CheckOwnership('article') // 元数据声明资源类型
  @UseGuards(OwnershipGuard) // 方法级：全局认证守卫先跑，再查归属
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articlesService.update(id, dto);
  }

  @Delete(':id')
  @CheckOwnership('article')
  @UseGuards(OwnershipGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.articlesService.remove(id);
  }

  /**
   * 添加评论
   * @param articleId 文章 ID
   * @param dto 评论内容
   * @param authorId 评论作者 ID
   * @returns 
   */
  // P4 N+1 对照实验
  @Public()
  @Get('n1/naive')
  n1Naive() {
    return this.articlesService.listN1Naive();
  }

  @Public()
  @Get('n1/include')
  n1Include() {
    return this.articlesService.listN1Include();
  }

  // P4 并发实验：原子 vs 朴素（教学对照）
  @Public()
  @Post(':id/view-atomic')
  viewAtomic(@Param('id', ParseIntPipe) id: number) {
    return this.articlesService.viewAtomic(id);
  }

  @Public()
  @Post(':id/view-naive')
  viewNaive(@Param('id', ParseIntPipe) id: number) {
    return this.articlesService.viewNaive(id);
  }

  @Post(':id/like')
  like(@Param('id', ParseIntPipe) id: number, @CurrentUser('sub') userId: number) {
    return this.articlesService.like(id, userId);
  }

  @Delete(':id/like')
  unlike(@Param('id', ParseIntPipe) id: number, @CurrentUser('sub') userId: number) {
    return this.articlesService.unlike(id, userId);
  }

  @Post(':id/favorite')
  favorite(@Param('id', ParseIntPipe) id: number, @CurrentUser('sub') userId: number) {
    return this.articlesService.favorite(id, userId);
  }

  @Delete(':id/favorite')
  unfavorite(@Param('id', ParseIntPipe) id: number, @CurrentUser('sub') userId: number) {
    return this.articlesService.unfavorite(id, userId);
  }

  @Post(':id/comments')
  async addComment(
    @Param('id', ParseIntPipe) articleId: number,
    @Body() dto: AddCommentDto,
    @CurrentUser('sub') authorId: number,
  ) {
    return await this.articlesService.addComment(articleId, dto, authorId);
  }

  /**
   * 删除评论
   * @param id 评论 ID
   * @returns 删除评论
   */
  @Delete('comment/:id')
  @CheckOwnership('comment')
  @UseGuards(OwnershipGuard)
  removeComment(@Param('id', ParseIntPipe) id: number) {
    return this.articlesService.removeComment(id);
  }

  @Post(':id/publish')
  @CheckOwnership('article')
  @UseGuards(OwnershipGuard)
  async publish(@Param('id', ParseIntPipe) id: number) {
    return await this.articlesService.publish(id);
  }
}
