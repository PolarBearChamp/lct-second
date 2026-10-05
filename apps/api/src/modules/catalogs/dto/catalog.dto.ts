import { ApiProperty } from '@nestjs/swagger';

export class CodeTitleDto {
  code!: string;
  title!: string;
}

export class SpecializationDto {
  @ApiProperty({ enum: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] })
  code!: string;
  title!: string;
  description!: string;
  @ApiProperty({ type: [CodeTitleDto] })
  groups!: CodeTitleDto[];
}

export class SkillDto {
  code!: string;
  title!: string;
  category!: string;
  @ApiProperty({ type: [String] })
  specializations!: string[];
  /** Специализации, в тестах которых навык проверяется заданиями. Пусто — только самоописание. */
  @ApiProperty({ type: [String] })
  assessableIn!: string[];
}

export class ReferenceDto {
  @ApiProperty({ type: [CodeTitleDto] })
  industries!: CodeTitleDto[];
  @ApiProperty({ type: [CodeTitleDto] })
  teamRoles!: CodeTitleDto[];
  @ApiProperty({ type: [CodeTitleDto] })
  softSkills!: CodeTitleDto[];
  @ApiProperty({ type: [CodeTitleDto] })
  timezones!: CodeTitleDto[];
  @ApiProperty({ type: [CodeTitleDto] })
  workFormats!: CodeTitleDto[];
  @ApiProperty({ type: [CodeTitleDto] })
  grades!: CodeTitleDto[];
}

export class SurveyOptionDto {
  code!: string;
  title!: string;
}

export class SurveyQuestionDto {
  code!: string;
  title!: string;
  @ApiProperty({ required: false })
  hint?: string;
  @ApiProperty({ enum: ['single', 'multi'] })
  kind!: 'single' | 'multi';
  @ApiProperty({ type: [SurveyOptionDto] })
  options!: SurveyOptionDto[];
  required!: boolean;
}

export class SurveyDto {
  version!: string;
  @ApiProperty({ type: [SurveyQuestionDto] })
  questions!: SurveyQuestionDto[];
}
