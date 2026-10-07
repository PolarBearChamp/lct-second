import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '../../common/errors';
import type { AuthContext } from '../../common/request-context';
import { CurrentAuth, RequestId, Roles } from '../auth/decorators';
import { ResumeService } from './resume.service';

@ApiTags('candidate')
@ApiCookieAuth()
@Roles('CANDIDATE')
@Controller('candidate/profile')
export class ResumeController {
  constructor(private readonly resume: ResumeService) {}

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Автораспознавание PDF-резюме: предложения для профиля (ФИО, контакты, стек, грейд, роли, стаж, soft skills)',
    description:
      'Тело запроса — сам PDF (Content-Type: application/pdf, до 5 МБ, до 10 страниц). Файл не сохраняется. Возвращает предложения, ничего не применяет: ' +
      'кандидат проверяет поля и применяет их обычным PATCH /candidate/profile. OCR не выполняется — нужен PDF с текстовым слоем.',
  })
  @ApiConsumes('application/pdf')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 413, description: 'PAYLOAD_TOO_LARGE — файл больше 5 МБ' })
  @ApiResponse({ status: 415, description: 'UNSUPPORTED_MEDIA_TYPE — не application/pdf' })
  @ApiResponse({ status: 422, description: 'RESUME_NOT_PDF | RESUME_ENCRYPTED | RESUME_UNREADABLE | RESUME_NO_TEXT' })
  async analyze(@CurrentAuth() auth: AuthContext, @Req() req: Request, @RequestId() requestId: string) {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE', 'Отправьте PDF-файл с заголовком Content-Type: application/pdf');
    }
    return this.resume.analyze(auth.userId, body, requestId);
  }
}
