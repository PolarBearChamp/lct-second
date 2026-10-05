import { Module } from '@nestjs/common';
import { HiringNeedsController } from './hiring-needs.controller';
import { HiringNeedsService } from './hiring-needs.service';

@Module({
  controllers: [HiringNeedsController],
  providers: [HiringNeedsService],
  exports: [HiringNeedsService],
})
export class HiringNeedsModule {}
