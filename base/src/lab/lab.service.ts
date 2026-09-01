import { Injectable } from '@nestjs/common';

@Injectable()
export class LabService {
  // 每个实例一个随机 id，用来判断"是不是同一个实例"
  readonly instanceId = Math.random().toString(36).slice(2, 8);
}
