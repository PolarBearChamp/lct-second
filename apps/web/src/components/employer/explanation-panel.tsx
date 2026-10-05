import type { MatchExplanation } from '@fsp/contracts';

/**
 * Объяснение подбора из реальных данных правил (без LLM и выдуманных причин).
 * Score — относительная мера соответствия потребности, а не вероятность найма.
 */
export function ExplanationPanel({ explanation, score }: { explanation: MatchExplanation; score: number }) {
  const c = explanation.components;
  const parts = [
    { label: 'Желательные навыки', comp: c.preferredFit, color: 'bg-brand-500' },
    { label: 'Качество теста', comp: c.assessmentQuality, color: 'bg-brand-300' },
    { label: 'Бонус ФСП', comp: c.fspEvidence, color: 'bg-accent-red' },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-bold text-success-700">Почему подходит</h4>
        <ul className="space-y-1.5 text-[14px]">
          {explanation.why.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="text-success-600" aria-hidden>
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-bold text-warning-700">Что пока не подтверждено</h4>
        {explanation.notVerified.length ? (
          <ul className="space-y-1.5 text-[14px]">
            {explanation.notVerified.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-warning-600" aria-hidden>
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Все желательные навыки подтверждены тестом.</p>
        )}
      </div>
      <div className="lg:col-span-2">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-muted">Вклад в оценку соответствия</span>
          <span className="font-brand font-bold">{score.toFixed(1)} / 100</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
          {parts.map((p) => (
            <div key={p.label} className={p.color} style={{ width: `${p.comp.contribution}%` }} />
          ))}
        </div>
        <ul className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-3">
          {parts.map((p) => (
            <li key={p.label}>
              {p.label}: {p.comp.value.toFixed(2)} × {p.comp.weight} = <strong className="text-ink">{p.comp.contribution.toFixed(1)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
