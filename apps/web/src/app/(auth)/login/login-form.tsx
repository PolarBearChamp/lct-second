'use client';

import type { MeResponse } from '@fsp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { api, ApiError } from '@/lib/api/client';

const schema = z.object({
  email: z.string().trim().min(1, 'Укажите email').email('Укажите корректный email'),
  password: z.string().min(1, 'Укажите пароль'),
});
type FormValues = z.infer<typeof schema>;

function safeNext(next: string | undefined, me: MeResponse): string {
  const home = me.user.role === 'CANDIDATE' ? '/candidate' : '/employer';
  if (!me.user.emailVerified) return '/verify-email';
  if (next && next.startsWith(home)) return next;
  return home;
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const me = await api.post<MeResponse>('/auth/login', values);
      queryClient.setQueryData(['me'], me);
      router.replace(safeNext(next, me));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти');
    }
  });

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Вход</h1>
      <p className="mt-1 text-muted">Кабинет кандидата или работодателя</p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Email" error={errors.email?.message} required>
          {(props) => <Input type="email" autoComplete="email" {...props} {...register('email')} />}
        </Field>
        <Field label="Пароль" error={errors.password?.message} required>
          {(props) => <PasswordInput autoComplete="current-password" {...props} {...register('password')} />}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Войти
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Нет аккаунта?{' '}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </div>
  );
}
