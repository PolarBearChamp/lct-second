import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, IsBoolean } from 'class-validator';
import { PageQueryDto } from '../../matching/dto/matching.dto';

export class SendInvitationDto {
  @ApiProperty()
  @IsUUID()
  candidateId!: string;

  /** Потребность, к которой относится предложение. Необязательно: публикация вакансии не требуется. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  needId?: string;

  @ApiProperty({ example: 'Backend-разработчик в команду платежей' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'Развитие API приёма платежей. Команда 6 человек, релизы раз в неделю.' })
  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  description!: string;

  /** ₽ в месяц до вычета налогов. */
  @ApiProperty({ example: 250000 })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryFrom!: number;

  @ApiProperty({ example: 320000 })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryTo!: number;

  @ApiProperty({ enum: ['GROSS'] })
  @Equals('GROSS', { message: 'Зарплата указывается до вычета налогов (GROSS)' })
  salaryType!: 'GROSS';

  @ApiProperty({ enum: ['REMOTE', 'HYBRID', 'OFFICE'] })
  @IsIn(['REMOTE', 'HYBRID', 'OFFICE'])
  workFormat!: 'REMOTE' | 'HYBRID' | 'OFFICE';

  /** Как кандидат может связаться с работодателем. */
  @ApiProperty({ enum: ['EMAIL', 'PHONE', 'MESSENGER'] })
  @IsIn(['EMAIL', 'PHONE', 'MESSENGER'])
  employerContactType!: 'EMAIL' | 'PHONE' | 'MESSENGER';

  @ApiProperty({ example: 'hr@example.com' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  employerContact!: string;

  /** Обязательно для кандидатов 16–17 лет: работодатель знает об особых условиях труда работников до 18 лет (ТК РФ, гл. 42). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  minorConditionsAcknowledged?: boolean;
}

export class AcceptInvitationDto {
  /** Кандидат подтверждает, что видел список данных, которые будут раскрыты компании. */
  @ApiProperty({ example: true })
  @Equals(true, { message: 'Подтвердите раскрытие контактов' })
  confirmDisclosure!: boolean;
}

export class DeclineInvitationDto {
  @ApiPropertyOptional({ enum: ['SALARY', 'FORMAT', 'NOT_INTERESTED', 'OTHER'] })
  @IsOptional()
  @IsIn(['SALARY', 'FORMAT', 'NOT_INTERESTED', 'OTHER'])
  reason?: 'SALARY' | 'FORMAT' | 'NOT_INTERESTED' | 'OTHER';
}

export class InvitationListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'ACTIVE'] })
  @IsOptional()
  @IsIn(['SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'ACTIVE'])
  status?: string;
}
