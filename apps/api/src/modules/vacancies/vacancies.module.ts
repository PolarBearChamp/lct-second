import { Module } from '@nestjs/common';
import { CandidateProfilesModule } from '../candidate-profiles/candidate-profiles.module';
import { MatchingModule } from '../matching/matching.module';
import { ApplicationsService } from './applications.service';
import { CandidateVacanciesController, EmployerApplicationsController, EmployerVacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

@Module({
  imports: [MatchingModule, CandidateProfilesModule],
  controllers: [EmployerVacanciesController, EmployerApplicationsController, CandidateVacanciesController],
  providers: [VacanciesService, ApplicationsService],
  exports: [VacanciesService, ApplicationsService],
})
export class VacanciesModule {}
