import { Module } from '@nestjs/common';
import { CandidateProfilesModule } from '../candidate-profiles/candidate-profiles.module';
import { CandidateTasksService } from './candidate-tasks.service';
import { CandidateTasksController, EmployerTasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [CandidateProfilesModule],
  controllers: [EmployerTasksController, CandidateTasksController],
  providers: [TasksService, CandidateTasksService],
  exports: [TasksService, CandidateTasksService],
})
export class TasksModule {}
