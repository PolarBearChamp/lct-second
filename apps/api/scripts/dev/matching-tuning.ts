// Отладка данных разметки: печатает ТОЛЬКО выборку tuning (итоговая выборка final намеренно не показывается).
import { loadScenario, runMatchingValidation } from '../validation/matching';

const scenario = loadScenario();
console.log(`Данные загружены: кандидатов ${scenario.candidates.length}, потребностей ${scenario.needs.length}`);
const result = runMatchingValidation();
for (const system of result.systems) {
  console.log(`\n== ${system.name}`);
  console.log('tuning:', JSON.stringify(system.bySplit.tuning));
  for (const row of system.perNeed.filter((r) => r.split === 'tuning')) {
    console.log(`  ${row.needId}: P@5=${row.precisionAt5.toFixed(2)} nDCG=${row.ndcgAt5.toFixed(3)} возвращено=${row.returned} топ: ${row.top.map((t) => `${t.candidateId}(${t.label}${t.violates ? 'v' : ''})`).join(' ')}`);
    for (const f of row.falseExclusions) console.log(`     ложное исключение ${f.candidateId} (оценка ${f.label}): ${f.rejectedBecause.join('; ') || '—'}`);
  }
}
console.log('\nЧувствительность весов (tuning):');
for (const s of result.sensitivity) console.log(`  ${s.name.padEnd(46)} P@5=${s.tuning.precisionAt5} nDCG=${s.tuning.ndcgAt5}`);
