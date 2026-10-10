import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class StartAssessmentDto {
  @ApiProperty({ enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  @IsIn(['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'])
  specialization!: 'FRONTEND' | 'BACKEND' | 'ML_ENGINEER' | 'MANUAL_QA';

  @ApiProperty({ enum: ['JUNIOR', 'MIDDLE', 'SENIOR'] })
  @IsIn(['JUNIOR', 'MIDDLE', 'SENIOR'])
  grade!: 'JUNIOR' | 'MIDDLE' | 'SENIOR';
}

export class SaveAnswerDto {
  /** Ответ на задание: { parts: { [partId]: { optionId } | { optionIds } | { value } | { pairs } | { order } | null } }. */
  @ApiProperty({ example: { parts: { p1: { optionId: 'oAbC123' }, p2: { value: 42 } } } })
  @IsObject()
  answer!: Record<string, unknown>;

  /** Монотонно растущий номер ревизии ответа (клиентский счётчик правок). */
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  revision!: number;
}

/** Агрегированные сигналы интерфейса теста за период (без содержимого ответов). */
export class AssessmentSignalsDto {
  @ApiPropertyOptional({ description: 'Сколько раз вкладка стала скрытой', maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  tabHiddenCount?: number;

  @ApiPropertyOptional({ description: 'Суммарное время со скрытой вкладкой, мс', maximum: 1_800_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_800_000)
  tabHiddenMs?: number;

  @ApiPropertyOptional({ description: 'Вставки текста из буфера в поля ответа', maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  pasteCount?: number;

  @ApiPropertyOptional({ description: 'Копирование текста задания', maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  copyCount?: number;

  @ApiPropertyOptional({ description: 'Потери фокуса окна (информационно)', maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  focusLossCount?: number;
}

export class FinalAnswerDto extends SaveAnswerDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;
}

export class SubmitAssessmentDto {
  /** Актуальные ответы, которые ещё не были сохранены автосохранением. */
  @ApiPropertyOptional({ type: [FinalAnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FinalAnswerDto)
  answers?: FinalAnswerDto[];
}
