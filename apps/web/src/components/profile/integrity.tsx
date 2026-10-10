import type { IntegrityLevel, IntegrityView } from '@fsp/contracts';
import { Badge } from '@/components/ui/badge';

const DISCLAIMER =
  'Сигналы фиксируются автоматически и ничего не доказывают: уход со вкладки, вставка или быстрое решение могут иметь обычные причины. Они не влияют на баллы и грейд — это дополнительная информация о прохождении.';

/** Компактная отметка уровня сигналов; при отсутствии замечаний ничего не показывает. */
export function IntegrityBadge({ level }: { level: IntegrityLevel | null | undefined }) {
  if (!level || level === 'NONE') return null;
  return (
    <Badge
      tone={level === 'ATTENTION' ? 'warning' : 'neutral'}
      title="Сигналы при прохождении теста. Информация, на баллы и грейд не влияет — подробности в карточке кандидата"
    >
      {level === 'ATTENTION' ? 'Заметные отметки при прохождении' : 'Отметки при прохождении'}
    </Badge>
  );
}

/** Сводка сигналов: нейтральные формулировки и пояснение, что это информация, а не доказательство. */
export function IntegritySummary({ integrity }: { integrity: IntegrityView | null | undefined }) {
  if (!integrity) return null;
  return (
    <div className="space-y-2 text-sm" data-testid="integrity-summary">
      <div className="font-medium">
        Сигналы при прохождении:{' '}
        <span className="font-normal text-muted">
          {integrity.level === 'NONE' ? 'отметок нет' : integrity.level === 'ATTENTION' ? 'есть заметные отметки' : 'есть отметки'}
        </span>
      </div>
      {integrity.signals.length ? (
        <ul className="space-y-1">
          {integrity.signals.map((signal) => (
            <li key={signal.code} className="flex items-start gap-2">
              <span
                aria-hidden
                className={
                  signal.severity === 'ATTENTION' ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning-700' : 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted'
                }
              />
              <span>{signal.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted">{DISCLAIMER}</p>
    </div>
  );
}
