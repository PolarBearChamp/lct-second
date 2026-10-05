import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { AssessmentPreviewDto, CreateNeedDto, UpdateNeedDto } from './dto/need.dto';
import { HiringNeedsService } from './hiring-needs.service';

@ApiTags('employer-needs')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer/needs')
export class HiringNeedsController {
  constructor(
    private readonly needs: HiringNeedsService,
    private readonly companies: CompaniesService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Создать потребность в специалисте', description: 'Внутреннее описание; публикация вакансии не требуется.' })
  @ApiResponse({ status: 409, description: 'COMPANY_PROFILE_REQUIRED' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED — в т. ч. обязательный навык, который не проверяется тестами' })
  async create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateNeedDto, @RequestId() requestId: string) {
    return this.needs.create(await this.companies.requireCompany(auth.userId), auth.userId, dto, requestId);
  }

  @Get()
  @ApiOperation({ summary: 'Потребности своей компании' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  async list(@CurrentAuth() auth: AuthContext, @Query('status') status?: string) {
    const valid = status && ['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status) ? status : undefined;
    return this.needs.list(await this.companies.requireCompany(auth.userId), valid);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Потребность своей компании' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.needs.get(await this.companies.requireCompany(auth.userId), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить потребность (создаёт новую версию)' })
  async update(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: UpdateNeedDto, @RequestId() requestId: string) {
    return this.needs.update(await this.companies.requireCompany(auth.userId), auth.userId, id, dto, requestId);
  }

  @Post(':id/assessment-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'План теста под требования и покрытие требований заданиями',
    description: 'buildAssessmentBlueprint(need, grade): «требование → навык → семейство», непокрытые требования и образцы условий без ответов.',
  })
  async preview(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: AssessmentPreviewDto) {
    return this.needs.assessmentPreview(await this.companies.requireCompany(auth.userId), id, dto.grade);
  }
}
