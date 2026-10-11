import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { parseEnv } from '../../config/env';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const env = parseEnv({
  DATABASE_URL: 'postgresql://u:p@localhost/db',
  APP_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'x'.repeat(40),
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
});

const mail = { to: 'recipient@example.com', subject: 'Verification', text: 'private token', html: '<p>private token</p>' };

describe('SMTP delivery failures', () => {
  const sendMail = jest.fn();
  beforeEach(() => {
    jest.mocked(createTransport).mockReturnValue({ sendMail } as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.restoreAllMocks(); sendMail.mockReset(); });

  it('returns a retryable error without exposing SMTP response or email content', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('secret password recipient@example.com'), { code: 'ETIMEDOUT' }));
    await expect(new MailService(env).send(mail)).rejects.toMatchObject({ status: 503, code: 'EMAIL_DELIVERY_FAILED' });
    const logs = JSON.stringify(jest.mocked(Logger.prototype.error).mock.calls);
    expect(logs).toContain('ETIMEDOUT');
    expect(logs).not.toMatch(/secret password|recipient@example.com|private token/);
  });

  it('reports success only after SMTP accepts the message', async () => {
    sendMail.mockResolvedValue({ accepted: [mail.to] });
    await expect(new MailService(env).send(mail)).resolves.toBeUndefined();
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });
});
