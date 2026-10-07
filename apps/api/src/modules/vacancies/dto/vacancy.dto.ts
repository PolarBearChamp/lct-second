import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CreateNeedDto } from '../../hiring-needs/dto/need.dto';
import { PageQueryDto } from '../../matching/dto/matching.dto';

const bool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

/**
 * Вакансия описывается теми же структурированными требованиями, что и потребность (специализация, допустимые грейды,
 * обязательные и желательные навыки, формат, вилка GROSS), поэтому отклик оценивается тем же правилом подбора.
 */
export class CreateVacancyDto extends OmitType(CreateNeedDto, ['status'] as const) {
  /** Потребность, из которой создаётся вакансия (необязательно; связь информационная). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  needId?: string;

  /** true — сразу опубликовать (иначе вакансия остаётся черновиком). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/** Статус меняется только явными действиями «опубликовать» и «закрыть». */
export class UpdateVacancyDto extends PartialType(OmitType(CreateVacancyDto, ['needId', 'publish'] as const)) {}

export class VacancyListQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'CLOSED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'CLOSED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
}

/** Фильтры общего списка вакансий для кандидата. */
export class CandidateVacancyQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  @IsOptional()
  @IsIn(['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'])
  specialization?: string;

  @ApiPropertyOptional({ enum: ['REMOTE', 'HYBRID', 'OFFICE'] })
  @IsOptional()
  @IsIn(['REMOTE', 'HYBRID', 'OFFICE'])
  workFormat?: 'REMOTE' | 'HYBRID' | 'OFFICE';

  @ApiPropertyOptional({ enum: ['JUNIOR', 'MIDDLE', 'SENIOR'], description: 'Только вакансии, где этот грейд входит в допустимые' })
  @IsOptional()
  @IsIn(['JUNIOR', 'MIDDLE', 'SENIOR'])
  grade?: 'JUNIOR' | 'MIDDLE' | 'SENIOR';

  @ApiPropertyOptional({ description: 'Город (точное совпадение без учёта регистра); удалённые вакансии подходят любому городу' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Поиск по названию и описанию' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Только вакансии по специализации, подтверждённой у кандидата' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  onlyMine?: boolean;
}

export class ApplyDto {
  /** Кандидат подтверждает, что видел список данных, которые будут раскрыты компании. */
  @ApiProperty({ example: true })
  @Equals(true, { message: 'Подтвердите раскрытие контактов' })
  confirmDisclosure!: boolean;

  /** Сопроводительное сообщение (необязательно). Показывается только компании-получателю. */
  @ApiPropertyOptional({ maxLength: 1000, example: 'Работал с платёжными API, готов обсудить детали.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  coverNote?: string;
}

export class WithdrawApplicationDto {
  /** Закрыть компании доступ к контактам вместе с отзывом отклика (по умолчанию доступ сохраняется до явного отзыва). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  revokeContactAccess?: boolean;
}

export class CandidateApplicationQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['SENT', 'VIEWED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN', 'ACTIVE'] })
  @IsOptional()
  @IsIn(['SENT', 'VIEWED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN', 'ACTIVE'])
  status?: string;
}

export class VacancyApplicationsQueryDto extends CandidateApplicationQueryDto {
  @ApiPropertyOptional({ enum: ['FIT', 'DATE'], default: 'FIT', description: 'FIT — по соответствию требованиям вакансии, DATE — по дате отклика' })
  @IsOptional()
  @IsIn(['FIT', 'DATE'])
  sort?: 'FIT' | 'DATE';
}
