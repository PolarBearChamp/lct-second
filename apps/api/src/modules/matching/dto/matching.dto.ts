import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(value) ? value : value;
const bool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

/** Фильтры общего банка. Списки передаются через запятую: grades=MIDDLE,SENIOR. */
export class BankQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  @IsOptional()
  @IsIn(['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'])
  specialization?: string;

  @ApiPropertyOptional({ description: 'Через запятую: JUNIOR,MIDDLE,SENIOR' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayUnique()
  @IsIn(['JUNIOR', 'MIDDLE', 'SENIOR'], { each: true })
  grades?: Array<'JUNIOR' | 'MIDDLE' | 'SENIOR'>;

  /** Категория «специализация:грейд», например BACKEND:MIDDLE. */
  @ApiPropertyOptional({ example: 'BACKEND:MIDDLE' })
  @IsOptional()
  @Matches(/^(FRONTEND|BACKEND|ML_ENGINEER|MANUAL_QA):(JUNIOR|MIDDLE|SENIOR|UNCONFIRMED)$/)
  category?: string;

  @ApiPropertyOptional({ description: 'Коды навыков через запятую' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ enum: ['VERIFIED', 'ANY'], description: 'VERIFIED — только подтверждённые тестом навыки' })
  @IsOptional()
  @IsIn(['VERIFIED', 'ANY'])
  skillSource?: 'VERIFIED' | 'ANY';

  @ApiPropertyOptional({ enum: ['REMOTE', 'HYBRID', 'OFFICE'] })
  @IsOptional()
  @IsIn(['REMOTE', 'HYBRID', 'OFFICE'])
  workFormat?: 'REMOTE' | 'HYBRID' | 'OFFICE';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  hasFsp?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Показывать кандидатов без подтверждённого тестом грейда (после подтверждённых своей специализации, с пометкой)' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  includeUnconfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

export class CandidateQueryDto {
  /** Показать квалификацию этой специализации (у кандидата может быть несколько категорий). Потребность имеет приоритет. */
  @ApiPropertyOptional({ enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  @IsOptional()
  @IsIn(['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'])
  specialization?: string;

  /** Если задано — в ответ добавляется объяснение соответствия этой потребности. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  needId?: string;
}

export class RefinementsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onlyWithFsp?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minOverallScore?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  extraRequiredSkills?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  cities?: string[];
}

export class CreateSelectionDto {
  @ApiPropertyOptional({ type: RefinementsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RefinementsDto)
  refinements?: RefinementsDto;

  /** Подборка-родитель: уточнение создаёт новую версию, предыдущая остаётся в истории. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentRunId?: string;
}
