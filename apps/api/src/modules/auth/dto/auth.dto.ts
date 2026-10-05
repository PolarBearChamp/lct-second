import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEmail, IsIn, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  /** Email для входа и уведомлений. */
  @ApiProperty({ example: 'new.candidate@example.com' })
  @IsEmail({}, { message: 'Укажите корректный email' })
  @MaxLength(254)
  email!: string;

  /** Пароль: от 10 до 128 символов. */
  @ApiProperty({ example: 'Strong-Password-2026', minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10, { message: 'Пароль должен содержать не менее 10 символов' })
  @MaxLength(128, { message: 'Пароль слишком длинный' })
  password!: string;

  @ApiProperty({ enum: ['CANDIDATE', 'EMPLOYER'] })
  @IsIn(['CANDIDATE', 'EMPLOYER'], { message: 'Выберите роль: кандидат или работодатель' })
  role!: 'CANDIDATE' | 'EMPLOYER';

  /** Согласие на обработку персональных данных (обязательно). */
  @ApiProperty({ example: true })
  @Equals(true, { message: 'Необходимо согласие на обработку персональных данных' })
  acceptPrivacyPolicy!: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'candidate.demo@demo.example' })
  @IsEmail({}, { message: 'Укажите корректный email' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Demo-Password-2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  /** Одноразовый токен из письма. */
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class CsrfTokenDto {
  @ApiProperty()
  csrfToken!: string;
}
