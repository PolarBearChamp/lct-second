import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_ENV, type AppEnv } from '../../config/env';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Отправка писем через SMTP (локально — Mailpit). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({ from: this.env.MAIL_FROM, ...mail });
    // В лог не пишем адрес получателя и содержимое письма.
    this.logger.log(`Письмо «${mail.subject}» отправлено`);
  }

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const link = `${this.env.APP_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
    const hours = this.env.EMAIL_VERIFICATION_TTL_HOURS;
    await this.send({
      to,
      subject: 'Подтвердите адрес электронной почты',
      text: [
        'Здравствуйте!',
        '',
        'Чтобы завершить регистрацию на платформе подбора ИТ-специалистов, откройте ссылку и нажмите «Подтвердить»:',
        link,
        '',
        `Ссылка действует ${hours} ч. Если вы не регистрировались, просто проигнорируйте письмо.`,
      ].join('\n'),
      html: `<p>Здравствуйте!</p>
<p>Чтобы завершить регистрацию на платформе подбора ИТ-специалистов, откройте ссылку и нажмите «Подтвердить»:</p>
<p><a href="${link}">${link}</a></p>
<p>Ссылка действует ${hours}&nbsp;ч. Если вы не регистрировались, просто проигнорируйте письмо.</p>`,
    });
  }
}
