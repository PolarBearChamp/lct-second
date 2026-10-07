import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { UuidPipe } from '../../common/uuid.pipe';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CandidateProfilesService } from '../candidate-profiles/candidate-profiles.service';
import { CompaniesService } from '../companies/companies.service';
import { CandidateTasksService } from './candidate-tasks.service';
import { CreateTaskDto, ReviewSubmissionDto, SubmitTaskDto, TaskListQueryDto, TaskSubmissionsQueryDto, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('employer-tasks')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer')
export class EmployerTasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly companies: CompaniesService,
  ) {}

  @Post('tasks')
  @ApiOperation({
    summary: 'Создать короткое задание (черновик или сразу публикация)',
    description: 'QUIZ — 2–6 вариантов и один верный, проверяется автоматически; APPROACH — короткий текстовый разбор, оценивает автор. Опубликованное задание не редактируется.',
  })
  @ApiResponse({ status: 409, description: 'COMPANY_PROFILE_REQUIRED | TASK_LIMIT_REACHED' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  async create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTaskDto, @RequestId() requestId: string) {
    return this.tasks.create(await this.companies.requireCompany(auth.userId), auth.userId, dto, requestId);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Задания своей компании со счётчиками ответов' })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: TaskListQueryDto) {
    return this.tasks.list(await this.companies.requireCompany(auth.userId), query.status);
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Задание своей компании (верный ответ виден только автору)' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.tasks.employerView(await this.companies.requireCompany(auth.userId), id);
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Изменить черновик задания', description: 'Опубликованное и закрытое задание не редактируется (TASK_NOT_EDITABLE): ответы оцениваются по одному условию.' })
  @ApiResponse({ status: 409, description: 'TASK_NOT_EDITABLE' })
  async update(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: UpdateTaskDto, @RequestId() requestId: string) {
    return this.tasks.update(await this.companies.requireCompany(auth.userId), auth.userId, id, dto, requestId);
  }

  @Post('tasks/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Опубликовать задание (DRAFT → ACTIVE)', description: 'Повтор на активном задании идемпотентен. Одновременно активно не более 10 заданий компании.' })
  @ApiResponse({ status: 409, description: 'TASK_CLOSED | TASK_LIMIT_REACHED' })
  async publish(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.tasks.publish(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Post('tasks/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Закрыть задание (ACTIVE → CLOSED)', description: 'Неотвеченные предложения истекают; уже отправленные ответы остаются.' })
  @ApiResponse({ status: 409, description: 'TASK_NOT_ACTIVE — черновик нельзя закрыть' })
  async close(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.tasks.close(await this.companies.requireCompany(auth.userId), auth.userId, id, requestId);
  }

  @Get('tasks/:id/submissions')
  @ApiOperation({
    summary: 'Ответы кандидатов на задание',
    description: 'Псевдоним и подтверждённый грейд; ФИО и контакты не раскрываются. pendingOnly=true — только разборы без оценки.',
  })
  async submissions(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Query() query: TaskSubmissionsQueryDto) {
    return this.tasks.submissions(await this.companies.requireCompany(auth.userId), id, query);
  }

  @Post('task-submissions/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Оценить текстовый разбор кандидата', description: 'Оценка и комментарий видны кандидату. Повторная оценка заменяет предыдущую.' })
  @ApiResponse({ status: 409, description: 'TASK_AUTO_SCORED | SUBMISSION_NOT_SUBMITTED' })
  async review(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: ReviewSubmissionDto, @RequestId() requestId: string) {
    return this.tasks.review(await this.companies.requireCompany(auth.userId), auth.userId, id, dto, requestId);
  }
}

@ApiTags('candidate-tasks')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate/tasks')
export class CandidateTasksController {
  constructor(
    private readonly tasks: CandidateTasksService,
    private readonly profiles: CandidateProfilesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Короткие задания: текущее, история и регулярность',
    description:
      'Новое задание предлагается при открытии раздела, не чаще раза в 7 дней и только если нет неотвеченного. Задания подбираются по подтверждённой тестом квалификации и показываются кандидатам, которых видят работодатели. Выполнение не меняет подтверждённый грейд и не влияет на подбор.',
  })
  async overview(@CurrentAuth() auth: AuthContext) {
    return this.tasks.overview(await this.profiles.candidateIdOf(auth.userId), auth.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Задание (по идентификатору предложения); результат и верный вариант — только после ответа' })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.tasks.get(await this.profiles.candidateIdOf(auth.userId), id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отправить ответ', description: 'QUIZ — selectedIndex; APPROACH — answerText (20–2000 символов). Ответ видит автор задания под псевдонимом.' })
  @ApiResponse({ status: 409, description: 'TASK_ALREADY_SUBMITTED | TASK_EXPIRED | TASK_NOT_OPEN | PUBLICATION_REQUIRED' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  async submit(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @Body() dto: SubmitTaskDto, @RequestId() requestId: string) {
    return this.tasks.submit(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, dto, requestId);
  }

  @Post(':id/skip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Пропустить задание', description: 'Следующее задание предлагается не раньше чем через 7 дней после предыдущего предложения.' })
  @ApiResponse({ status: 409, description: 'TASK_NOT_OPEN' })
  async skip(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string, @RequestId() requestId: string) {
    return this.tasks.skip(await this.profiles.candidateIdOf(auth.userId), auth.userId, id, requestId);
  }
}
