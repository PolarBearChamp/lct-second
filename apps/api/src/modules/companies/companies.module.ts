import { Global, Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyRegistry } from './company-registry';

@Global()
@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyRegistry],
  exports: [CompaniesService],
})
export class CompaniesModule {}
