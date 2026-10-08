import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const WORK_FORMATS = ['REMOTE', 'HYBRID', 'OFFICE'] as const;
export const AVAILABILITIES = ['ACTIVE', 'PAUSED'] as const;
export const CONTACT_CHANNELS = ['EMAIL', 'PHONE', 'MESSENGER'] as const;
export const GRADES = ['JUNIOR', 'MIDDLE', 'SENIOR'] as const;
export const SPECIALIZATION_CODES_DTO = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] as const;

export class SkillInputDto {
  @ApiProperty({ example: 'postgresql' })
  @IsString()
  @MaxLength(64)
  code!: string;

  /** Опыт с навыком, месяцы (самоописание). */
  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  months?: number | null;
}

/** Частичное обновление собственного профиля. Отсутствующее поле не меняется; null очищает значение. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'Укажите корректный контактный email' })
  @MaxLength(254)
  contactEmail?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+7 900 123-45-67' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\+?[0-9()\-\s]{7,20}$/, { message: 'Телефон: цифры, пробелы, скобки и дефисы, 7–20 символов' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '@my_handle' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  messenger?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Europe/Moscow' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @ApiPropertyOptional({ enum: WORK_FORMATS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(WORK_FORMATS, { each: true })
  workFormats?: Array<(typeof WORK_FORMATS)[number]>;

  @ApiPropertyOptional({ enum: AVAILABILITIES })
  @IsOptional()
  @IsIn(AVAILABILITIES)
  availability?: (typeof AVAILABILITIES)[number];

  /** Ожидаемая зарплата «от», ₽ в месяц до вычета налогов. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryFrom?: number | null;

  /** Ожидаемая зарплата «до», ₽ в месяц до вычета налогов. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryTo?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  industries?: string[];

  @ApiPropertyOptional({ enum: SPECIALIZATION_CODES_DTO, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SPECIALIZATION_CODES_DTO)
  activeSpecialization?: (typeof SPECIALIZATION_CODES_DTO)[number] | null;

  /** Заявленный кандидатом грейд (не является подтверждением). */
  @ApiPropertyOptional({ enum: GRADES, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(GRADES)
  declaredGrade?: (typeof GRADES)[number] | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(600)
  experienceMonths?: number | null;

  @ApiPropertyOptional({ nullable: true, example: '1998-04-21', description: 'Дата рождения (ГГГГ-ММ-ДД). Работодатели видят только признак «16–17 лет».' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата в формате ГГГГ-ММ-ДД' })
  birthDate?: string | null;

  @ApiPropertyOptional({ type: [SkillInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SkillInputDto)
  skills?: SkillInputDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  teamRoles?: string[];

  /** Свободное описание опыта. Никогда не показывается работодателю до принятия приглашения. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(3000)
  experienceDescription?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  softSkills?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { each: true, message: 'Ссылки должны начинаться с https://' })
  externalLinks?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDiscoverable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showSalaryToEmployers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showFspToEmployers?: boolean;

  /** Каналы связи, которые будут раскрыты компании после принятия её приглашения. */
  @ApiPropertyOptional({ enum: CONTACT_CHANNELS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CONTACT_CHANNELS, { each: true })
  disclosureChannels?: Array<(typeof CONTACT_CHANNELS)[number]>;
}

export class SurveyAnswersDto {
  /** Ответы опроса: код вопроса → код варианта или массив кодов. */
  @ApiProperty({ example: { focus: 'SERVER', industries: ['FINTECH'], recentTasks: ['API', 'DB'], experience: 'Y1_3', autonomy: 'INDEPENDENT' } })
  @IsObject()
  answers!: Record<string, string | string[]>;
}

export class GuardianConsentDto {
  /** Законный представитель кандидата 16–17 лет согласен на публикацию профиля и рассмотрение предложений. */
  @ApiProperty()
  @IsBoolean()
  consent!: boolean;

  @ApiPropertyOptional({ maxLength: 120, description: 'ФИО законного представителя (обязательно при даче согласия). Работодателям не показывается.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  guardianName?: string;
}

export class UpdateConsentsDto {
  /** Согласие на публикацию обезличенного профиля работодателям. */
  @ApiProperty()
  @IsBoolean()
  profilePublication!: boolean;
}
