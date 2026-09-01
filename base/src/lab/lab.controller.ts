import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { LabService } from './lab.service.js';

@Controller('lab')
export class LabController {
  constructor(
    private readonly labService: LabService,
    // 同一个 token 再注一次：验证单例
    private readonly labService2: LabService,
    @Inject('LAB_ALIAS') private readonly aliased: LabService,
    @Inject('LAB_VALUE') private readonly value: unknown,
    @Inject('LAB_FACTORY') private readonly factoryResult: unknown,
    @Inject('LAB_ASYNC') private readonly asyncResult: unknown,
    // 未注册的 token + @Optional()：注入 undefined 而非报错
    @Optional() @Inject('TOTALLY_MISSING') private readonly missing?: unknown,
  ) {}

  @Get()
  probe() {
    // 突变传播：往别名上写，从本体读——验证两者背后是同一个对象
    (this.aliased as unknown as Record<string, unknown>).tag =
      'mutated-via-alias';

    return {
      sameTokenTwice: this.labService === this.labService2,
      aliasIsSameInstance: this.labService === this.aliased,
      propagation:
        (this.labService as unknown as Record<string, unknown>).tag ?? null,
      instanceId: this.labService.instanceId,
      value: this.value,
      factoryResult: this.factoryResult,
      asyncResult: this.asyncResult,
      optionalMissingIsUndefined: this.missing === undefined,
    };
  }
}
