import { Module } from '@nestjs/common';
import { CandidateProfilesModule } from '../candidate-profiles/candidate-profiles.module';
import { ProfilePdfController } from './profile-pdf.controller';
import { ProfilePdfService } from './profile-pdf.service';

@Module({
  imports: [CandidateProfilesModule],
  controllers: [ProfilePdfController],
  providers: [ProfilePdfService],
  exports: [ProfilePdfService],
})
export class ProfilePdfModule {}
