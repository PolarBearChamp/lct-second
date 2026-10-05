import { Module } from '@nestjs/common';
import { CandidateProfilesController } from './candidate-profiles.controller';
import { CandidateProfilesService } from './candidate-profiles.service';

@Module({
  controllers: [CandidateProfilesController],
  providers: [CandidateProfilesService],
  exports: [CandidateProfilesService],
})
export class CandidateProfilesModule {}
