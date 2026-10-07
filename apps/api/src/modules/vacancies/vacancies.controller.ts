import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CandidateProfilesService } from '../candidate-profiles/candidate-profiles.service';
import { CompaniesService } from '../companies/companies.service';
import { ApplicationsService } from './applications.service';
import {
  ApplyDto,
  CandidateApplicationQueryDto,
  CandidateVacancyQueryDto,
  CreateVacancyDto,
  UpdateVacancyDto,
  VacancyApplicationsQueryDto,
  VacancyListQueryDto,
  WithdrawApplicationDto,
} from './dto/vacancy.dto';
import { VacanciesService } from './vacancies.service';

@ApiTags('employer-vacancies')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer/vacancies')
export class EmployerVacanciesController {
  constructor(
    private readonly vacancies: VacanciesService,
    private readonly applications: ApplicationsService,
    private readonly companies: CompaniesService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Создать вакансию (черновик или сразу публикация)',
    description: 'Зарплатная вилка обязательна (₽/мес, GROSS). Требования — те же структурированные поля, что у потребности; обязательный навык должен проверяться заданиями.',
  })
  @ApiResponse({ status: 409, description: 'COMPANY_PROFILE_REQUIRED' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  async create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateVacancyDto, @RequestId() requestId: string) {
    return this.vacancies.create(await this.companies.requireCompany(auth.userId), auth.userId, dto, requestId);
  }

  @Get()
  @ApiOperation({ summary: 'Вакансии своей компании со счётчиками откликов' })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: VacancyListQueryDto) {
    return this.vacancies.list(await this.companies.requireCompany(auth.userId), query.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Вакансия своей компании' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.vacancies.employerView(await this.companies.requireCompany(auth.userId), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить вакансию (создаёт новую версию)', description: 'Уже поданные отклики хранят снимок вакансии, по которой поданы. Статус меняется отдельными действиями.' })
  async update(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: UpdateVacancyDto, @RequestId() requestId: string) {
    return this.vacancies.update(await this.companies.requireCompany(auth.userId), auth.userId, id, dto, requestId);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Опубликовать вакансию (DRAFT/CLOSED → PUBLISHED)', description: 'Повтор на опубликованной вакансии идемпотентен.' })
  async publish(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.vacancies.publish(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Закрыть вакансию (PUBLISHED → CLOSED)', description: 'Новые отклики не принимаются; поданные остаются в работе.' })
  @ApiResponse({ status: 409, description: 'VACANCY_NOT_PUBLISHED — черновик нельзя закрыть' })
  async close(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.vacancies.close(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Get(':id/applications')
  @ApiOperation({
    summary: 'Отклики на вакансию с оценкой соответствия требованиям',
    description: 'Сортировка по умолчанию — по соответствию (подходящие выше); sort=DATE — по дате. ФИО показывается только при действующем доступе к контактам.',
  })
  async listApplications(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Query() query: VacancyApplicationsQueryDto) {
    return this.applications.listForVacancy(await this.companies.requireCompany(auth.userId), id, query);
  }
}

@ApiTags('employer-vacancies')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer/applications')
export class EmployerApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly companies: CompaniesService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Отклик на вакансию своей компании: сообщение, соответствие, карточка кандидата в объёме прав' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.applications.employerView(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Явно отметить отклик просмотренным (SENT → VIEWED)', description: 'Открытие списка или карточки статус не меняет.' })
  async view(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.applications.markViewed(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Post(':id/shortlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Взять кандидата в шорт-лист (SENT/VIEWED → SHORTLISTED)' })
  @ApiResponse({ status: 409, description: 'APPLICATION_FINAL — отклик уже отклонён или отозван' })
  async shortlist(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.applications.shortlist(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отклонить отклик (SENT/VIEWED/SHORTLISTED → REJECTED)' })
  @ApiResponse({ status: 409, description: 'APPLICATION_FINAL — отклик уже отозван кандидатом' })
  async reject(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.applications.reject(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }
}

@ApiTags('candidate-vacancies')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate')
export class CandidateVacanciesController {
  constructor(
    private readonly vacancies: VacanciesService,
    private readonly applications: ApplicationsService,
    private readonly profiles: CandidateProfilesService,
  ) {}

  @Get('vacancies')
  @ApiOperation({
    summary: 'Опубликованные вакансии: зарплата, требования, соответствие кандидата и возможность откликнуться',
    description: 'Зарплатная вилка видна до отклика. Соответствие считается по подтверждённым тестом данным кандидата и не блокирует отклик.',
  })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: CandidateVacancyQueryDto) {
    return this.vacancies.browse(await this.profiles.candidateIdOf(auth.userId), query);
  }

  @Get('vacancies/:id')
  @ApiOperation({ summary: 'Вакансия: условия, соответствие, препятствия к отклику и список данных, которые будут раскрыты' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.vacancies.candidateView(await this.profiles.candidateIdOf(auth.userId), id);
  }

  @Post('vacancies/:id/applications')
  @ApiOperation({
    summary: 'Откликнуться на вакансию и раскрыть выбранные контакты только этой компании',
    description: 'Требуется подтверждённая тестом квалификация по специализации вакансии, заполненный профиль и канал связи; отклик — явное согласие на раскрытие контактов (confirmDisclosure).',
  })
  @ApiResponse({ status: 409, description: 'VACANCY_CLOSED | QUALIFICATION_REQUIRED | PROFILE_INCOMPLETE | NO_CONTACT_CHANNEL | ACTIVE_APPLICATION_EXISTS' })
  async apply(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: ApplyDto, @RequestId() requestId: string) {
    return this.applications.apply(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, dto, requestId);
  }

  @Get('applications')
  @ApiOperation({ summary: 'Мои отклики и их статусы' })
  async listApplications(@CurrentAuth() auth: AuthContext, @Query() query: CandidateApplicationQueryDto) {
    return this.applications.listForCandidate(await this.profiles.candidateIdOf(auth.userId), query);
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'Мой отклик: условия вакансии на момент отклика, история статусов, доступ к контактам' })
  async getApplication(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.applications.candidateView(await this.profiles.candidateIdOf(auth.userId), id);
  }

  @Post('applications/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отозвать отклик (SENT/VIEWED/SHORTLISTED → WITHDRAWN)',
    description: 'revokeContactAccess=true дополнительно закрывает компании доступ к контактам; иначе доступ сохраняется до явного отзыва в «Приватность и ФСП».',
  })
  @ApiResponse({ status: 409, description: 'APPLICATION_FINAL — отклик уже отклонён работодателем' })
  async withdraw(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: WithdrawApplicationDto, @RequestId() requestId: string) {
    return this.applications.withdraw(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, dto.revokeContactAccess === true, requestId);
  }
}
