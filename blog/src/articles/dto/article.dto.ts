import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateArticleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsBoolean()
  @IsOptional()
  published?: boolean;

  @IsString({ each: true }) // 数组里每个元素都是 string
  @IsOptional()
  tags?: string[];
}

export class UpdateArticleDto extends PartialType(CreateArticleDto) {}

export class AddCommentDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
