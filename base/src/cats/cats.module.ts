import { BadRequestException, Module } from '@nestjs/common';
import { CatsController } from './cats.controller.js';
import { CatsService } from './cats.service.js';
import { CatsServiceMock } from './cats.mock.service.js';

@Module({
	controllers: [CatsController],
	providers: [
        {
            provide: CatsService,
            useClass: CatsService,
        },
        // {
        //     provide: 'CATS_SERVICE_MOCK',
        //     useClass: CatsServiceMock,
        // },
        {
            provide: 'CATS_STORAGE_LIMIT',
            useFactory: () => process.env.NODE_ENV === 'production' ? 100 : 5
        }
    ],
})
export class CatsModule {}