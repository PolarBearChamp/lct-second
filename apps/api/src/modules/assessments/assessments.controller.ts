import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { badRequest } from '../../common/errors';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import type { ItemAnswer } from '../../domain/assessment/types';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CandidateProfilesService } from '../candidate-profiles/candidate-profiles.service';
import { AssessmentsService } from './assessments.service';
import { AssessmentSignalsDto, SaveAnswerDto, StartAssessmentDto, SubmitAssessmentDto } from './dto/assessment.dto';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

@ApiTags('candidate-assessments')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate/assessments')
export class AssessmentsController {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly profiles: CandidateProfilesService,
  ) {}

  @Get('eligibility')
  @ApiOperation({ summary: 'Можно ли начать тест по каждому грейду и почему', description: 'Возвращает точную причину запрета и дату следующей доступной попытки.' })
  @ApiQuery({ name: 'specialization', enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  async eligibility(@CurrentAuth() auth: AuthContext, @Query('specialization') specialization: string) {
    return this.assessments.eligibility(await this.profiles.candidateIdOf(auth.userId), specialization);
  }

  @Post()
  @ApiOperation({
    summary: 'Начать новую попытку',
    description: 'Создаёт попытку и неизменяемые снимки заданий транзакционно. Заголовок Idempotency-Key защищает от дублей при повторной отправке.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 201, description: 'Попытка создана' })
  @ApiResponse({ status: 200, description: 'Попытка с этим Idempotency-Key уже создана' })
  @ApiResponse({ status: 409, description: 'ASSESSMENT_NOT_ALLOWED — активная попытка, задержка пересдачи или срок переоценки' })
  async start(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: StartAssessmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId: string,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key: 8–64 символа [A-Za-z0-9_-]');
    }
    const candidateId = await this.profiles.candidateIdOf(auth.userId);
    const { attempt, created } = await this.assessments.start(candidateId, auth.userId, dto.specialization, dto.grade, idempotencyKey, requestId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return attempt;
  }

  @Get()
  @ApiOperation({ summary: 'История попыток' })
  async list(@CurrentAuth() auth: AuthContext) {
    return this.assessments.list(await this.profiles.candidateIdOf(auth.userId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Публичные условия своей попытки и сохранённые сервером ответы', description: 'Закрытые ключи проверки не передаются.' })
  @ApiResponse({ status: 404, description: 'ATTEMPT_NOT_FOUND' })
  async view(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.assessments.view(await this.profiles.candidateIdOf(auth.userId), id);
  }

  @Put(':id/answers/:itemId')
  @ApiOperation({ summary: 'Автосохранение ответа с ревизией', description: 'Устаревшая ревизия получает 409 STALE_REVISION и текущий сохранённый вариант.' })
  @ApiResponse({ status: 409, description: 'STALE_REVISION | ATTEMPT_EXPIRED | ATTEMPT_NOT_ACTIVE' })
  @ApiResponse({ status: 422, description: 'ANSWER_INVALID' })
  async saveAnswer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('itemId', UuidPipe) itemId: string,
    @Body() dto: SaveAnswerDto,
  ) {
    return this.assessments.saveAnswer(await this.profiles.candidateIdOf(auth.userId), id, itemId, dto.answer, dto.revision);
  }

  @Post(':id/signals')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Сигналы честности прохождения теста (агрегированные счётчики интерфейса)',
    description:
      'Интерфейс теста присылает раз в ~20 секунд, сколько раз скрывалась вкладка, сколько вставок и копирований было. Содержимое не передаётся. Сигналы информационные: на баллы и грейд не влияют, итог оценивается при завершении попытки и виден кандидату и работодателю.',
  })
  @ApiResponse({ status: 409, description: 'ATTEMPT_NOT_ACTIVE | ATTEMPT_EXPIRED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async signals(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: AssessmentSignalsDto): Promise<void> {
    await this.assessments.recordSignals(await this.profiles.candidateIdOf(auth.userId), id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Завершить попытку', description: 'Сначала сохраняет переданные актуальные ответы, затем фиксирует результат. Повторный вызов возвращает тот же результат.' })
  async submit(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: SubmitAssessmentDto, @RequestId() requestId: string) {
    const candidateId = await this.profiles.candidateIdOf(auth.userId);
    const answers = (dto.answers ?? []).map((a) => ({ itemId: a.itemId.toLowerCase(), answer: a.answer as unknown as ItemAnswer, revision: a.revision }));
    return this.assessments.submit(candidateId, auth.userId, id, answers, requestId);
  }

  @Post(':id/abandon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Прервать попытку', description: 'Статус ABANDONED; задержка пересдачи действует так же, как после неуспеха.' })
  async abandon(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.assessments.abandon(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, requestId);
  }

  @Get(':id/result')
  @ApiOperation({ summary: 'Результат попытки: баллы групп, статус, навыки, рекомендации (без ключей проверки)' })
  @ApiResponse({ status: 409, description: 'ATTEMPT_IN_PROGRESS' })
  async result(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.assessments.result(await this.profiles.candidateIdOf(auth.userId), id);
  }
}
