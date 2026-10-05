import { Injectable, type PipeTransform } from '@nestjs/common';
import { badRequest } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Проверка идентификатора в пути: некорректный формат — 400 INVALID_ID. */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw badRequest('INVALID_ID', 'Некорректный идентификатор');
    return value.toLowerCase();
  }
}

export const isUuid = (value: string) => UUID.test(value);
