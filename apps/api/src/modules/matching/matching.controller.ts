import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import type { GradeCode } from '../../domain/catalog/catalog';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { BankQueryDto, CandidateQueryDto, CreateSelectionDto, PageQueryDto } from './dto/matching.dto';
import { MatchingService } from './matching.service';

@ApiTags('employer-matching')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer')
export class MatchingController {
  constructor(
    private readonly matching: MatchingService,
    private readonly companies: CompaniesService,
  ) {}

  @Get('candidates')
  @ApiOperation({
    summary: 'Общий банк кандидатов с фильтрами',
    description:
      'Опубликованные профили. Сортировка по категории (специализация → подтверждённый грейд), внутри — качество теста и бонус ФСП. Кандидаты без подтверждённого грейда — после подтверждённых своей специализации, с пометкой и без балла (includeUnconfirmed=false скрывает их; category=SPEC:UNCONFIRMED — только они). Контакты не возвращаются.',
  })
  async bank(@CurrentAuth() auth: AuthContext, @Query() query: BankQueryDto) {
    const company = await this.companies.requireCompany(auth.userId);
    let specialization = query.specialization;
    let grades = query.grades as GradeCode[] | undefined;
    let includeUnconfirmed = query.includeUnconfirmed ?? true;
    let onlyUnconfirmed = false;
    if (query.category) {
      const [spec, grade] = query.category.split(':');
      specialization = spec;
      if (grade === 'UNCONFIRMED') {
        onlyUnconfirmed = true;
        grades = undefined;
      } else {
        grades = [grade as GradeCode];
        includeUnconfirmed = false;
      }
    }
    return this.matching.bank(
      company,
      { specialization, grades, skills: query.skills, skillSource: query.skillSource ?? 'VERIFIED', workFormat: query.workFormat, hasFsp: query.hasFsp, city: query.city, includeUnconfirmed, onlyUnconfirmed },
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Get('candidates/:id')
  @ApiOperation({
    summary: 'Карточка кандидата с проверкой прав',
    description: 'Обезличенная карточка, пока кандидат не принял приглашение компании; расширенная — при действующем доступе. 404 — если кандидат скрыт и доступа нет.',
  })
  @ApiResponse({ status: 404, description: 'CANDIDATE_NOT_FOUND' })
  async candidate(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Query() query: CandidateQueryDto, @RequestId() requestId: string) {
    return this.matching.candidate(await this.companies.requireCompany(auth.userId), auth.userId, id, query.needId, requestId, query.specialization);
  }

  @Post('needs/:id/selections')
  @ApiOperation({ summary: 'Построить подборку по потребности', description: 'Результат сохраняется как SelectionRun: версия потребности, фильтры, формула, порядок и безопасные объяснения.' })
  async createSelection(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: CreateSelectionDto, @RequestId() requestId: string) {
    return this.matching.createSelection(await this.companies.requireCompany(auth.userId), auth.userId, id, dto.refinements ?? {}, dto.parentRunId, requestId);
  }

  @Get('needs/:id/selections')
  @ApiOperation({ summary: 'История подборок по потребности' })
  async listSelections(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.matching.listSelections(await this.companies.requireCompany(auth.userId), id);
  }

  @Get('selections/:id')
  @ApiOperation({ summary: 'Сохранённая подборка с актуальной проверкой доступа к кандидатам' })
  async getSelection(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Query() query: PageQueryDto) {
    return this.matching.getSelection(await this.companies.requireCompany(auth.userId), id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Post('bookmarks/:candidateId')
  @ApiOperation({ summary: 'Добавить кандидата в закладки (идемпотентно)' })
  async addBookmark(@CurrentAuth() auth: AuthContext, @Param('candidateId', UuidPipe) candidateId: string) {
    return this.matching.addBookmark(await this.companies.requireCompany(auth.userId), candidateId);
  }

  @Delete('bookmarks/:candidateId')
  @ApiOperation({ summary: 'Убрать из закладок' })
  async removeBookmark(@CurrentAuth() auth: AuthContext, @Param('candidateId', UuidPipe) candidateId: string) {
    return this.matching.removeBookmark(await this.companies.requireCompany(auth.userId), candidateId);
  }

  @Get('bookmarks')
  @ApiOperation({ summary: 'Закладки с актуальной видимостью кандидатов' })
  async bookmarks(@CurrentAuth() auth: AuthContext) {
    return this.matching.bookmarks(await this.companies.requireCompany(auth.userId));
  }
}
