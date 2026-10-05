// Валидация качества: подбор (разметка, Precision@5, nDCG@5, baseline) и тестирование (генерация, контрольные примеры,
// воспроизводимость, симуляции). Работает на чистом доменном коде без БД и Nest — запускается через tsx.
//
//   pnpm validate:quality            полный прогон, пишет docs/validation-results.json и docs/validation-results.md
//   pnpm validate:quality -- --quick уменьшенные объёмы (для проверки скрипта; результаты не для отчёта)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getAssessmentPolicy, getMatchingFormula } from '../src/config/policies';
import { BANK_VERSION } from '../src/domain/assessment/bank/registry';
import { BLUEPRINT_VERSION } from '../src/domain/assessment/blueprint';
import { CATALOG_VERSION } from '../src/domain/catalog/catalog';
import { FSP_RELEVANCE_VERSION } from '../src/domain/matching/fsp-relevance';
import { MATCHING_ALGORITHM_VERSION } from '../src/domain/matching/rank';
import { environmentInfo, gitInfo, repoRoot } from './validation/common';
import { runMatchingValidation } from './validation/matching';
import { renderMarkdown, type Finding, type ValidationResults } from './validation/report';
import { DEFAULT_OPTIONS, runTestingValidation, type TestingOptions } from './validation/testing';

const quick = process.argv.includes('--quick');
const options: TestingOptions = quick
  ? { generationSeeds: 40, reproSeeds: 10, attemptsPerCell: 60, priorSeeds: 100, retakeAttempts: 3, retakeCandidates: 10 }
  : DEFAULT_OPTIONS;

const LIMITATIONS = [
  'Синтетика проверяет реализованные правила и внутреннюю согласованность, но **не доказывает** соответствие подтверждённого грейда реальной квалификации человека, психометрическую эквивалентность вариантов заданий и устойчивость к помощи LLM или справочников.',
  'Пороги прохождения (75 / 50 / 90 / 75, подтверждение навыка ≥ 2 кейса и ≥ 70) — рабочие допущения команды, научно не откалиброваны; симуляция профилей решателя не является моделью реальных людей.',
  'Разметка пар «потребность–кандидат» авторская и синтетическая, составлена теми же людьми, что реализовали формулу; внешней экспертной разметки нет. 12 потребностей (8 итоговых) — слишком мало для статистических выводов.',
  'Подбор оценивается на синтетическом пуле из 76 кандидатов; масштаб (1000+ кандидатов) и нагрузка в этом отчёте не измерялись — см. docs/implementation-status.md.',
  'Параметризация заданий снижает частоту точных повторов, но семейства внутри пары «специализация × грейд» повторяются во всех попытках, а доля частей с постоянным верным ответом (раздел 2.8) допускает подготовку по банку; это не защита от списывания.',
  'Ручные контрольные примеры привязаны к версии семейства и отпечатку экземпляра; после изменения генератора их нужно решить заново (скрипт сообщает об этом явно).',
  'Метрики подбора не обещают такого же результата на реальных данных; score — относительная мера соответствия описанной потребности, а не вероятность найма.',
];

function main(): void {
  const started = Date.now();
  const log = (message: string) => console.log(`[validate:quality] ${message}`);

  log(`Режим: ${quick ? 'быстрый (результаты не для отчёта)' : 'полный'}`);
  log('Подбор кандидатов…');
  const matching = runMatchingValidation();
  log('Тестирование…');
  const testing = runTestingValidation(options, log);

  const findingsFile = path.join(repoRoot(), 'data', 'validation', 'findings.json');
  const findings = JSON.parse(readFileSync(findingsFile, 'utf8')) as Finding[];
  const gates = [...matching.gates, ...testing.gates];
  const policy = getAssessmentPolicy('assessment-policy-v1');
  const formula = getMatchingFormula('matching-formula-v1');

  const results: ValidationResults = {
    generatedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 100) / 10,
    mode: quick ? 'quick' : 'full',
    git: gitInfo(),
    environment: environmentInfo(),
    versions: {
      'банк заданий': BANK_VERSION,
      'политика оценки': policy.version,
      'формула подбора': formula.version,
      'алгоритм подбора': MATCHING_ALGORITHM_VERSION,
      'справочник ФСП': FSP_RELEVANCE_VERSION,
      blueprint: BLUEPRINT_VERSION,
      'справочники': CATALOG_VERSION,
    },
    matching,
    testing,
    findings,
    limitations: LIMITATIONS,
    gatesOk: gates.every((g) => g.ok),
  };

  const outDir = path.join(repoRoot(), 'docs');
  mkdirSync(outDir, { recursive: true });
  const suffix = quick ? '.quick' : '';
  writeFileSync(path.join(outDir, `validation-results${suffix}.json`), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(outDir, `validation-results${suffix}.md`), `${renderMarkdown(results)}\n`, 'utf8');

  console.log('');
  for (const gate of gates) console.log(`${gate.ok ? '✓' : '✗'} ${gate.name} — ${gate.detail}`);
  const [formulaSystem, baselineSystem] = matching.systems;
  console.log('');
  console.log(`Подбор (final): формула P@5=${formulaSystem.bySplit.final.precisionAt5} nDCG@5=${formulaSystem.bySplit.final.ndcgAt5} | baseline P@5=${baselineSystem.bySplit.final.precisionAt5} nDCG@5=${baselineSystem.bySplit.final.ndcgAt5}`);
  console.log(`Записано: docs/validation-results${suffix}.json, docs/validation-results${suffix}.md (${results.durationSeconds} с)`);
  if (!results.gatesOk) {
    console.error('Есть непройденные проверки качества.');
    process.exitCode = 1;
  }
}

main();
