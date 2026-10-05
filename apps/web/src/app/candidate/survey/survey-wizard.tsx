'use client';

import {
  GRADE_LABELS,
  GRADES,
  SPECIALIZATIONS,
  type Grade,
  type OwnProfileResponse,
  type Specialization,
  type SurveyAnswers,
  type SurveyDefinition,
  type SurveyRecommendation,
} from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/field';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { queryKeys, useOwnProfile, useSpecializations, useSurveyDefinition } from '@/lib/queries';

const GRADE_HINTS: Record<Grade, string> = {
  JUNIOR: 'Типовые задачи под руководством, базовые понятия и инструменты.',
  MIDDLE: 'Самостоятельные задачи средней сложности, понимание компромиссов.',
  SENIOR: 'Сложные и пограничные случаи, проектирование решений, надёжность.',
};

/**
 * Черновик незавершённого опроса хранится в браузере (по пользователю) и удаляется после отправки: перезагрузка страницы не сбрасывает
 * уже выбранные ответы. Недоступное хранилище (приватный режим, запрет сайта) просто отключает черновик.
 */
interface SurveyDraft {
  answers: SurveyAnswers;
  step: number;
}

const draftKey = (userId: string) => `fsp.survey-draft.${userId}`;

function readDraft(userId: string): SurveyDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SurveyDraft> | null;
    return parsed && typeof parsed.step === 'number' && parsed.answers && typeof parsed.answers === 'object' ? { answers: parsed.answers, step: parsed.step } : null;
  } catch {
    return null;
  }
}

function writeDraft(userId: string, draft: SurveyDraft): void {
  try {
    window.localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    /* хранилище недоступно — черновик не сохраняется */
  }
}

function clearDraft(userId: string): void {
  try {
    window.localStorage.removeItem(draftKey(userId));
  } catch {
    /* хранилище недоступно */
  }
}

export function SurveyWizard() {
  const survey = useSurveyDefinition();
  const profile = useOwnProfile();
  const specs = useSpecializations();
  if (survey.isPending || profile.isPending || specs.isPending) return <LoadingBlock label="Загружаем опрос…" />;
  if (survey.isError || profile.isError || specs.isError) return <ErrorState error={survey.error ?? profile.error ?? specs.error} />;
  return <Wizard definition={survey.data} profile={profile.data} />;
}

