import { expect } from '@playwright/test';
import { MAILPIT_URL } from './env';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

/** Ждёт письмо подтверждения для адреса и возвращает ссылку из него. Письма читаются через API Mailpit. */
export async function waitForVerificationLink(email: string): Promise<{ url: string; token: string }> {
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
        const body = (await response.json()) as { messages?: MailpitMessage[] };
        found = body.messages?.[0];
        return Boolean(found);
      },
      { message: `Письмо для ${email} не пришло в Mailpit`, timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`)).json()) as { Text: string; HTML: string };
  const match = `${detail.Text}\n${detail.HTML}`.match(/https?:\/\/[^\s"'<>]+\/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('В письме нет ссылки подтверждения');
  return { url: match[0], token: match[1] };
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}
