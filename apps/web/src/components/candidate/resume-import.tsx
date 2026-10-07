'use client';

import {
  GRADE_LABELS,
  SPECIALIZATION_LABELS,
  type OwnProfileResponse,
  type ProfileUpdate,
  type ResumeAnalysisResponse,
  type ResumeConfidence,
  type ResumeFieldKey,
} from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatMonths } from '@/lib/format';
import { queryKeys, useReference } from '@/lib/queries';

const MAX_BYTES = 5 * 1024 * 1024;

const CONFIDENCE: Record<ResumeConfidence, { label: string; tone: Tone }> = {
  HIGH: { label: 'уверенно', tone: 'success' },
  MEDIUM: { label: 'проверьте', tone: 'info' },
  LOW: { label: 'предположение', tone: 'warning' },
};

interface Row {
  key: ResumeFieldKey;
  label: string;
  /** Что будет записано в профиль. */
  proposed: string;
  /** Что в профиле сейчас (для сравнения). */
  current: string;
  /** Поле списка: значения добавляются к существующим, а не заменяют их. */
  additive: boolean;
  apply: (update: ProfileUpdate) => void;
  confidence: ResumeConfidence | undefined;
}

/** Блок «Заполнить из PDF-резюме»: загрузка → предложения → выборочное применение обычным обновлением профиля. */
export function ResumeImport({ data }: { data: OwnProfileResponse }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reference = useReference().data;
  const input = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<ResumeAnalysisResponse | null>(null);
  const [selected, setSelected] = useState<Set<ResumeFieldKey>>(new Set());
  const [fileName, setFileName] = useState<string | null>(null);

  const titleOf = (list: Array<{ code: string; title: string }> | undefined, code: string) => list?.find((item) => item.code === code)?.title ?? code;

  const buildRows = (result: ResumeAnalysisResponse): Row[] => {
    const s = result.suggestion;
    const p = data.profile;
    const rows: Row[] = [];
    const scalar = (key: ResumeFieldKey, label: string, proposed: string | null, current: string | null | undefined, apply: (u: ProfileUpdate) => void) => {
      if (proposed) rows.push({ key, label, proposed, current: current ?? '', additive: false, apply, confidence: s.confidence[key] });
    };
    scalar('fullName', 'ФИО', s.fullName, p.fullName, (u) => (u.fullName = s.fullName));
    scalar('contactEmail', 'Контактный email', s.contactEmail, p.contactEmail, (u) => (u.contactEmail = s.contactEmail));
    scalar('phone', 'Телефон', s.phone, p.phone, (u) => (u.phone = s.phone));
    scalar('messenger', 'Мессенджер', s.messenger, p.messenger, (u) => (u.messenger = s.messenger));
    scalar('city', 'Город', s.city, p.city, (u) => (u.city = s.city));
    scalar('timezone', 'Часовой пояс', s.timezone ? titleOf(reference?.timezones, s.timezone) : null, p.timezone ? titleOf(reference?.timezones, p.timezone) : '', (u) => (u.timezone = s.timezone));
    if (s.experienceMonths !== null) {
      rows.push({
        key: 'experienceMonths',
        label: 'Опыт по специальности',
        proposed: formatMonths(s.experienceMonths),
        current: p.experienceMonths !== null ? formatMonths(p.experienceMonths) : '',
        additive: false,
        apply: (u) => (u.experienceMonths = s.experienceMonths),
        confidence: s.confidence.experienceMonths,
      });
    }
    if (s.activeSpecialization) {
      rows.push({
        key: 'activeSpecialization',
        label: 'Специализация',
        proposed: SPECIALIZATION_LABELS[s.activeSpecialization],
        current: p.activeSpecialization ? SPECIALIZATION_LABELS[p.activeSpecialization] : '',
        additive: false,
        apply: (u) => (u.activeSpecialization = s.activeSpecialization),
        confidence: s.confidence.activeSpecialization,
      });
    }
    if (s.declaredGrade) {
      rows.push({
        key: 'declaredGrade',
        label: 'Заявленный грейд (самооценка)',
        proposed: GRADE_LABELS[s.declaredGrade],
        current: p.declaredGrade ? GRADE_LABELS[p.declaredGrade] : '',
        additive: false,
        apply: (u) => (u.declaredGrade = s.declaredGrade),
        confidence: s.confidence.declaredGrade,
      });
    }
    const existingSkills = new Map(p.skills.map((skill) => [skill.code, skill.months]));
    const newSkills = s.skills.filter((skill) => !existingSkills.has(skill.code) || (existingSkills.get(skill.code) === null && skill.months !== null));
    if (newSkills.length) {
      rows.push({
        key: 'skills',
        label: 'Стек (добавится к текущему)',
        proposed: newSkills.map((skill) => `${skill.title}${skill.months ? ` · ${formatMonths(skill.months)}` : ''}`).join(', '),
        current: p.skills.length ? `уже указано: ${p.skills.length}` : '',
        additive: true,
        apply: (u) => {
          const merged = new Map(p.skills.map((skill) => [skill.code, skill.months]));
          for (const skill of s.skills) if (!merged.has(skill.code) || merged.get(skill.code) === null) merged.set(skill.code, skill.months);
          u.skills = [...merged.entries()].slice(0, 40).map(([code, months]) => ({ code, months }));
        },
        confidence: s.confidence.skills,
      });
    }
    const additiveList = (key: ResumeFieldKey, label: string, proposed: string[], existing: string[], names: (code: string) => string, apply: (u: ProfileUpdate, merged: string[]) => void, limit: number) => {
      const fresh = proposed.filter((code) => !existing.includes(code));
      if (fresh.length) {
        rows.push({
          key,
          label: `${label} (добавятся к текущим)`,
          proposed: fresh.map(names).join(', '),
          current: existing.length ? `уже указано: ${existing.length}` : '',
          additive: true,
          apply: (u) => apply(u, [...existing, ...fresh].slice(0, limit)),
          confidence: s.confidence[key],
        });
      }
    };
    additiveList('teamRoles', 'Роли в команде', s.teamRoles, p.teamRoles, (c) => titleOf(reference?.teamRoles, c), (u, merged) => (u.teamRoles = merged), 8);
    additiveList('softSkills', 'Soft skills', s.softSkills, p.softSkills, (c) => titleOf(reference?.softSkills, c), (u, merged) => (u.softSkills = merged), 10);
    additiveList('industries', 'Отрасли интереса', s.industries, p.industries, (c) => titleOf(reference?.industries, c), (u, merged) => (u.industries = merged), 12);
    additiveList('externalLinks', 'Ссылки', s.externalLinks, p.externalLinks, (c) => c, (u, merged) => (u.externalLinks = merged), 5);
    scalar('experienceDescription', 'Описание опыта (видно работодателю только после принятия приглашения или отклика)', s.experienceDescription, p.experienceDescription, (u) => (u.experienceDescription = s.experienceDescription));
    return rows;
  };

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<ResumeAnalysisResponse>('/candidate/profile/resume', file, 'application/pdf'),
    onSuccess: (result) => {
      setAnalysis(result);
      // По умолчанию отмечены безопасные предложения: пустые поля профиля и дополнения списков без пометки «предположение».
      const defaults = new Set<ResumeFieldKey>();
      for (const row of buildRows(result)) if ((row.current === '' || row.additive) && row.confidence !== 'LOW') defaults.add(row.key);
      setSelected(defaults);
    },
    onError: (error) => {
      setAnalysis(null);
      notify(errorMessage(error), 'danger');
    },
  });

  const rows = analysis ? buildRows(analysis) : [];
  const apply = useMutation({
    mutationFn: () => {
      const update: ProfileUpdate = {};
      for (const row of rows) if (selected.has(row.key)) row.apply(update);
      return api.patch<OwnProfileResponse>('/candidate/profile', update);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.ownProfile, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      notify(`Применено полей: ${selected.size}. Проверьте профиль и нажмите «Сохранить» при необходимости правок`);
      setAnalysis(null);
      setFileName(null);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      notify('Нужен файл в формате PDF', 'danger');
      return;
    }
    if (file.size > MAX_BYTES) {
      notify('Файл больше 5 МБ — сожмите его или загрузите другой', 'danger');
      return;
    }
    setFileName(file.name);
    upload.mutate(file);
  };

  return (
    <Card className="mb-6" aria-labelledby="resume-import-title">
      <CardHeader
        title={<span id="resume-import-title">Заполнить из PDF-резюме</span>}
        description="Загрузите резюме — платформа распознает ФИО, контакты, стек, роли, стаж и soft skills и предложит заполнить профиль. Файл не сохраняется; применяется только то, что вы отметите."
      />
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          id="resume-file"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label="PDF-файл резюме"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <Button type="button" variant="outline" loading={upload.isPending} onClick={() => input.current?.click()}>
          Выбрать PDF
        </Button>
        <span className="text-sm text-muted">{upload.isPending ? `Распознаём «${fileName}»…` : fileName && analysis ? `Файл: ${fileName}` : 'PDF с текстовым слоем до 5 МБ; сканы (картинки) не распознаются'}</span>
      </div>

      {upload.isError ? (
        <Alert tone="danger" title="Не удалось распознать резюме" className="mt-4">
          {errorMessage(upload.error)}
        </Alert>
      ) : null}

      {analysis ? (
        <div className="mt-5 space-y-4" role="region" aria-label="Результат распознавания">
          <p className="text-sm text-ink-soft">
            Найдено полей: {analysis.source.recognizedFields} · страниц: {analysis.source.pages}
            {analysis.source.truncated ? ' (разобраны не все: лимит 10 страниц)' : ''}. {analysis.notice}
          </p>
          {analysis.suggestion.warnings.map((warning) => (
            <Alert key={warning} tone="warning">
              {warning}
            </Alert>
          ))}
          {rows.length === 0 ? (
            <Alert tone="neutral" title="Ничего подходящего не найдено">
              Заполните профиль вручную — или загрузите другое резюме.
            </Alert>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {rows.map((row) => (
                  <li key={row.key} className="p-3">
                    <Checkbox
                      checked={selected.has(row.key)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(row.key);
                        else next.delete(row.key);
                        setSelected(next);
                      }}
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{row.label}</span>
                          {row.confidence ? <Badge tone={CONFIDENCE[row.confidence].tone}>{CONFIDENCE[row.confidence].label}</Badge> : null}
                        </span>
                      }
                      description={
                        <span className="block break-words">
                          <span className="text-ink">{row.proposed.length > 400 ? `${row.proposed.slice(0, 400)}…` : row.proposed}</span>
                          {row.current && !row.additive ? <span className="block text-warning-700">Заменит: {row.current.length > 120 ? `${row.current.slice(0, 120)}…` : row.current}</span> : null}
                          {row.current && row.additive ? <span className="block">{row.current}</span> : null}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" loading={apply.isPending} disabled={selected.size === 0} onClick={() => apply.mutate()}>
                  Применить выбранное ({selected.size})
                </Button>
                <Button type="button" variant="outline" onClick={() => setAnalysis(null)}>
                  Отмена
                </Button>
                <span className="text-xs text-muted">Навыки, стаж и грейд из резюме — самоописание; подтверждённую категорию даёт только тест.</span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
