import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { ProfileViewService } from '../profile-view/profile-view.service';
import { CandidateProfilesService } from './candidate-profiles.service';
import { SurveyAnswersDto, GuardianConsentDto, UpdateConsentsDto, UpdateProfileDto } from './dto/profile.dto';

@ApiTags('candidate')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate')
export class CandidateProfilesController {
  constructor(
    private readonly profiles: CandidateProfilesService,
    private readonly views: ProfileViewService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Собственный профиль кандидата: поля, согласия, условия попадания в поиск' })
  getProfile(@CurrentAuth() auth: AuthContext) {
    return this.profiles.getOwnProfile(auth.userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Частичное обновление профиля', description: 'Самоописанные данные не становятся подтверждёнными.' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  updateProfile(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto, @RequestId() requestId: string) {
    return this.profiles.update(auth.userId, dto, requestId);
  }

  @Get('profile/preview')
  @ApiOperation({ summary: 'Как профиль видит работодатель без доступа к контактам (обезличенная карточка)' })
  async preview(@CurrentAuth() auth: AuthContext) {
    return this.views.redactedPreview(await this.profiles.candidateIdOf(auth.userId));
  }

  @Put('survey')
  @ApiOperation({ summary: 'Сохранить ответы онбордингового опроса', description: 'Возвращает рекомендацию специализации и заявленного грейда.' })
  @ApiResponse({ status: 422, description: 'SURVEY_INVALID' })
  saveSurvey(@CurrentAuth() auth: AuthContext, @Body() dto: SurveyAnswersDto, @RequestId() requestId: string) {
    return this.profiles.saveSurvey(auth.userId, dto.answers, requestId);
  }

  @Put('consents')
  @ApiOperation({ summary: 'Явное изменение согласия на публикацию профиля (с историей)' })
  updateConsents(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateConsentsDto, @RequestId() requestId: string) {
    return this.profiles.updateConsents(auth.userId, dto, requestId);
  }

  @Put('consents/guardian')
  @ApiOperation({
    summary: 'Согласие законного представителя (кандидаты 16–17 лет)',
    description:
      'Нужно для публикации профиля кандидата 16–17 лет. В MVP — заявление кандидата с ФИО представителя; подтверждение самим представителем вне MVP. Отзыв скрывает профиль из поиска.',
  })
  @ApiResponse({ status: 409, description: 'GUARDIAN_CONSENT_NOT_APPLICABLE — кандидату не 16–17 лет или не указана дата рождения' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  updateGuardianConsent(@CurrentAuth() auth: AuthContext, @Body() dto: GuardianConsentDto, @RequestId() requestId: string) {
    return this.profiles.updateGuardianConsent(auth.userId, dto, requestId);
  }

  @Get('qualifications')
  @ApiOperation({ summary: 'Подтверждённые квалификации и неизменяемая история подтверждений' })
  qualifications(@CurrentAuth() auth: AuthContext) {
    return this.profiles.qualifications(auth.userId);
  }
}
