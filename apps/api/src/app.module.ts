import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './common/core.module';
import { PrismaModule } from './prisma/prisma.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CsrfGuard } from './modules/auth/csrf.guard';
import { CandidateProfilesModule } from './modules/candidate-profiles/candidate-profiles.module';
import { CatalogsModule } from './modules/catalogs/catalogs.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { FspModule } from './modules/fsp/fsp.module';
import { HiringNeedsModule } from './modules/hiring-needs/hiring-needs.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MatchingModule } from './modules/matching/matching.module';
import { ProfilePdfModule } from './modules/profile-pdf/profile-pdf.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { ProfileViewModule } from './modules/profile-view/profile-view.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    CoreModule,
    PrismaModule,
    AuditModule,
    MailModule,
    AuthModule,
    UsersModule,
    CatalogsModule,
    HealthModule,
    ProfileViewModule,
    CandidateProfilesModule,
    AssessmentsModule,
    CompaniesModule,
    HiringNeedsModule,
    MatchingModule,
    InvitationsModule,
    FspModule,
    ProfilePdfModule,
  ],
  providers: [
    // Порядок важен: сначала CSRF для изменяющих запросов, затем сессия/роль.
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
