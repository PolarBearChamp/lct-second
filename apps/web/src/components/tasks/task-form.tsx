'use client';

import {
  GRADE_LABELS,
  GRADES,
  SHORT_TASK_KIND_LABELS,
  SHORT_TASK_KINDS,
  SPECIALIZATION_LABELS,
  SPECIALIZATIONS,
  type CreateTaskRequest,
  type EmployerTaskView,
  type Grade,
  type ShortTaskKind,
  type Specialization,
} from '@fsp/contracts';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ChoiceGroup, Field, Input, Select, Textarea } from '@/components/ui/field';
import { ApiError, errorMessage } from '@/lib/api/client';

const MAX_OPTIONS = 6;

/** Дата (гггг-мм-дд) → конец этого дня по местному времени в ISO. */
const endOfDayIso = (date: string) => new Date(`${date}T23:59:59`).toISOString();
const toDateInput = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');

interface Props {
  initial?: EmployerTaskView;
  loading: boolean;
  serverError: unknown;
  /** Подпись кнопки сохранения черновика. */
  saveLabel: string;
  onSubmit: (input: CreateTaskRequest, publish: boolean) => void;
}

export function TaskForm({ initial, loading, serverError, saveLabel, onSubmit }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [specialization, setSpecialization] = useState<Specialization>(initial?.specialization ?? 'BACKEND');
  const [grades, setGrades] = useState<Grade[]>(initial?.allowedGrades ?? []);
  const [kind, setKind] = useState<ShortTaskKind>(initial?.kind ?? 'QUIZ');
  const [options, setOptions] = useState<string[]>(initial?.options.length ? initial.options : ['', '']);
  const [correctIndex, setCorrectIndex] = useState<number>(initial?.correctIndex ?? 0);
  const [explanation, setExplanation] = useState(initial?.explanation ?? '');
  const [deadline, setDeadline] = useState(toDateInput(initial?.deadlineAt));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const apiFieldErrors = serverError instanceof ApiError ? serverError.fieldErrors : {};
  const fieldError = (name: string) => errors[name] ?? apiFieldErrors[name]?.[0];

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = 'Не короче 3 символов';
    if (prompt.trim().length < 10) next.prompt = 'Опишите задание — не короче 10 символов';
    if (kind === 'QUIZ') {
      const filled = options.map((o) => o.trim());
      if (filled.some((o) => o === '')) next.options = 'Заполните все варианты или удалите лишние';
      else if (filled.length < 2) next.options = 'Нужно не меньше двух вариантов';
      else if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) next.options = 'Варианты не должны повторяться';
    }
    return next;
  };

  const submit = (publish: boolean) => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const base = {
      title: title.trim(),
      prompt: prompt.trim(),
      specialization,
      allowedGrades: grades,
      kind,
      explanation: explanation.trim() || null,
      deadlineAt: deadline ? endOfDayIso(deadline) : null,
    };
    onSubmit(kind === 'QUIZ' ? { ...base, options: options.map((o) => o.trim()), correctIndex } : base, publish);
  };

  const updateOption = (index: number, value: string) => setOptions(options.map((o, i) => (i === index ? value : o)));
  const removeOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
    setCorrectIndex((current) => (index < current ? current - 1 : index === current ? 0 : current));
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
      className="space-y-6"
    >
      {serverError ? (
        <Alert tone="danger" title="Не удалось сохранить задание">
          {errorMessage(serverError)}
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Условие" description="Кандидат увидит название, условие и название вашей компании. Короткое задание — на 5–10 минут, а не тестовое на день." />
        <div className="space-y-4">
          <Field label="Название" required error={fieldError('title')}>
            {(props) => <Input {...props} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Условие" required error={fieldError('prompt')} hint="Не включайте в условие коммерческую тайну и персональные данные.">
            {(props) => <Textarea {...props} value={prompt} maxLength={2000} rows={5} onChange={(e) => setPrompt(e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Специализация" required hint="Задание предлагается кандидатам с подтверждённым тестом грейдом в этой специализации.">
              {(props) => (
                <Select {...props} value={specialization} onChange={(e) => setSpecialization(e.target.value as Specialization)}>
                  {SPECIALIZATIONS.map((s) => (
                    <option key={s} value={s}>
                      {SPECIALIZATION_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Срок приёма ответов" hint="Необязательно. После этой даты задание больше не предлагается." error={fieldError('deadlineAt')}>
              {(props) => <Input {...props} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
            </Field>
          </div>
          <ChoiceGroup
            legend="Для каких грейдов"
            hint="Если ничего не выбрано — подходит любой подтверждённый грейд. Учитывается грейд по результатам тестирования, а не заявленный."
            name="allowedGrades"
            multiple
            columns={3}
            options={GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] }))}
            value={grades}
            onChange={setGrades}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Формат ответа" />
        <div className="space-y-4">
          <ChoiceGroup
            legend="Вид задания"
            name="kind"
            columns={2}
            options={SHORT_TASK_KINDS.map((k) => ({
              value: k,
              label: SHORT_TASK_KIND_LABELS[k],
              description: k === 'QUIZ' ? 'Проверяется автоматически, кандидат сразу видит результат.' : 'Вы читаете ответ и ставите оценку; кандидат получает комментарий.',
              disabled: Boolean(initial && initial.status !== 'DRAFT'),
            }))}
            value={[kind]}
            onChange={(next) => next[0] && setKind(next[0])}
          />

          {kind === 'QUIZ' ? (
            <fieldset aria-describedby={fieldError('options') ? 'options-error' : undefined}>
              <legend className="mb-1.5 text-sm font-medium">Варианты ответа (отметьте верный)</legend>
              <ul className="space-y-2">
                {options.map((option, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correctIndex"
                      checked={correctIndex === index}
                      onChange={() => setCorrectIndex(index)}
                      aria-label={`Вариант ${index + 1} — верный`}
                      className="h-5 w-5 shrink-0 accent-brand-500"
                    />
                    <Input value={option} maxLength={200} aria-label={`Вариант ${index + 1}`} placeholder={`Вариант ${index + 1}`} onChange={(e) => updateOption(index, e.target.value)} />
                    {options.length > 2 ? (
                      <Button variant="ghost" size="sm" aria-label={`Удалить вариант ${index + 1}`} onClick={() => removeOption(index)}>
                        ✕
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {fieldError('options') ? (
                <p id="options-error" className="mt-1.5 text-[13px] font-medium text-danger-700">
                  {fieldError('options')}
                </p>
              ) : null}
              {fieldError('correctIndex') ? <p className="mt-1.5 text-[13px] font-medium text-danger-700">{fieldError('correctIndex')}</p> : null}
              {options.length < MAX_OPTIONS ? (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setOptions([...options, ''])}>
                  Добавить вариант
                </Button>
              ) : null}
            </fieldset>
          ) : (
            <Alert tone="info">Кандидат ответит текстом от 20 до 2000 символов. Ответ увидите вы — под псевдонимом, без ФИО и контактов.</Alert>
          )}

          <Field label="Пояснение после ответа" hint="Необязательно. Кандидат увидит его после отправки ответа вместе с верным вариантом." error={fieldError('explanation')}>
            {(props) => <Textarea {...props} value={explanation} maxLength={1000} rows={3} onChange={(e) => setExplanation(e.target.value)} />}
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="outline" loading={loading}>
          {saveLabel}
        </Button>
        <Button loading={loading} onClick={() => submit(true)}>
          Опубликовать
        </Button>
      </div>
      <p className="text-sm text-muted">
        После публикации условие изменить нельзя: все ответы оцениваются по одному заданию. Одновременно может быть активно не больше 10 заданий компании.
      </p>
    </form>
  );
}
