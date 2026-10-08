import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpsertCompanyDto {
  @ApiProperty({ example: 'ООО «Пример Технологии»' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(3000)
  description?: string | null;

  /** Код отрасли из справочника. */
  @ApiPropertyOptional({ nullable: true, example: 'FINTECH' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(32)
  industry?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://example.com' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { message: 'Сайт должен начинаться с https://' })
  @MaxLength(200)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  contactPersonName?: string | null;

  @ApiProperty({ enum: ['EMAIL', 'PHONE', 'MESSENGER'] })
  @IsIn(['EMAIL', 'PHONE', 'MESSENGER'])
  contactChannelType!: 'EMAIL' | 'PHONE' | 'MESSENGER';

  @ApiProperty({ example: 'hr@example.com' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  contactValue!: string;
}

export class VerifyCompanyDto {
  @ApiProperty({ example: '0077010019', description: 'ИНН: 10 цифр (юрлицо) или 12 (ИП)' })
  @IsString()
  @Matches(/^\d{10}(\d{2})?$/, { message: 'ИНН — 10 или 12 цифр' })
  inn!: string;
}
