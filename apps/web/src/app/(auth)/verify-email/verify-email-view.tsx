'use client';

import type { MeResponse } from '@fsp/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoutButton } from '@/components/layout/logout-button';
import { Alert } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api/client';

/**
 * Экран подтверждения. Переход по ссылке из письма ничего не меняет сам по себе (GET безопасен):
 * подтверждение выполняется явным POST по нажатию кнопки.
 */
export function VerifyEmailView({ token, me }: { token: string | null; me: MeResponse | null }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'loading' | 'sent'>('idle');

  const home = me?.user.role === 'EMPLOYER' ? '/employer' : '/candidate';

  if (token) {
    return (
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Подтверждение email</h1>
        {state === 'done' ? (
          <>
            <Alert tone="success" className="mt-5" title="Адрес подтверждён">
              Теперь вам доступен кабинет.
            </Alert>
            <div className="mt-6">
              {me ? (
                <Button
                  onClick={() => {
                    router.replace(home);
                    router.refresh();
                  }}
                >
                  Перейти в кабинет
                </Button>
              ) : (
                <LinkButton href="/login">Войти</LinkButton>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-muted">Нажмите кнопку, чтобы подтвердить адрес электронной почты.</p>
            {state === 'error' && message ? (
              <Alert tone="danger" className="mt-5">
                {message}
              </Alert>
            ) : null}
            <Button
              className="mt-6 w-full"
              loading={state === 'loading'}
              onClick={async () => {
                setState('loading');
                try {
                  await api.post('/auth/verify-email', { token });
                  setState('done');
                } catch (error) {
                  setMessage(errorMessage(error));
                  setState('error');
                }
              }}
            >
              Подтвердить
            </Button>
          </>
        )}
      </div>
    );
  }

  if (!me) {
    return (
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Подтверждение email</h1>
        <p className="mt-2 text-muted">Откройте ссылку из письма или войдите, чтобы запросить письмо повторно.</p>
        <LinkButton href="/login" className="mt-6">
          Войти
        </LinkButton>
      </div>
    );
  }

  if (me.user.emailVerified) {
    return (
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Email уже подтверждён</h1>
        <LinkButton href={home} className="mt-6">
          Перейти в кабинет
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Подтвердите email</h1>
      <p className="mt-2 text-ink-soft">
        Мы отправили письмо со ссылкой на <strong className="break-all">{me.user.email}</strong>. Откройте его и нажмите
        «Подтвердить». До подтверждения кабинет недоступен.
      </p>
      {message ? (
        <Alert tone={resendState === 'sent' ? 'success' : 'danger'} className="mt-5">
          {message}
        </Alert>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="outline"
          loading={resendState === 'loading'}
          onClick={async () => {
            setResendState('loading');
            setMessage(null);
            try {
              await api.post('/auth/resend-verification');
              setResendState('sent');
              setMessage('Письмо отправлено повторно. Проверьте почту.');
            } catch (error) {
              setResendState('idle');
              setMessage(errorMessage(error));
            }
          }}
        >
          Отправить письмо ещё раз
        </Button>
        <LogoutButton variant="outline" />
      </div>
      <p className="mt-6 text-sm text-muted">
        Локальная демонстрация: письма доставляются в Mailpit (http://localhost:8025).
      </p>
    </div>
  );
}