function Wizard({ definition, profile }: { definition: SurveyDefinition; profile: OwnProfileResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const specs = useSpecializations().data!;
  const userId = useMe().user.id;
  const questions = definition.questions;
  // Черновик нужен только пока опрос не отправлен: после отправки ответы хранит сервер.
  const [draft] = useState<SurveyDraft | null>(() => (profile.survey ? null : readDraft(userId)));
  const [answers, setAnswers] = useState<SurveyAnswers>(profile.survey?.answers ?? draft?.answers ?? {});
  const [step, setStep] = useState(draft ? Math.max(0, Math.min(draft.step, questions.length - 1)) : 0);
  const [recommendation, setRecommendation] = useState<SurveyRecommendation | null>(profile.survey?.recommendation ?? null);
  const [specialization, setSpecialization] = useState<Specialization | null>(profile.profile.activeSpecialization ?? profile.survey?.recommendation.specialization ?? null);
  const [grade, setGrade] = useState<Grade | null>(profile.profile.declaredGrade ?? profile.survey?.recommendation.grade ?? null);
  const [stepError, setStepError] = useState<string | null>(null);
  const isChoiceStep = step === questions.length;

  useEffect(() => {
    if (draft) notify('Восстановлены ваши незавершённые ответы опроса', 'info');
    // Уведомление показывается один раз при открытии страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!profile.survey && !isChoiceStep && (step > 0 || Object.keys(answers).length > 0)) writeDraft(userId, { answers, step });
  }, [answers, step, isChoiceStep, profile.survey, userId]);

  const submitSurvey = useMutation({
    mutationFn: () => api.put<{ recommendation: SurveyRecommendation }>('/candidate/survey', { answers }),
    onSuccess: (result) => {
      clearDraft(userId);
      setRecommendation(result.recommendation);
      setSpecialization((current) => current ?? result.recommendation.specialization);
      setGrade((current) => current ?? result.recommendation.grade);
      setStep(questions.length);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ownProfile });
    },
    onError: (error) => setStepError(errorMessage(error)),
  });

  const saveChoice = useMutation({
    mutationFn: () => api.patch<OwnProfileResponse>('/candidate/profile', { activeSpecialization: specialization, declaredGrade: grade }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.ownProfile, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      notify('Специализация и заявленный грейд сохранены');
      router.push('/candidate/assessments');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  const current = questions[step];
  const value = current ? answers[current.code] : undefined;
  const asArray = Array.isArray(value) ? value : value ? [value] : [];

  const next = () => {
    if (current?.required && asArray.length === 0) {
      setStepError('Выберите вариант ответа');
      return;
    }
    setStepError(null);
    if (step === questions.length - 1) submitSurvey.mutate();
    else setStep(step + 1);
  };

  const specChanged = profile.profile.activeSpecialization && specialization && specialization !== profile.profile.activeSpecialization;

  return (
    <>
      <PageHeader
        title="Опрос и выбор специализации"
        description="Опрос помогает выбрать направление и уровень для теста. Заявленный грейд — только ваша оценка: в поиске работодателей учитывается грейд, подтверждённый тестированием."
      />
      <div className="mb-4 flex items-center gap-3" aria-hidden>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(Math.min(step, questions.length) / questions.length) * 100}%` }} />
        </div>
        <span className="font-brand text-sm text-muted">
          {Math.min(step + 1, questions.length + 1)} / {questions.length + 1}
        </span>
      </div>

      {!isChoiceStep && current ? (
        <Card>
          <ChoiceGroup
            legend={<span className="text-lg font-bold">{current.title}</span>}
            hint={current.hint}
            name={current.code}
            multiple={current.kind === 'multi'}
            columns={current.options.length > 6 ? 3 : current.options.length > 2 ? 2 : 2}
            value={asArray}
            onChange={(selected) => {
              setStepError(null);
              setAnswers({ ...answers, [current.code]: current.kind === 'multi' ? selected : (selected[0] ?? '') });
            }}
            options={current.options.map((o) => ({ value: o.code, label: o.title }))}
            error={stepError ?? undefined}
          />
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
              Назад
            </Button>
            <Button onClick={next} loading={submitSurvey.isPending}>
              {step === questions.length - 1 ? 'Завершить опрос' : 'Далее'}
            </Button>
            {!current.required ? (
              <Button variant="ghost" onClick={() => (step === questions.length - 1 ? submitSurvey.mutate() : setStep(step + 1))}>
                Пропустить
              </Button>
            ) : null}
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {recommendation ? (
            <Alert tone="brand" title="Рекомендация по результатам опроса">
              <p>
                Направление: <strong>{specs.find((s) => s.code === recommendation.specialization)?.title}</strong>, уровень для
                теста: <strong>{GRADE_LABELS[recommendation.grade]}</strong>.
              </p>
              <ul className="mt-1 list-disc pl-5">
                {recommendation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <Card>
            <ChoiceGroup
              legend={<span className="text-lg font-bold">Специализация</span>}
              hint="Тест и подбор выполняются по одной активной специализации. Результат другой специализации не переносится."
              name="specialization"
              columns={2}
              value={specialization ? [specialization] : []}
              onChange={(next) => setSpecialization(next[0] as Specialization)}
              options={SPECIALIZATIONS.map((code) => {
                const spec = specs.find((s) => s.code === code)!;
                return {
                  value: code,
                  label: (
                    <span className="flex flex-wrap items-center gap-2">
                      {spec.title}
                      {recommendation?.specialization === code ? <Badge tone="brand">рекомендуем</Badge> : null}
                    </span>
                  ),
                  description: spec.description,
                };
              })}
            />
            {specChanged ? (
              <Alert tone="warning" className="mt-4">
                При смене специализации подтверждённый грейд прежней специализации не переносится — для новой нужен отдельный тест.
              </Alert>
            ) : null}
          </Card>
          <Card>
            <ChoiceGroup
              legend={<span className="text-lg font-bold">Заявленный грейд</span>}
              hint="С этого уровня вы начнёте тестирование. Изменение заявленного грейда не меняет подтверждённую квалификацию."
              name="grade"
              columns={3}
              value={grade ? [grade] : []}
              onChange={(next) => setGrade(next[0] as Grade)}
              options={GRADES.map((code) => ({
                value: code,
                label: (
                  <span className="flex flex-wrap items-center gap-2">
                    {GRADE_LABELS[code]}
                    {recommendation?.grade === code ? <Badge tone="brand">по опросу</Badge> : null}
                  </span>
                ),
                description: GRADE_HINTS[code],
              }))}
            />
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              Изменить ответы
            </Button>
            <Button onClick={() => saveChoice.mutate()} disabled={!specialization || !grade} loading={saveChoice.isPending}>
              Сохранить и перейти к тестированию
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
