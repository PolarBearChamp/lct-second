'use client';

import {
  GRADE_LABELS,
  GRADES,
  SKILL_MODE_LABELS,
  SPECIALIZATION_LABELS,
  SPECIALIZATIONS,
  WORK_FORMAT_LABELS,
  WORK_FORMATS,
  type Grade,
  type HiringNeedInput,
  type HiringNeedView,
  type SkillRequirementMode,
  type Specialization,
  type WorkFormat,
} from '@fsp/contracts';
import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ChoiceGroup, Field, Input, Select, Textarea } from '@/components/ui/field';
import { ApiError } from '@/lib/api/client';
import { useSkills } from '@/lib/queries';

/** Поля, общие для потребности и вакансии: форма заполняется любой из них. */
export type RequirementsInitial = Pick<
  HiringNeedView,
  'title' | 'description' | 'specialization' | 'allowedGrades' | 'requiredSkills' | 'preferredSkills' | 'workFormat' | 'city' | 'salaryFrom' | 'salaryTo'
> & { status?: string };

interface Props {
  initial?: RequirementsInitial;
  /** need — внутренняя потребность (по умолчанию); vacancy — публикуемая вакансия, видимая кандидатам. */
  variant?: 'need' | 'vacancy';
  /** Не показывать выбор статуса (у вакансии статус меняется отдельными действиями). */
  hideStatus?: boolean;
  submitLabel: string;
  loading: boolean;
  serverError: unknown;
  onSubmit: (input: HiringNeedInput) => void;
}

