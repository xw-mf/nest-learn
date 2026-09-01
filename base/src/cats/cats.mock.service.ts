import { Injectable } from '@nestjs/common';

export interface Cat {
  name: string;
  age: number;
  breed: string;
}

@Injectable()
export class CatsServiceMock {
	create(): Cat {
		return {
			name: 'Mock',
			age: 1,
			breed: 'Mock'
		}
	}

	findAll(): Cat[] {
		return [{
			name: 'Mock',
			age: 1,
			breed: 'Mock'
		}];
	}

	findOne(id: string): Cat | undefined {
		return {
			name: `Mock ${id}`,
			age: 1,
			breed: 'Mock'
		}
	}
}