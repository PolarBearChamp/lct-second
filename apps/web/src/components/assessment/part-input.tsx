'use client';

import type { PartAnswer, PublicPart } from '@fsp/contracts';
import clsx from 'clsx';
import { useId, useState } from 'react';

const FORMAT_HINTS: Record<PublicPart['format'], string> = {
  SINGLE_CHOICE: 'Выберите один вариант',
  MULTI_SELECT: 'Выберите все подходящие варианты',
  NUMERIC: 'Введите число',
  MATCHING: 'Сопоставьте каждый элемент',
  ORDERING: 'Расположите элементы в правильном порядке',
};

export function isPartAnswered(part: PublicPart, answer: PartAnswer | null | undefined): boolean {
  if (!answer) return false;
  switch (part.format) {
    case 'SINGLE_CHOICE':
      return 'optionId' in answer;
    case 'MULTI_SELECT':
      return 'optionIds' in answer && answer.optionIds.length > 0;
    case 'NUMERIC':
      return 'value' in answer && Number.isFinite(answer.value);
    case 'MATCHING':
      return 'pairs' in answer && Object.keys(answer.pairs).length === part.left.length;
    case 'ORDERING':
      return 'order' in answer && answer.order.length === part.items.length;
  }
}

export function PartInput({
  part,
  index,
  answer,
  onChange,
  disabled,
}: {
  part: PublicPart;
  index: number;
  answer: PartAnswer | null | undefined;
  onChange: (answer: PartAnswer | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="rounded-xl border border-line p-4" disabled={disabled}>
      <legend className="px-1 text-sm text-muted">
        Часть {index + 1} · {FORMAT_HINTS[part.format]}
      </legend>
      <p className="mb-3 whitespace-pre-line text-[15px] font-medium">{part.prompt}</p>
      {part.format === 'SINGLE_CHOICE' ? (
        <div className="space-y-2">
          {part.options.map((option) => {
            const checked = !!answer && 'optionId' in answer && answer.optionId === option.id;
            return (
              <label key={option.id} className={clsx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', checked ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-line-strong')}>
                <input type="radio" name={`${id}-sc`} value={option.id} checked={checked} onChange={() => onChange({ optionId: option.id })} className="mt-1 h-4 w-4 accent-brand-500" />
                <span className="text-[15px]">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
      {part.format === 'MULTI_SELECT' ? (
        <div className="space-y-2">
          {part.options.map((option) => {
            const selected = answer && 'optionIds' in answer ? answer.optionIds : [];
            const checked = selected.includes(option.id);
            return (
              <label key={option.id} className={clsx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', checked ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-line-strong')}>
                <input
                  type="checkbox"
                  value={option.id}
                  checked={checked}
                  onChange={() => {
                    const next = checked ? selected.filter((idValue) => idValue !== option.id) : [...selected, option.id];
                    onChange(next.length ? { optionIds: next } : null);
                  }}
                  className="mt-1 h-4 w-4 accent-brand-500"
                />
                <span className="text-[15px]">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
      {part.format === 'NUMERIC' ? <NumericInput part={part} answer={answer} onChange={onChange} /> : null}
      {part.format === 'MATCHING' ? (
        <div className="space-y-3">
          {part.left.map((left) => {
            const pairs = answer && 'pairs' in answer ? answer.pairs : {};
            const selectId = `${id}-${left.id}`;
            return (
              <div key={left.id} className="grid gap-2 rounded-lg border border-line p-3 md:grid-cols-[1fr_minmax(220px,0.8fr)] md:items-center">
                <label htmlFor={selectId} className="text-[15px]">
                  {left.label}
                </label>
                <select
                  id={selectId}
                  className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px]"
                  value={pairs[left.id] ?? ''}
                  onChange={(event) => {
                    const next = { ...pairs };
                    if (event.target.value) next[left.id] = event.target.value;
                    else delete next[left.id];
                    onChange(Object.keys(next).length ? { pairs: next } : null);
                  }}
                >
                  <option value="">— выберите —</option>
                  {part.right.map((right) => (
                    <option key={right.id} value={right.id}>
                      {right.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      ) : null}
      {part.format === 'ORDERING' ? <OrderingInput part={part} answer={answer} onChange={onChange} /> : null}
    </fieldset>
  );
}

function NumericInput({ part, answer, onChange }: { part: Extract<PublicPart, { format: 'NUMERIC' }>; answer: PartAnswer | null | undefined; onChange: (a: PartAnswer | null) => void }) {
  const id = useId();
  const external = answer && 'value' in answer ? String(answer.value) : '';
  const [text, setText] = useState(external);
  const [error, setError] = useState<string | null>(null);
  // Синхронизация с принятым сервером значением (например, после конфликта ревизий): состояние из предыдущего рендера.
  const [syncedExternal, setSyncedExternal] = useState(external);
  if (external !== syncedExternal) {
    setSyncedExternal(external);
    if (Number(text.replace(',', '.')) !== Number(external)) setText(external);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="sr-only">
        Числовой ответ
      </label>
      <input
        id={id}
        inputMode="decimal"
        className="h-10 w-48 rounded-lg border border-line-strong bg-surface px-3 font-brand text-[15px]"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const normalized = raw.trim().replace(/\s/g, '').replace(',', '.');
          if (normalized === '') {
            setError(null);
            onChange(null);
            return;
          }
          const value = Number(normalized);
          if (!Number.isFinite(value) || !/^-?\d+(\.\d+)?$/.test(normalized)) {
            setError('Введите число, например 42 или 0.75');
            return;
          }
          if (part.integer && !Number.isInteger(value)) {
            setError('Ожидается целое число');
            return;
          }
          setError(null);
          onChange({ value });
        }}
      />
      {part.unit ? <span className="text-muted">{part.unit}</span> : null}
      {part.integer ? <span className="text-sm text-muted">целое число</span> : <span className="text-sm text-muted">можно с дробной частью</span>}
      {error ? (
        <p id={`${id}-err`} className="w-full text-[13px] font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OrderingInput({ part, answer, onChange }: { part: Extract<PublicPart, { format: 'ORDERING' }>; answer: PartAnswer | null | undefined; onChange: (a: PartAnswer | null) => void }) {
  const order = answer && 'order' in answer ? answer.order : part.items.map((item) => item.id);
  const byId = new Map(part.items.map((item) => [item.id, item]));
  const answered = !!answer && 'order' in answer;
  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ order: next });
  };
  return (
    <div>
      <ol className="space-y-2">
        {order.map((itemId, index) => (
          <li key={itemId} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            <span className="w-6 font-brand text-sm text-brand-600">{index + 1}.</span>
            <span className="min-w-0 flex-1 text-[15px]">{byId.get(itemId)?.label}</span>
            <button type="button" className="rounded-md border border-line px-2 py-1 text-sm hover:bg-canvas disabled:opacity-40" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Переместить «${byId.get(itemId)?.label}» выше`}>
              ↑
            </button>
            <button type="button" className="rounded-md border border-line px-2 py-1 text-sm hover:bg-canvas disabled:opacity-40" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label={`Переместить «${byId.get(itemId)?.label}» ниже`}>
              ↓
            </button>
          </li>
        ))}
      </ol>
      {!answered ? (
        <button type="button" className="mt-3 text-sm font-medium text-brand-600 hover:underline" onClick={() => onChange({ order })}>
          Зафиксировать текущий порядок как ответ
        </button>
      ) : (
        <p className="mt-2 text-sm text-muted">Порядок сохранён как ответ.</p>
      )}
    </div>
  );
}
