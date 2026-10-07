import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { unprocessable } from '../../common/errors';
import { RATE_LIMITS, RateLimitService } from '../../common/rate-limit.service';
import { countRecognized, parseResume, type ResumeSuggestion } from '../../domain/resume/parse';
import { AuditService } from '../audit/audit.service';
import { extractPdfText } from './pdf-text';

export interface ResumeAnalysis {
  /** Предложения для профиля: ничего не применено, кандидат проверяет каждое поле. */
  suggestion: ResumeSuggestion;
  source: { pages: number; characters: number; truncated: boolean; recognizedFields: number };
  notice: string;
}

/**
 * Автораспознавание PDF-резюме. Файл обрабатывается в памяти и не сохраняется; в журнал аудита попадают только счётчики,
 * без содержимого. Результат — черновик изменений профиля: применяет его кандидат обычным обновлением профиля.
 */
@Injectable()
export class ResumeService {
  constructor(
    private readonly clock: Clock,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async analyze(userId: string, file: Buffer, requestId: string): Promise<ResumeAnalysis> {
    this.rateLimit.consume(`resume:${userId}`, RATE_LIMITS.resumePerUser);
    const { text, pages, truncated } = await extractPdfText(file);
    if (text.replace(/\s+/g, '').length < 30) {
      throw unprocessable(
        'RESUME_NO_TEXT',
        'В PDF не найден текст. Похоже, это скан или картинка: распознавание изображений (OCR) не выполняется. Загрузите PDF с текстовым слоем или заполните профиль вручную.',
      );
    }
    const suggestion = parseResume(text, this.clock.now());
    const recognizedFields = countRecognized(suggestion);
    await this.audit.record({
      actorUserId: userId,
      action: 'candidate.resume_parsed',
      objectType: 'CandidateProfile',
      objectId: null,
      requestId,
      metadata: { pages, bytes: file.length, recognizedFields },
    });
    return {
      suggestion,
      source: { pages, characters: text.length, truncated, recognizedFields },
      notice:
        'Распознавание выполнено правилами и словарями платформы (без ML и внешних сервисов), файл не сохранён. Проверьте каждое поле перед применением: навыки, стаж и грейд — самоописание, подтверждённой категорией они не становятся.',
    };
  }
}
