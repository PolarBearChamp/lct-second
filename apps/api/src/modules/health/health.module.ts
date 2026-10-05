import { Module } from '@nestjs/common';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { HealthController } from './health.controller';

@Module({
  imports: [CatalogsModule],
  controllers: [HealthController],
})
export class HealthModule {}
