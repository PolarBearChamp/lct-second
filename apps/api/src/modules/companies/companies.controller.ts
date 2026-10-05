import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/request-context';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CompaniesService } from './companies.service';
import { UpsertCompanyDto } from './dto/company.dto';

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
  @ApiOperation({ summary: 'Создать или обновить профиль компании', description: 'Компания не верифицируется в MVP и не отображается как проверенная.' })
  upsert(@CurrentAuth() auth: AuthContext, @Body() dto: UpsertCompanyDto, @RequestId() requestId: string) {
    return this.companies.upsert(auth.userId, dto, requestId);
  }
}
