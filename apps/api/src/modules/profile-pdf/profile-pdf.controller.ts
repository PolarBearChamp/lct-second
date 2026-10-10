import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import type { CandidateProfileView } from '../../domain/privacy/profile-view';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CandidateProfilesService } from '../candidate-profiles/candidate-profiles.service';
import { CompaniesService } from '../companies/companies.service';
import { ProfileViewService } from '../profile-view/profile-view.service';
import { PdfQueryDto } from './dto/pdf-query.dto';
import { ProfilePdfService } from './profile-pdf.service';

/** PDF генерируется на backend после проверки прав; ссылка не публичная, ответ не кэшируется. */
@ApiTags('profile-pdf')
@ApiCookieAuth()
@Controller()
export class ProfilePdfController {
  constructor(
    private readonly pdf: ProfilePdfService,
    private readonly views: ProfileViewService,
    private readonly profiles: CandidateProfilesService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  private async send(res: Response, view: CandidateProfileView) {
    const buffer = await this.pdf.render(view);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${this.pdf.fileName(view)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Roles('CANDIDATE')
  @Get('candidate/profile/pdf')
  @ApiOperation({ summary: 'Полный PDF собственного профиля' })
  @ApiProduces('application/pdf')
  async own(@CurrentAuth() auth: AuthContext, @Res() res: Response) {
    const view = await this.views.ownerView(await this.profiles.candidateIdOf(auth.userId));
    await this.send(res, view);
  }

  @Roles('EMPLOYER')
  @Get('employer/candidates/:id/pdf')
  @ApiOperation({ summary: 'PDF кандидата в объёме прав компании', description: 'Обезличенный до принятия приглашения; с контактами — только при действующем доступе этой компании.' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 404, description: 'CANDIDATE_NOT_FOUND' })
  async employer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Query() query: PdfQueryDto,
    @Res() res: Response,
    @RequestId() requestId: string,
  ) {
    const company = await this.companies.requireCompany(auth.userId);
    const view = await this.views.employerView(company.id, id, query.specialization);
    await this.audit.record({
      actorUserId: auth.userId,
      action: 'candidate.pdf_downloaded',
      objectType: 'CandidateProfile',
      objectId: id,
      requestId,
      metadata: { mode: view.mode },
    });
    await this.send(res, view);
  }
}
