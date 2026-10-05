import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const SPECS = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] as const;
const GRADES = ['JUNIOR', 'MIDDLE', 'SENIOR'] as const;
const FORMATS = ['REMOTE', 'HYBRID', 'OFFICE'] as const;

export class PreferredSkillDto {
  @ApiProperty({ example: 'kafka' })
  @IsString()
  @MaxLength(64)
  skill!: string;

  @ApiProperty({ enum: ['SELF_REPORTED_ALLOWED', 'VERIFIED_ONLY'] })
  @IsIn(['SELF_REPORTED_ALLOWED', 'VERIFIED_ONLY'])
  mode!: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY';
}

export class CreateNeedDto {
  @ApiProperty({ example: 'Backend-разработчик в команду платежей' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'Команда развивает API приёма платежей: высокая нагрузка, идемпотентность, PostgreSQL.' })
  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  description!: string;

  @ApiProperty({ enum: SPECS })
  @IsIn(SPECS)
  specialization!: (typeof SPECS)[number];

  /** Явный список допустимых грейдов: Senior не считается автоматически подходящим для Junior. */
  @ApiProperty({ enum: GRADES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(GRADES, { each: true })
  allowedGrades!: Array<(typeof GRADES)[number]>;

  /** Обязательные навыки, которые должны быть подтверждены тестом. */
  @ApiProperty({ type: [String], example: ['sql', 'postgresql'] })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  requiredSkills!: string[];

  @ApiProperty({ type: [PreferredSkillDto] })
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => PreferredSkillDto)
  preferredSkills!: PreferredSkillDto[];

  @ApiProperty({ enum: FORMATS })
  @IsIn(FORMATS)
  workFormat!: (typeof FORMATS)[number];

  /** Обязателен для офисного и гибридного формата. */
  @ApiPropertyOptional({ nullable: true, example: 'Москва' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  /** Зарплата «от», ₽ в месяц до вычета налогов. */
  @ApiProperty({ example: 220000 })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryFrom!: number;

  @ApiProperty({ example: 320000 })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryTo!: number;

  /** Обязательное обозначение: суммы указаны до вычета налогов. */
  @ApiProperty({ enum: ['GROSS'] })
  @Equals('GROSS', { message: 'Зарплата указывается до вычета налогов (GROSS)' })
  salaryType!: 'GROSS';

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'])
  status?: 'DRAFT' | 'ACTIVE';
}

export class UpdateNeedDto extends PartialType(OmitType(CreateNeedDto, ['status'] as const)) {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED'])
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

export class AssessmentPreviewDto {
  @ApiPropertyOptional({ enum: GRADES })
  @IsOptional()
  @IsIn(GRADES)
  grade?: (typeof GRADES)[number];
}
