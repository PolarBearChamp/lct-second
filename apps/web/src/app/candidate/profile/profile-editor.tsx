'use client';

import {
  GRADE_LABELS,
  SKILL_EVIDENCE_LABELS,
  SPECIALIZATION_LABELS,
  type OwnProfileResponse,
  type ProfileUpdate,
  type WorkFormat,
} from '@fsp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ResumeImport } from '@/components/candidate/resume-import';
import { SkillPicker, type PickedSkill } from '@/components/candidate/skill-picker';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ChoiceGroup, Field, Input, Select, Textarea } from '@/components/ui/field';
import { ScoreBar } from '@/components/ui/score';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { queryKeys, useOwnProfile, useReference, useSkills } from '@/lib/queries';

const optionalInt = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= max), `${label}: целое число от 0 до ${max.toLocaleString('ru-RU')}`);

// Сохранить можно и неполный профиль: прогресс не теряется. Какие обязательные поля ещё не заполнены, показывает блок «Для попадания в поиск»
// (условия вычисляет сервер), а здесь проверяется только формат уже введённых значений.
const schema = z
  .object({
    fullName: z.string().trim().max(120).refine((v) => v === '' || v.length >= 2, 'ФИО: не менее 2 символов'),
    city: z.string().trim().max(80).refine((v) => v === '' || v.length >= 2, 'Город: не менее 2 символов'),
    timezone: z.string(),
    experienceMonths: optionalInt('Опыт', 600),
    teamRoles: z.array(z.string()),
    industries: z.array(z.string()),
    skills: z.array(z.object({ code: z.string(), months: z.number().nullable() })).max(40, 'Не более 40 навыков'),
    softSkills: z.array(z.string()).max(10, 'Не более 10'),
    experienceDescription: z.string().max(3000, 'Не более 3000 символов'),
    externalLinks: z
      .string()
      .refine(
        (v) => v.split('\n').map((s) => s.trim()).filter(Boolean).every((s) => /^https?:\/\/\S+$/.test(s)),
        'Каждая ссылка — с новой строки и начинается с https://',
      )
      .refine((v) => v.split('\n').filter((s) => s.trim()).length <= 5, 'Не более 5 ссылок'),
    contactEmail: z.string().trim().refine((v) => v === '' || z.email().safeParse(v).success, 'Некорректный email'),
    phone: z.string().trim().refine((v) => v === '' || /^\+?[0-9()\-\s]{7,20}$/.test(v), 'Телефон: цифры, пробелы, скобки, дефисы'),
    messenger: z.string().trim().max(64),
    workFormats: z.array(z.enum(['REMOTE', 'HYBRID', 'OFFICE'])),
    availability: z.enum(['ACTIVE', 'PAUSED']),
    salaryFrom: optionalInt('Зарплата', 10_000_000),
    salaryTo: optionalInt('Зарплата', 10_000_000),
  })
  .refine((v) => !v.salaryFrom || !v.salaryTo || Number(v.salaryFrom) <= Number(v.salaryTo), {
    path: ['salaryTo'],
    message: 'Значение «до» должно быть не меньше «от»',
  });

type FormValues = z.infer<typeof schema>;

function toForm(data: OwnProfileResponse): FormValues {
  const p = data.profile;
  return {
    fullName: p.fullName ?? '',
    city: p.city ?? '',
    timezone: p.timezone ?? '',
    experienceMonths: p.experienceMonths?.toString() ?? '',
    teamRoles: p.teamRoles,
    industries: p.industries,
    skills: p.skills.map((s) => ({ code: s.code, months: s.months })),
    softSkills: p.softSkills,
    experienceDescription: p.experienceDescription ?? '',
    externalLinks: p.externalLinks.join('\n'),
    contactEmail: p.contactEmail ?? '',
    phone: p.phone ?? '',
    messenger: p.messenger ?? '',
    workFormats: p.workFormats,
    availability: p.availability,
    salaryFrom: p.salaryFrom?.toString() ?? '',
    salaryTo: p.salaryTo?.toString() ?? '',
  };
}

function toUpdate(values: FormValues): ProfileUpdate {
  const intOrNull = (v: string) => (v === '' ? null : Number(v));
  return {
    fullName: values.fullName.trim() || null,
    city: values.city.trim() || null,
    timezone: values.timezone || null,
    experienceMonths: intOrNull(values.experienceMonths),
    teamRoles: values.teamRoles,
    industries: values.industries,
    skills: values.skills.map((s: PickedSkill) => ({ code: s.code, months: s.months })),
    softSkills: values.softSkills,
    experienceDescription: values.experienceDescription.trim() || null,
    externalLinks: values.externalLinks.split('\n').map((s) => s.trim()).filter(Boolean),
    contactEmail: values.contactEmail || null,
    phone: values.phone || null,
    messenger: values.messenger || null,
    workFormats: values.workFormats as WorkFormat[],
    availability: values.availability,
    salaryFrom: intOrNull(values.salaryFrom),
    salaryTo: intOrNull(values.salaryTo),
  };
}

