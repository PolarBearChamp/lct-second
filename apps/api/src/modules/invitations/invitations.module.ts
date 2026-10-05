import { Module } from '@nestjs/common';
import { CandidateProfilesModule } from '../candidate-profiles/candidate-profiles.module';
import { MatchingModule } from '../matching/matching.module';
import { CandidateInvitationsController, EmployerInvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [MatchingModule, CandidateProfilesModule],
  controllers: [EmployerInvitationsController, CandidateInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
