import { Module } from '@nestjs/common';
import { CandidateProfilesModule } from '../candidate-profiles/candidate-profiles.module';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';

@Module({
  imports: [CandidateProfilesModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
