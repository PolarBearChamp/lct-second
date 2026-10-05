import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogSyncService } from '../catalogs/catalog-sync.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogSync: CatalogSyncService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Живость процесса API' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Готовность: доступность PostgreSQL и синхронизация справочников' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, 'ok' | 'fail'> = { database: 'fail', catalog: 'fail' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    // База доступна, но справочники не синхронизированы (сбой при старте): пробуем синхронизировать сейчас.
    if (checks.database === 'ok') checks.catalog = (await this.catalogSync.ensureSynced()) ? 'ok' : 'fail';
    const ok = Object.values(checks).every((value) => value === 'ok');
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'unavailable', checks };
  }
}
