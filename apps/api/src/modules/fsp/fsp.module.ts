import { Module } from '@nestjs/common';
import { CandidateProfilesModule } from '../candidate-profiles/candidate-profiles.module';
import { FSP_PROVIDER } from './fsp-provider';
import { FspController } from './fsp.controller';
import { FspService } from './fsp.service';
import { MockFspProvider } from './mock-fsp.provider';

@Module({
  imports: [CandidateProfilesModule],
  controllers: [FspController],
  providers: [
    FspService,
    // Сменный адаптер: в MVP — только демонстрационный провайдер (FSP_PROVIDER=mock).
    { provide: FSP_PROVIDER, useFactory: () => new MockFspProvider() },
  ],
  exports: [FspService, FSP_PROVIDER],
})
export class FspModule {}