export function ProfileEditor() {
  const profile = useOwnProfile();
  const skills = useSkills();
  const reference = useReference();

  if (profile.isPending || skills.isPending || reference.isPending) return <LoadingBlock label="Загружаем профиль…" lines={6} />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  if (skills.isError || reference.isError) return <ErrorState error={skills.error ?? reference.error} />;
  return <ProfileForm data={profile.data} />;
}

function ProfileForm({ data }: { data: OwnProfileResponse }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const skills = useSkills();
  const reference = useReference();
  const verified = useMemo(() => new Set(data.verifiedSkills), [data.verifiedSkills]);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(data) });

  useEffect(() => reset(toForm(data)), [data, reset]);

  const save = useMutation({
    mutationFn: (values: FormValues) => api.patch<OwnProfileResponse>('/candidate/profile', toUpdate(values)),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.ownProfile, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      notify('Профиль сохранён');
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          setError(field.split('.')[0] as keyof FormValues, { message: messages[0] });
        }
      }
      notify(error instanceof ApiError ? error.message : 'Не удалось сохранить профиль', 'danger');
    },
  });

  const ref = reference.data!;
  const q = data.qualification;
  const p = data.profile;

  return (
    <>
      <PageHeader
        title="Профиль"
        description="Самоописанные данные помогают работодателю, но не заменяют подтверждения: в выдаче учитывается грейд по результатам тестирования."
        actions={
          <LinkButton href="/candidate/settings#preview" variant="outline" size="sm">
            Как меня видит работодатель
          </LinkButton>
        }
      />
      <ResumeImport data={data} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <form className="space-y-6" onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
          <Card>
            <CardHeader title="Основное" description="Поля со звёздочкой нужны для публикации профиля. Сохранить можно и неполный профиль — введённое не потеряется." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ФИО" error={errors.fullName?.message} required hint="Видно работодателю только после принятия приглашения">
                {(props) => <Input autoComplete="name" {...props} {...register('fullName')} />}
              </Field>
              <Field label="Город" error={errors.city?.message} required>
                {(props) => <Input autoComplete="address-level2" {...props} {...register('city')} />}
              </Field>
              <Field label="Часовой пояс" error={errors.timezone?.message} required>
                {(props) => (
                  <Select {...props} {...register('timezone')}>
                    <option value="">Выберите…</option>
                    {ref.timezones.map((tz) => (
                      <option key={tz.code} value={tz.code}>
                        {tz.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Опыт по специальности, месяцев" error={errors.experienceMonths?.message} required hint="Указано вами, тестом не проверяется">
                {(props) => <Input inputMode="numeric" {...props} {...register('experienceMonths')} />}
              </Field>
            </div>
            <div className="mt-5 grid gap-5">
              <Controller
                control={control}
                name="teamRoles"
                render={({ field }) => (
                  <ChoiceGroup legend="Роли в команде" name="teamRoles" multiple columns={3} value={field.value} onChange={field.onChange} options={ref.teamRoles.map((r) => ({ value: r.code, label: r.title }))} />
                )}
              />
              <Controller
                control={control}
                name="industries"
                render={({ field }) => (
                  <ChoiceGroup legend="Отрасли интереса" name="industries" multiple columns={3} value={field.value} onChange={field.onChange} options={ref.industries.map((r) => ({ value: r.code, label: r.title }))} />
                )}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Стек и навыки"
              description="Выбирается из справочника. Отметка «проверено тестом» появляется только после успешного теста по навыку."
            />
            <Controller
              control={control}
              name="skills"
              render={({ field }) => (
                <SkillPicker catalog={skills.data!} value={field.value} onChange={field.onChange} specialization={p.activeSpecialization} verified={verified} />
              )}
            />
            {errors.skills?.message ? <p className="mt-2 text-[13px] font-medium text-danger-700">{errors.skills.message}</p> : null}
            <div className="mt-5">
              <Controller
                control={control}
                name="softSkills"
                render={({ field }) => (
                  <ChoiceGroup legend="Soft skills (указано вами)" name="softSkills" multiple columns={3} value={field.value} onChange={field.onChange} error={errors.softSkills?.message} options={ref.softSkills.map((r) => ({ value: r.code, label: r.title }))} />
                )}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Опыт" description="Свободный текст и ссылки не показываются работодателю до принятия приглашения." />
            <div className="grid gap-4">
              <Field label="Описание опыта" error={errors.experienceDescription?.message}>
                {(props) => <Textarea rows={6} {...props} {...register('experienceDescription')} />}
              </Field>
              <Field label="Ссылки на портфолио и профили" hint="Каждая ссылка с новой строки, до 5 ссылок" error={errors.externalLinks?.message}>
                {(props) => <Textarea rows={3} placeholder="https://github.com/…" {...props} {...register('externalLinks')} />}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Контакты"
              description="Раскрываются только компании, чьё приглашение вы примете. Какие каналы раскрывать — выбирается в разделе «Приватность и ФСП»."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Контактный email" error={errors.contactEmail?.message}>
                {(props) => <Input type="email" autoComplete="email" {...props} {...register('contactEmail')} />}
              </Field>
              <Field label="Телефон" error={errors.phone?.message}>
                {(props) => <Input type="tel" autoComplete="tel" {...props} {...register('phone')} />}
              </Field>
              <Field label="Мессенджер" hint="Например, @username" error={errors.messenger?.message}>
                {(props) => <Input {...props} {...register('messenger')} />}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Формат работы и ожидания" />
            <div className="grid gap-5">
              <Controller
                control={control}
                name="workFormats"
                render={({ field }) => (
                  <ChoiceGroup legend="Допустимые форматы работы *" name="workFormats" multiple columns={3} value={field.value} onChange={field.onChange} error={errors.workFormats?.message} options={ref.workFormats.map((r) => ({ value: r.code as WorkFormat, label: r.title }))} />
                )}
              />
              <Controller
                control={control}
                name="availability"
                render={({ field }) => (
                  <ChoiceGroup
                    legend="Готовность рассматривать предложения"
                    name="availability"
                    columns={2}
                    value={[field.value]}
                    onChange={(next) => field.onChange(next[0])}
                    options={[
                      { value: 'ACTIVE', label: 'Рассматриваю предложения' },
                      { value: 'PAUSED', label: 'Поиск на паузе', description: 'Профиль не попадает в новые подборки' },
                    ]}
                  />
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ожидаемая зарплата от, ₽/мес" hint="До вычета налогов, необязательно" error={errors.salaryFrom?.message}>
                  {(props) => <Input inputMode="numeric" {...props} {...register('salaryFrom')} />}
                </Field>
                <Field label="Ожидаемая зарплата до, ₽/мес" error={errors.salaryTo?.message}>
                  {(props) => <Input inputMode="numeric" {...props} {...register('salaryTo')} />}
                </Field>
              </div>
            </div>
          </Card>

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 p-3 backdrop-blur">
            <Button type="submit" loading={save.isPending}>
              Сохранить профиль
            </Button>
            {isDirty ? <span className="text-sm text-warning-700">Есть несохранённые изменения</span> : <span className="text-sm text-muted">Изменений нет</span>}
          </div>
        </form>

        <aside className="space-y-6" aria-label="Подтверждённые данные">
          <Card>
            <CardHeader as="h3" title="Для попадания в поиск" />
            {data.discoverability.discoverable ? (
              <Alert tone="success">Профиль виден работодателям в поиске.</Alert>
            ) : (
              <>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
                  {data.discoverability.issues.map((issue) => (
                    <li key={issue.code}>{issue.message}</li>
                  ))}
                </ul>
                <Link href="/candidate/settings" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                  Приватность и ФСП
                </Link>
              </>
            )}
          </Card>
          <Card>
            <CardHeader as="h3" title="Специализация" />
            {p.activeSpecialization ? (
              <div className="space-y-2">
                <div className="font-semibold">{SPECIALIZATION_LABELS[p.activeSpecialization]}</div>
                <div className="text-sm text-muted">
                  Заявленный грейд: {p.declaredGrade ? <Badge>{GRADE_LABELS[p.declaredGrade]}</Badge> : 'не выбран'}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Не выбрана.</p>
            )}
            <Link href="/candidate/survey" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
              Изменить в опросе
            </Link>
          </Card>
          <Card>
            <CardHeader as="h3" title="Подтверждено тестом" />
            {q ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge tone="success">{q.gradeTitle}</Badge>
                  <span className="text-sm text-muted">с {formatDate(q.confirmedAt)}</span>
                </div>
                <ScoreBar label="Общий балл" score={q.overallScore} />
                {q.groupScores.map((g) => (
                  <ScoreBar key={g.group} label={g.title} score={g.score} compact />
                ))}
                <div>
                  <div className="mb-1 text-sm font-medium">Навыки</div>
                  <ul className="space-y-1.5 text-sm">
                    {q.skillEvidence.map((s) => (
                      <li key={s.skill}>
                        <span className="block">{s.title}</span>
                        <span className={s.status === 'CONFIRMED' ? 'text-xs text-success-700' : 'text-xs text-muted'}>{SKILL_EVIDENCE_LABELS[s.status]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Alert tone="warning">
                Грейда по результатам тестирования пока нет — без него профиль не попадает в основную выдачу.{' '}
                <Link className="font-medium underline" href="/candidate/assessments">
                  К тестированию
                </Link>
              </Alert>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
