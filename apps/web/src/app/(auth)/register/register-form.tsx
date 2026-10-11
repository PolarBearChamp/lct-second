'use client';

import type { MeResponse } from '@fsp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox, ChoiceGroup, Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { api, ApiError } from '@/lib/api/client';

const schema = z.object({
  role: z.enum(['CANDIDATE', 'EMPLOYER']),
  email: z.string().trim().min(1, 'Укажите email').email('Укажите корректный email'),
  password: z.string().min(10, 'Не менее 10 символов').max(128, 'Не более 128 символов'),
  acceptPrivacyPolicy: z.boolean().refine((v) => v, 'Необходимо согласие на обработку персональных данных'),
});
type FormValues = z.infer<typeof schema>;

export function RegisterForm({ initialRole }: { initialRole: 'CANDIDATE' | 'EMPLOYER' }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { role: initialRole, acceptPrivacyPolicy: false } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const me = await api.post<MeResponse>('/auth/register', values);
      queryClient.setQueryData(['me'], me);
      router.replace('/verify-email');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [field, messages] of Object.entries(err.fieldErrors)) {
          if (field in values) setFieldError(field as keyof FormValues, { message: messages[0] });
        }
        setError(err.message);
      } else setError('Не удалось зарегистрироваться');
    }
  });

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Регистрация</h1>
      <p className="mt-1 text-muted">После регистрации подтвердите email по ссылке из письма.</p>
      <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <ChoiceGroup
              legend="Кто вы?"
              name="role"
              columns={1}
              value={[field.value]}
              onChange={(next) => field.onChange(next[0])}
              options={[
                { value: 'CANDIDATE', label: 'Я ищу работу', description: 'Подтвердите навыки тестом и получайте предложения с зарплатой' },
                { value: 'EMPLOYER', label: 'Я ищу специалиста', description: 'Опишите потребность и сами выходите на подходящих кандидатов' },
              ]}
            />
          )}
        />
        <Field label="Email" error={errors.email?.message} required>
          {(props) => <Input type="email" autoComplete="email" {...props} {...register('email')} />}
        </Field>
        <Field label="Пароль" hint="Не менее 10 символов" error={errors.password?.message} required>
          {(props) => <PasswordInput autoComplete="new-password" {...props} {...register('password')} />}
        </Field>
        <div>
          <Checkbox
            {...register('acceptPrivacyPolicy')}
            label="Я согласен(на) на обработку персональных данных"
            description="Данные используются только для работы сервиса. Публикация профиля работодателям — отдельное согласие в настройках."
          />
          {errors.acceptPrivacyPolicy ? <p className="mt-1 text-[13px] font-medium text-danger-700">{errors.acceptPrivacyPolicy.message}</p> : null}
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Зарегистрироваться
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Войти
        </Link>
      </p>
    </div>
  );
}
