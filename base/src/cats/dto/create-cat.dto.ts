import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';

export class CreateCatDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(0)
  @Max(30)
  age: number;

  @IsString()
  breed: string;
}

export class UpdateCatDto extends PartialType(CreateCatDto) {}
