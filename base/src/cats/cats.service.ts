import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CreateCatDto } from './dto/create-cat.dto.js';

export interface Cat {
  name: string;
  age: number;
  breed: string;
}

@Injectable()
export class CatsService {
  private readonly cats: Cat[] = [];

	constructor(@Inject('CATS_STORAGE_LIMIT') private readonly catsStorageLimit: number) {}

	create(cat: CreateCatDto): Cat {
		if (this.cats.length >= this.catsStorageLimit) {
			throw new BadRequestException('Cats storage limit reached, please try again later');
		}
		const newCat: Cat = {...cat};
		this.cats.push(newCat);
		return newCat;
	}

	findAll(): Cat[] {
		return this.cats;
	}

	findOne(id: number): Cat | undefined {
		return this.cats[id];
	}
}