export function NeedForm({ initial, variant = 'need', hideStatus, submitLabel, loading, serverError, onSubmit }: Props) {
  const isVacancy = variant === 'vacancy';
  const skills = useSkills();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [specialization, setSpecialization] = useState<Specialization>(initial?.specialization ?? 'BACKEND');
  const [grades, setGrades] = useState<Grade[]>(initial?.allowedGrades ?? ['MIDDLE']);
  const [required, setRequired] = useState<string[]>(initial?.requiredSkills.map((s) => s.code) ?? []);
  const [preferred, setPreferred] = useState<Array<{ skill: string; mode: SkillRequirementMode }>>(
    initial?.preferredSkills.map((s) => ({ skill: s.code, mode: s.mode })) ?? [],
  );
  const [workFormat, setWorkFormat] = useState<WorkFormat>(initial?.workFormat ?? 'REMOTE');
  const [city, setCity] = useState(initial?.city ?? '');
  const [salaryFrom, setSalaryFrom] = useState(initial?.salaryFrom?.toString() ?? '');
  const [salaryTo, setSalaryTo] = useState(initial?.salaryTo?.toString() ?? '');
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE'>(initial?.status === 'DRAFT' ? 'DRAFT' : isVacancy && !initial ? 'DRAFT' : 'ACTIVE');
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const catalog = useMemo(() => skills.data ?? [], [skills.data]);
  const assessable = catalog.filter((s) => s.assessableIn.includes(specialization));
  const titleOf = (code: string) => catalog.find((s) => s.code === code)?.title ?? code;
  const preferredOptions = catalog
    .filter((s) => !required.includes(s.code) && !preferred.some((p) => p.skill === s.code))
    .filter((s) => !query || s.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.specializations.includes(specialization)) - Number(a.specializations.includes(specialization)) || a.title.localeCompare(b.title, 'ru'))
    .slice(0, 12);

  const apiFieldErrors = serverError instanceof ApiError ? serverError.fieldErrors : {};

  const submit = () => {
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = 'Не менее 3 символов';
    if (description.trim().length < 10) next.description = 'Опишите команду и задачи (не менее 10 символов)';
    if (grades.length === 0) next.grades = 'Выберите хотя бы один грейд';
    if (workFormat !== 'REMOTE' && !city.trim()) next.city = 'Для офиса и гибрида укажите город';
    const from = Number(salaryFrom);
    const to = Number(salaryTo);
    if (!Number.isInteger(from) || from <= 0) next.salaryFrom = 'Целое положительное число';
    if (!Number.isInteger(to) || to <= 0) next.salaryTo = 'Целое положительное число';
    if (!next.salaryFrom && !next.salaryTo && from > to) next.salaryTo = 'Значение «до» должно быть не меньше «от»';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      specialization,
      allowedGrades: grades,
      requiredSkills: required,
      preferredSkills: preferred,
      workFormat,
      city: city.trim() || null,
      salaryFrom: from,
      salaryTo: to,
      salaryType: 'GROSS',
      status,
    });
  };

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {serverError instanceof ApiError ? <Alert tone="danger" title={serverError.message} /> : null}
      <Card>
        <CardHeader
          title="Описание"
          description={isVacancy ? 'Эти сведения увидят кандидаты в общем списке вакансий — до отклика.' : 'Внутреннее описание потребности — кандидаты его не видят.'}
        />
        <div className="grid gap-4">
          <Field label="Название" required error={errors.title ?? apiFieldErrors.title?.[0]}>
            {(props) => <Input {...props} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label={isVacancy ? 'Описание вакансии: задачи, команда, условия' : 'Команда и задачи'} required error={errors.description ?? apiFieldErrors.description?.[0]}>
            {(props) => <Textarea rows={4} {...props} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Специализация и грейд" description="Допустимые грейды перечисляются явно: Senior не считается подходящим для Junior-позиции автоматически." />
        <div className="grid gap-5">
          <Field label="Специализация" required>
            {(props) => (
              <Select
                {...props}
                value={specialization}
                onChange={(e) => {
                  setSpecialization(e.target.value as Specialization);
                  setRequired([]);
                }}
              >
                {SPECIALIZATIONS.map((s) => (
                  <option key={s} value={s}>
                    {SPECIALIZATION_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ChoiceGroup legend="Допустимые грейды *" name="grades" multiple columns={3} value={grades} onChange={setGrades} error={errors.grades} options={GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] }))} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Обязательные навыки"
          description={
            isVacancy
              ? 'Только навыки, которые проверяются заданиями теста. Откликнуться можно и без них, но работодатель увидит, что обязательный навык не подтверждён, а оценка соответствия не будет рассчитана.'
              : 'Только навыки, которые проверяются заданиями теста этой специализации. Кандидат без подтверждения любого из них в подборку не попадёт — ни ФСП, ни высокий балл этого не компенсируют.'
          }
        />
        <ChoiceGroup
          legend="Должны быть подтверждены тестом"
          name="required"
          multiple
          columns={3}
          value={required}
          onChange={(next) => {
            setRequired(next);
            setPreferred((current) => current.filter((p) => !next.includes(p.skill)));
          }}
          error={apiFieldErrors.requiredSkills?.[0]}
          options={assessable.map((s) => ({ value: s.code, label: s.title }))}
        />
      </Card>

      <Card>
        <CardHeader
          title="Желательные навыки"
          description={
            isVacancy
              ? 'Влияют на оценку соответствия откликов (70% формулы). Для каждого навыка выберите, достаточно ли самоописания кандидата.'
              : 'Влияют на порядок в подборке (70% формулы). Для каждого навыка выберите, достаточно ли самоописания кандидата.'
          }
        />
        {preferred.length ? (
          <ul className="mb-4 space-y-2">
            {preferred.map((p) => (
              <li key={p.skill} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0 flex-1 font-medium">{titleOf(p.skill)}</span>
                <label className="sr-only" htmlFor={`mode-${p.skill}`}>
                  Режим для {titleOf(p.skill)}
                </label>
                <select
                  id={`mode-${p.skill}`}
                  className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"
                  value={p.mode}
                  onChange={(e) => setPreferred(preferred.map((x) => (x.skill === p.skill ? { ...x, mode: e.target.value as SkillRequirementMode } : x)))}
                >
                  {(['SELF_REPORTED_ALLOWED', 'VERIFIED_ONLY'] as const).map((m) => (
                    <option key={m} value={m}>
                      {SKILL_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
                {p.mode === 'VERIFIED_ONLY' && !catalog.find((s) => s.code === p.skill)?.assessableIn.includes(specialization) ? (
                  <span className="text-xs text-warning-700">не проверяется тестом — вклада не будет</span>
                ) : null}
                <button type="button" className="rounded-md px-2 py-1 text-sm text-danger-700 hover:bg-danger-50" onClick={() => setPreferred(preferred.filter((x) => x.skill !== p.skill))}>
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Field label="Добавить навык" hint="Поиск по справочнику">
          {(props) => <Input {...props} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например, Kafka" />}
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          {preferredOptions.map((s) => (
            <button
              key={s.code}
              type="button"
              className="rounded-full border border-line px-3 py-1 text-sm hover:border-brand-400 hover:bg-brand-50"
              onClick={() => setPreferred([...preferred, { skill: s.code, mode: s.assessableIn.includes(specialization) ? 'VERIFIED_ONLY' : 'SELF_REPORTED_ALLOWED' }])}
            >
              + {s.title}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Условия" />
        <div className="grid gap-5">
          <ChoiceGroup legend="Формат работы *" name="format" columns={3} value={[workFormat]} onChange={(next) => setWorkFormat(next[0] as WorkFormat)} options={WORK_FORMATS.map((f) => ({ value: f, label: WORK_FORMAT_LABELS[f] }))} />
          <Field label="Город" required={workFormat !== 'REMOTE'} hint={workFormat === 'REMOTE' ? 'Для удалённой работы необязательно' : 'Кандидат должен быть в этом городе'} error={errors.city ?? apiFieldErrors.city?.[0]}>
            {(props) => <Input {...props} value={city} onChange={(e) => setCity(e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Зарплата от, ₽/мес" required hint="До вычета налогов (GROSS)" error={errors.salaryFrom ?? apiFieldErrors.salaryFrom?.[0]}>
              {(props) => <Input inputMode="numeric" {...props} value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value.replace(/\D/g, ''))} />}
            </Field>
            <Field label="Зарплата до, ₽/мес" required error={errors.salaryTo ?? apiFieldErrors.salaryTo?.[0]}>
              {(props) => <Input inputMode="numeric" {...props} value={salaryTo} onChange={(e) => setSalaryTo(e.target.value.replace(/\D/g, ''))} />}
            </Field>
          </div>
          {initial?.status !== 'ARCHIVED' && !hideStatus ? (
            <ChoiceGroup
              legend="Статус"
              name="status"
              columns={2}
              value={[status]}
              onChange={(next) => setStatus(next[0] as 'DRAFT' | 'ACTIVE')}
              options={[
                { value: 'ACTIVE', label: isVacancy ? 'Опубликовать сразу' : 'Активна' },
                { value: 'DRAFT', label: 'Черновик' },
              ]}
            />
          ) : null}
        </div>
      </Card>
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}
