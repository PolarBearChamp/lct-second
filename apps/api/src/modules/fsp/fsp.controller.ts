import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import type { AuthContext } from '../../common/request-context';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { CandidateProfilesService } from '../candidate-profiles/candidate-profiles.service';
import { FspService } from './fsp.service';

export class LinkFspDto {
  @ApiProperty({ example: 'FSP-DEMO-1001' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{4,40}$/, { message: 'ФСП ID: латиница, цифры и дефис' })
  fspId!: string;

  /** Одноразовый код подтверждения (в деморежиме — из фикстуры). */
  @ApiProperty({ example: '731905' })
  @IsString()
  @Length(4, 12)
  code!: string;
}

@ApiTags('candidate-fsp')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate/fsp-link')
export class FspController {
  constructor(
    private readonly fsp: FspService,
    private readonly profiles: CandidateProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Состояние привязки ФСП ID (демонстрационная интеграция)' })
  async state(@CurrentAuth() auth: AuthContext) {
    return this.fsp.state(await this.profiles.candidateIdOf(auth.userId));
  }

  @Post()
  @ApiOperation({ summary: 'Привязать ФСП ID по одноразовому коду и загрузить достижения' })
  @ApiResponse({ status: 409, description: 'FSP_ALREADY_LINKED | FSP_ID_TAKEN | FSP_CODE_USED' })
  @ApiResponse({ status: 422, description: 'FSP_CODE_INVALID' })
  async link(@CurrentAuth() auth: AuthContext, @Body() dto: LinkFspDto, @RequestId() requestId: string) {
    return this.fsp.link(await this.profiles.candidateIdOf(auth.userId), auth.userId, dto.fspId, dto.code, requestId);
  }

  @Delete()
  @ApiOperation({ summary: 'Отвязать ФСП ID: бонус ФСП и показ истории работодателям прекращаются' })
  async unlink(@CurrentAuth() auth: AuthContext, @RequestId() requestId: string) {
    return this.fsp.unlink(await this.profiles.candidateIdOf(auth.userId), auth.userId, requestId);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Обновить достижения через провайдер', description: 'При ошибке состояние SYNC_ERROR, последняя успешная история сохраняется.' })
  async sync(@CurrentAuth() auth: AuthContext, @RequestId() requestId: string) {
    return this.fsp.sync(await this.profiles.candidateIdOf(auth.userId), auth.userId, requestId);
  }
}
