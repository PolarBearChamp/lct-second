import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CompaniesService } from './companies.service';
import { UpsertCompanyDto, VerifyCompanyDto } from './dto/company.dto';

@ApiTags('employer')
@ApiCookieAuth()
@Roles('EMPLOYER')
@Controller('employer/company')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @ApiOperation({ summary: 'Профиль собственной компании (null, если ещё не заполнен)' })
  get(@CurrentAuth() auth: AuthContext) {
    return this.companies.getOwn(auth.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Создать или обновить профиль компании', description: 'Смена названия снимает метку доверия: проверку нужно пройти заново.' })
  upsert(@CurrentAuth() auth: AuthContext, @Body() dto: UpsertCompanyDto, @RequestId() requestId: string) {
    return this.companies.upsert(auth.userId, dto, requestId);
  }

  @Post('verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Добровольная проверка компании (метка доверия)',
    description:
      'Проверяются ИНН (контрольные разряды), наличие организации в реестре, совпадение названия и домена почты аккаунта с доменом организации. В MVP реестр демонстрационный. Результат не блокирует основной сценарий; кандидаты видят метку «Компания проверена».',
  })
  @ApiResponse({ status: 409, description: 'COMPANY_PROFILE_REQUIRED' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  verify(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyCompanyDto, @RequestId() requestId: string) {
    return this.companies.verify(auth.userId, dto, requestId);
  }
}
