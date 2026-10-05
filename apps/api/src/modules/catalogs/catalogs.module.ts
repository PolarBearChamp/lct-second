import { Module } from '@nestjs/common';
import { CatalogSyncService } from './catalog-sync.service';
import { CatalogsController } from './catalogs.controller';

@Module({
  controllers: [CatalogsController],
  providers: [CatalogSyncService],
  exports: [CatalogSyncService],
})
export class CatalogsModule {}
