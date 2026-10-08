import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../matching/dto/matching.dto';

const SPECS = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] as const;
const GRADES = ['JUNIOR', 'MIDDLE', 'SENIOR'] as const;
const KINDS = ['QUIZ', 'APPROACH'] as const;
const STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
const VERDICTS = ['STRONG', 'ACCEPTABLE', 'WEAK'] as const;

export class CreateTaskDto {
  @ApiProperty({ example: 'Идемпотентность платежного запроса' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'Клиент повторил POST /payments из-за таймаута. Как избежать двойного списания?' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  prompt!: string;

  @ApiProperty({ enum: SPECS })
  @IsIn(SPECS)
  specialization!: (typeof SPECS)[number];

  @ApiPropertyOptional({ enum: GRADES, isArray: true, description: 'Пусто или не указано — любой подтверждённый грейд специализации' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(GRADES, { each: true })
  allowedGrades?: Array<(typeof GRADES)[number]>;

  @ApiProperty({ enum: KINDS, description: 'QUIZ — один верный вариант, оценивается автоматически; APPROACH — короткий текстовый разбор, оценивает автор' })
  @IsIn(KINDS)
  kind!: (typeof KINDS)[number];

  @ApiPropertyOptional({ type: [String], description: 'Только QUIZ: 2–6 вариантов' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  options?: string[];

  @ApiPropertyOptional({ description: 'Только QUIZ: индекс верного варианта (с нуля)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  correctIndex?: number;

  @ApiPropertyOptional({ description: 'Пояснение, которое кандидат увидит после ответа', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string | null;

  @ApiPropertyOptional({ description: 'Срок приёма ответов (ISO 8601); после него предложения истекают', example: '2026-12-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deadlineAt?: string | null;

  @ApiPropertyOptional({ default: false, description: 'true — сразу опубликовать (иначе черновик)' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/** Редактируется только черновик; статус меняется отдельными действиями. */
export class UpdateTaskDto extends PartialType(OmitType(CreateTaskDto, ['publish'] as const)) {}

export class TaskListQueryDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class TaskSubmissionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Только ответы без оценки автора (текстовые разборы)' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  pendingOnly?: boolean;
}

export class ReviewSubmissionDto {
  @ApiProperty({ enum: VERDICTS })
  @IsIn(VERDICTS)
  verdict!: (typeof VERDICTS)[number];

  @ApiPropertyOptional({ maxLength: 500, description: 'Комментарий увидит кандидат' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}

export class AssignTaskDto {
  @ApiProperty({ description: 'Кандидат, которому отправляется задание' })
  @IsUUID()
  candidateId!: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Сообщение кандидату (видно ему вместе с заданием)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SubmitTaskDto {
  @ApiPropertyOptional({ description: 'QUIZ: индекс выбранного варианта' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  selectedIndex?: number;

  @ApiPropertyOptional({ maxLength: 2000, description: 'APPROACH: текст разбора (20–2000 символов)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  answerText?: string;
}
