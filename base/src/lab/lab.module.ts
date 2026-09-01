import { Global, Module } from '@nestjs/common';
import { LabService } from './lab.service.js';
import { LabController } from './lab.controller.js';

@Global()
@Module({
  controllers: [LabController],
  exports: [LabService],
  providers: [
    // ① 标准简写
    LabService,
    // ② useExisting 别名：与 LabService 应解析为同一实例
    { provide: 'LAB_ALIAS', useExisting: LabService },
    // ③ useValue：直接注入一个现成对象
    { provide: 'LAB_VALUE', useValue: { mode: 'test', from: 'useValue' } },
    // ④ useFactory + inject（含可选依赖）
    {
      provide: 'LAB_FACTORY',
      useFactory: (val: { mode: string }, missing?: string) => {
        return { gotValue: val, missingIsUndefined: missing === undefined };
      },
      inject: ['LAB_VALUE', { token: 'NOT_REGISTERED', optional: true }],
    },
    // ⑤ 异步 useFactory
    {
      provide: 'LAB_ASYNC',
      useFactory: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { ready: true };
      },
    },
  ],
})
export class LabModule {}
