import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { badRequest } from '../../common/errors';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CandidateProfilesService } from '../candidate-profiles/candidate-profiles.service';
import { CompaniesService } from '../companies/companies.service';
import { AcceptInvitationDto, DeclineInvitationDto, InvitationListQueryDto, SendInvitationDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

@ApiTags('employer-invitations')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer/invitations')
export class EmployerInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly companies: CompaniesService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Отправить приглашение кандидату',
    description: 'Обязательна зарплатная вилка (₽/мес, GROSS). Привязка к потребности необязательна. Не более одного активного приглашения на пару компания–кандидат.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 201, description: 'Приглашение отправлено' })
  @ApiResponse({ status: 200, description: 'Повтор с тем же Idempotency-Key' })
  @ApiResponse({ status: 409, description: 'ACTIVE_INVITATION_EXISTS' })
  async send(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SendInvitationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId: string,
  ) {
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key: 8–64 символа [A-Za-z0-9_-]');
    const company = await this.companies.requireCompany(auth.userId);
    const { invitation, created } = await this.invitations.send(company, auth.userId, dto, key, requestId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return invitation;
  }

  @Get()
  @ApiOperation({ summary: 'Приглашения своей компании и их статусы' })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: InvitationListQueryDto) {
    return this.invitations.listForCompany(await this.companies.requireCompany(auth.userId), query.status, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Приглашение своей компании с историей статусов' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.invitations.employerView(await this.companies.requireCompany(auth.userId), id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отозвать приглашение (SENT/VIEWED → WITHDRAWN)' })
  @ApiResponse({ status: 409, description: 'INVITATION_FINAL — приглашение уже принято, отклонено или истекло' })
  async withdraw(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.invitations.withdraw(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }
}

@ApiTags('candidate-invitations')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate')
export class CandidateInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly profiles: CandidateProfilesService,
  ) {}

  @Get('invitations')
  @ApiOperation({ summary: 'Входящие приглашения (зарплата и условия видны до принятия)' })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: InvitationListQueryDto) {
    return this.invitations.listForCandidate(await this.profiles.candidateIdOf(auth.userId), query.status, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get('invitations/:id')
  @ApiOperation({ summary: 'Приглашение и список данных, которые будут раскрыты при принятии', description: 'Чтение не меняет статус на VIEWED.' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.invitations.candidateView(await this.profiles.candidateIdOf(auth.userId), id);
  }

  @Post('invitations/:id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Явно отметить приглашение просмотренным (SENT → VIEWED)' })
  async view(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.invitations.markViewed(await this.profiles.candidateIdOf(auth.userId), auth.userId, id);
  }

  @Post('invitations/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять приглашение и раскрыть выбранные контакты только этой компании' })
  @ApiResponse({ status: 409, description: 'INVITATION_EXPIRED | INVITATION_FINAL | NO_CONTACT_CHANNEL' })
  async accept(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() _dto: AcceptInvitationDto, @RequestId() requestId: string) {
    return this.invitations.accept(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, requestId);
  }

  @Post('invitations/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отклонить приглашение' })
  async decline(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: DeclineInvitationDto, @RequestId() requestId: string) {
    return this.invitations.decline(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, dto.reason, requestId);
  }

  @Get('contact-access')
  @ApiOperation({ summary: 'Компании, которым выдан доступ к контактам' })
  async contactAccess(@CurrentAuth() auth: AuthContext) {
    return this.invitations.contactAccess(await this.profiles.candidateIdOf(auth.userId));
  }

  @Delete('contact-access/:companyId')
  @ApiOperation({
    summary: 'Отозвать дальнейший доступ компании к контактам',
    description: 'Исторический статус ACCEPTED не меняется; новые ответы API и PDF перестают содержать контакты. Уже полученную компанией копию отозвать технически невозможно.',
  })
  async revoke(@CurrentAuth() auth: AuthContext, @Param('companyId', UuidPipe) companyId: string, @RequestId() requestId: string) {
    return this.invitations.revokeAccess(await this.profiles.candidateIdOf(auth.userId), auth.userId, companyId, requestId);
  }
}
