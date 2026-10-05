import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AppRequest, AuthContext } from '../../common/request-context';
import { MeResponseDto } from '../users/dto/me.dto';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { AllowUnverified, CurrentAuth, Public, RequestId } from './decorators';
import { CsrfTokenDto, LoginDto, RegisterDto, VerifyEmailDto } from './dto/auth.dto';
import { SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Выдать CSRF-токен', description: 'Устанавливает cookie fsp_csrf; значение нужно передавать в заголовке X-CSRF-Token для изменяющих запросов.' })
  csrf(@Res({ passthrough: true }) res: Response): CsrfTokenDto {
    return { csrfToken: this.sessions.issueCsrfToken(res) };
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Регистрация кандидата или работодателя', description: 'Создаёт аккаунт, сессию и отправляет письмо подтверждения email.' })
  @ApiResponse({ status: 201, type: MeResponseDto })
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_REGISTERED' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId: string,
  ): Promise<MeResponseDto & { verificationEmailSent: boolean }> {
    const { user, session, verificationEmailSent } = await this.auth.register(dto, req.ip ?? 'unknown', requestId);
    this.sessions.setSessionCookie(res, session.token, session.expiresAt);
    return { ...(await this.users.getMe(user.id)), verificationEmailSent };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход по email и паролю' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId: string,
  ): Promise<MeResponseDto> {
    const { user, session } = await this.auth.login(dto.email, dto.password, req.ip ?? 'unknown', requestId);
    this.sessions.setSessionCookie(res, session.token, session.expiresAt);
    return this.users.getMe(user.id);
  }

  @AllowUnverified()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Выход: отзыв текущей сессии' })
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response, @RequestId() requestId: string) {
    await this.auth.logout(auth.sessionId, auth.userId, requestId);
    this.sessions.clearSessionCookie(res);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить email одноразовым токеном из письма' })
  @ApiResponse({ status: 200, description: 'Email подтверждён' })
  @ApiResponse({ status: 400, description: 'VERIFICATION_TOKEN_INVALID' })
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: AppRequest, @RequestId() requestId: string): Promise<{ verified: true }> {
    await this.auth.verifyEmail(dto.token, req.ip ?? 'unknown', requestId);
    return { verified: true };
  }

  @AllowUnverified()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Повторно отправить письмо подтверждения' })
  @ApiResponse({ status: 202, description: 'Письмо отправлено' })
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_VERIFIED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async resend(@CurrentAuth() auth: AuthContext, @RequestId() requestId: string): Promise<{ sent: true }> {
    await this.auth.resendVerification(auth.userId, requestId);
    return { sent: true };
  }

  @AllowUnverified()
  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Текущий пользователь и состояние онбординга' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponseDto> {
    return this.users.getMe(auth.userId);
  }
}
