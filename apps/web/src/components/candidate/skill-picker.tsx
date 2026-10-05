'use client';

import type { SkillInfo, Specialization } from '@fsp/contracts';
import { useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/field';

export interface PickedSkill {
  code: string;
  months: number | null;
}

/** Выбор стека из справочника: поиск, отметка, опыт в месяцах. Навыки остаются «указано кандидатом». */
export function SkillPicker({
  catalog,
  value,
  onChange,
  specialization,
  verified,
}: {
  catalog: SkillInfo[];
  value: PickedSkill[];
  onChange: (next: PickedSkill[]) => void;
  specialization: Specialization | null;
  verified: Set<string>;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const selected = new Set(value.map((s) => s.code));
  const byCode = useMemo(() => new Map(catalog.map((s) => [s.code, s])), [catalog]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.code.includes(q))
      .sort((a, b) => {
        const relA = specialization && a.specializations.includes(specialization) ? 0 : 1;
        const relB = specialization && b.specializations.includes(specialization) ? 0 : 1;
        return relA - relB || a.title.localeCompare(b.title, 'ru');
      })
      .slice(0, 60);
  }, [catalog, query, specialization]);

  const toggle = (code: string) => {
    if (selected.has(code)) onChange(value.filter((s) => s.code !== code));
    else onChange([...value, { code, months: null }]);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <label htmlFor={`${id}-search`} className="text-sm font-medium">
          Поиск по справочнику
        </label>
        <Input
          id={`${id}-search`}
          className="mt-1.5"
          placeholder="Например, PostgreSQL или React"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2" aria-label="Навыки справочника">
          {filtered.map((skill) => {
            const assessable = specialization ? skill.assessableIn.includes(specialization) : false;
            return (
              <li key={skill.code}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-canvas">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500"
                    checked={selected.has(skill.code)}
                    onChange={() => toggle(skill.code)}
                  />
                  <span className="min-w-0 flex-1 text-[15px]">{skill.title}</span>
                  {assessable ? (
                    <span className="text-[11px] text-brand-600" title="Этот навык проверяется заданиями теста вашей специализации">
                      проверяется тестом
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
          {filtered.length === 0 ? <li className="px-2 py-1.5 text-sm text-muted">Ничего не найдено</li> : null}
        </ul>
      </div>
      <div>
        <div className="text-sm font-medium">Ваш стек ({value.length})</div>
        {value.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Выберите навыки слева. Можно указать опыт в месяцах.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {value.map((skill) => {
              const info = byCode.get(skill.code);
              return (
                <li key={skill.code} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="basis-full text-[15px] font-medium">{info?.title ?? skill.code}</span>
                  {verified.has(skill.code) ? <Badge tone="success">проверено тестом</Badge> : <Badge>указано вами</Badge>}
                  <span className="flex-1" aria-hidden />
                  <label className="flex items-center gap-1.5 text-sm text-muted">
                    <span className="sr-only">Опыт с навыком {info?.title}, месяцев</span>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      inputMode="numeric"
                      placeholder="мес."
                      className="h-8 w-20 rounded-md border border-line-strong px-2 text-sm"
                      value={skill.months ?? ''}
                      onChange={(event) => {
                        const months = event.target.value === '' ? null : Math.max(0, Math.min(600, Number(event.target.value)));
                        onChange(value.map((s) => (s.code === skill.code ? { ...s, months } : s)));
                      }}
                    />
                    мес.
                  </label>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-danger-700 hover:bg-danger-50"
                    onClick={() => toggle(skill.code)}
                    aria-label={`Убрать ${info?.title ?? skill.code}`}
                  >
                    Убрать
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
