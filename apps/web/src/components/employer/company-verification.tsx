'use client';

import type { CompanyView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError, errorMessage } from '@/lib/api/client';
import { employerKeys } from '@/lib/employer-queries';
import { formatDate } from '@/lib/format';

/** Метка доверия для кандидатов: «Компания проверена». */
export function CompanyVerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge tone="success" title="Компания прошла добровольную проверку: ИНН, реестр, название и домен почты (демо-реестр)">
      ✓ Компания проверена
    </Badge>
  ) : null;
}

/**
 * Добровольная проверка компании. Не блокирует ни один сценарий: без неё можно искать кандидатов, приглашать и публиковать
 * вакансии; с ней кандидаты видят метку доверия.
 */
export function CompanyVerificationCard({ company }: { company: CompanyView }) {
  const queryClient = useQueryClient();
  const v = company.verification;
  const [inn, setInn] = useState(v.inn ?? '');
  const check = useMutation({
    mutationFn: () => api.post<{ company: CompanyView }>('/employer/company/verification', { inn: inn.trim() }),
    onSuccess: (data) => queryClient.setQueryData(employerKeys.company, data),
  });
  const fieldError = check.error instanceof ApiError ? check.error.fieldErrors.inn?.[0] : undefined;
  return (
    <Card className="mt-6">
      <CardHeader
        title="Проверка компании (метка доверия)"
        description="Необязательно. Кандидаты увидят метку «Компания проверена» в приглашениях, вакансиях и заданиях. Без проверки все возможности кабинета доступны."
        actions={v.status === 'VERIFIED' ? <Badge tone="success">Проверена {v.verifiedAt ? formatDate(v.verifiedAt) : ''}</Badge> : v.status === 'REJECTED' ? <Badge tone="warning">Не пройдена</Badge> : null}
      />
      <form
        className="flex flex-wrap items-end gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          check.mutate();
        }}
      >
        <Field label="ИНН компании" hint="10 цифр (юрлицо) или 12 (ИП)" error={fieldError} className="min-w-[14rem] flex-1">
          {(props) => <Input {...props} inputMode="numeric" maxLength={12} value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))} />}
        </Field>
        <Button type="submit" variant="outline" loading={check.isPending} disabled={inn.length !== 10 && inn.length !== 12}>
          {v.status === 'NOT_REQUESTED' ? 'Проверить' : 'Проверить снова'}
        </Button>
      </form>
      {check.isError && !fieldError ? (
        <Alert tone="danger" className="mt-3">
          {errorMessage(check.error)}
        </Alert>
      ) : null}
      {v.checks.length ? (
        <ul className="mt-4 space-y-1.5 text-[14px]">
          {v.checks.map((c) => (
            <li key={c.code} className="flex gap-2">
              <span className={c.passed ? 'text-success-600' : 'text-danger-600'} aria-hidden>
                {c.passed ? '✓' : '✕'}
              </span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 text-xs text-muted">
        Проверяются контрольные разряды ИНН, наличие организации в реестре, совпадение названия и домен почты вашего аккаунта. В MVP используется
        демонстрационный реестр вымышленных организаций, а не ЕГРЮЛ. Смена названия компании снимает метку — проверку нужно пройти заново.
      </p>
    </Card>
  );
}
