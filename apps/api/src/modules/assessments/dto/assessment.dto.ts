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
