import { NotFoundException, HttpStatus } from "@nestjs/common";

export class CatNotFoundException extends NotFoundException {
  constructor(id: number | undefined) {
    super({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Cat not found: ${id}`
    });
    this.errorCode = `CAT_NOT_FOUND`;
  }
}