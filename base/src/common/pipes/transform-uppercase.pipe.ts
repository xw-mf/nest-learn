import { PipeTransform, Injectable } from '@nestjs/common';

@Injectable()
export class TransformUppercasePipe implements PipeTransform {
  transform(value: unknown) {
    if (typeof value === 'string') return value.toUpperCase();
    return value;
  }
}