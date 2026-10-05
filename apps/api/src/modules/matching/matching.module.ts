import { Module } from '@nestjs/common';
import { HiringNeedsModule } from '../hiring-needs/hiring-needs.module';
import { MatchingController } from './matching.controller';
import { MatchingRepository } from './matching.repository';
import { MatchingService } from './matching.service';

@Module({
  imports: [HiringNeedsModule],
  controllers: [MatchingController],
  providers: [MatchingRepository, MatchingService],
  exports: [MatchingRepository, MatchingService],
})
export class MatchingModule {}
