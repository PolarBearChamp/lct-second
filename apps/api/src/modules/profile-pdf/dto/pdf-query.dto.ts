import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class PdfQueryDto {
  /** Категория, которую показать в PDF (у кандидата может быть несколько подтверждённых); по умолчанию — активная. */
  @ApiPropertyOptional({ enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  @IsOptional()
  @IsIn(['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'])
  specialization?: string;
}
