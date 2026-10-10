import { getSpecialization, type GradeCode } from '../../src/domain/catalog/catalog';
import type { GitInfo } from './common';
import { num, pct } from './common';
import type { GradingResults, ScenarioResult } from './grading';
import type { Aggregate, MatchingResults, NeedMetrics } from './matching';
import type { ResumeResults } from './resume';
import type { CellResult, TestingResults } from './testing';

export interface Finding {
  id: string;
  area: string;
  foundBy: string;
  found: string;
  cause: string;
  action: string;
  status: string;
}

export interface ValidationResults {
  generatedAt: string;
  durationSeconds: number;
  mode: 'full' | 'quick';
  git: GitInfo;
  environment: { node: string; platform: string; cpu: string; memoryGb: number };
  versions: Record<string, string>;
  matching: MatchingResults;
  testing: TestingResults;
  grading: GradingResults;
  resume: ResumeResults;
  findings: Finding[];
  limitations: string[];
  gatesOk: boolean;
}

const md = (rows: string[][]) => {
  const [head, ...body] = rows;
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
};

const GRADE_RU: Record<GradeCode, string> = { JUNIOR: 'Junior', MIDDLE: 'Middle', SENIOR: 'Senior' };
const specTitle = (code: string) => getSpecialization(code)?.title ?? code;
const mark = (ok: boolean) => (ok ? '✓' : '✗');
const aggRow = (name: string, a: Aggregate) => [
  name,
  String(a.needs),
  num(a.precisionAt5, 2),
  num(a.precisionStrictAt5, 2),
  num(a.precisionReturned, 2),
  num(a.ndcgAt5, 3),
  pct(a.violationRatePooled),
  `${a.needsWithAnyViolation} из ${a.needs}`,
  pct(a.coverage, 0),
  `${a.falseExclusions} из ${a.relevantTotal}`,
];
const AGG_HEAD = ['Система', 'Потребностей', 'Precision@5', 'Precision@5 (только «2»)', 'Precision по возвращённым', 'nDCG@5', 'Нарушения условий в top-5', 'Потребностей с нарушением', 'Покрытие непустой выдачей', 'Допустимые (≥1), не попавшие в выдачу'];

function matchingSection(r: ValidationResults): string {
  const m = r.matching;
  const [formula, baseline] = m.systems;
  const finalFormula = formula.bySplit.final;
  const lines: string[] = [];
  lines.push('## 1. Подбор кандидатов');
  lines.push('');
  lines.push('### 1.1 Данные и протокол');
  lines.push('');
  lines.push(
    md([
      ['Показатель', 'Значение'],
      ['Кандидатов в пуле', String(m.sizes.candidates) + ` (из них скрытых: ${m.sizes.hiddenCandidates})`],
      ['Оценочных потребностей', `${m.sizes.needs} (tuning: ${m.sizes.tuningNeeds}, final: ${m.sizes.finalNeeds})`],
      ['Размеченных пар «потребность–кандидат»', `${m.sizes.labeledPairs}: «2» — ${m.sizes.labelCounts['2']}, «1» — ${m.sizes.labelCounts['1']}, «0» — ${m.sizes.labelCounts['0']}`],
      ['Версии', `алгоритм ${m.version.algorithm}, формула ${m.version.formula}, справочник ФСП ${m.version.fspRelevance}`],
      ['Веса формулы', `${m.formula.needWeights.preferredFit} · preferredFit + ${m.formula.needWeights.assessmentQuality} · assessmentQuality + ${m.formula.needWeights.fspEvidence} · fspEvidence; заявленный навык ×${m.formula.selfReportedCredit}`],
      ['SHA-256 формулы', `\`${m.formulaSha256.slice(0, 16)}…\``],
    ]),
  );
  lines.push('');
  lines.push('Файлы разметки (контроль неизменности):');
  lines.push('');
  lines.push(md([['Файл', 'SHA-256'], ...m.datasets.map((d) => [`\`${d.file}\``, `\`${d.sha256.slice(0, 16)}…\``])]));
  lines.push('');
  lines.push('Протокол:');
  lines.push('');
  for (const line of m.protocol) lines.push(`* ${line}`);
  lines.push('* Precision@5 делит число релевантных (оценка ≥ 1) на **5**, даже если выдача короче; «Precision по возвращённым» делит на фактическое число результатов (среднее по потребностям с непустой выдачей). nDCG@5 — с линейными выигрышами 0/1/2 и дисконтом 1/log₂(i+1); идеальный порядок строится по разметке всего пула специализации.');
  lines.push('* Нарушение условий — доля возвращённых в top-5 кандидатов, у которых по разметке нарушено явное условие потребности (флаг `v`); «допустимые, не попавшие в выдачу» — пары с оценкой ≥ 1, которых выдача не содержит вообще (жёсткие фильтры или baseline-фильтр).');
  lines.push('* Baseline: те же кандидаты, отфильтрованные только по специализации и допустимому грейду, отсортированные по общему баллу теста (как в ТЗ).');
  lines.push('');
  lines.push('### 1.2 Итоговая выборка (final) — основной результат');
  lines.push('');
  lines.push(md([AGG_HEAD, aggRow(formula.name, finalFormula), aggRow(baseline.name, baseline.bySplit.final)]));
  lines.push('');
  const fi = (name: string, system: typeof formula) => {
    const p = system.finalIntervals.precisionAt5;
    const n = system.finalIntervals.ndcgAt5;
    return `${name}: Precision@5 ${num(p?.mean ?? null, 2)} [${num(p?.low ?? null, 2)}; ${num(p?.high ?? null, 2)}], nDCG@5 ${num(n?.mean ?? null, 3)} [${num(n?.low ?? null, 3)}; ${num(n?.high ?? null, 3)}]`;
  };
  lines.push(`95 %-интервалы (бутстреп по потребностям, ${finalFormula.needs} потребностей, фиксированный seed): ${fi('формула', formula)}; ${fi('baseline', baseline)}.`);
  lines.push('');
  lines.push(
    `Парная разница «формула − baseline» по потребностям final: ${m.pairedDifference
      .map((d) => `${d.metric === 'precisionAt5' ? 'Precision@5' : 'nDCG@5'} ${d.mean >= 0 ? '+' : ''}${num(d.mean, 3)} [${num(d.low, 3)}; ${num(d.high, 3)}]`)
      .join('; ')}.`,
  );
  lines.push('');
  lines.push('Выборок мало (8 итоговых потребностей), интервалы широкие: результат показывает направление на синтетических данных, а не статистически значимое превосходство.');
  lines.push('');
  lines.push('По специализациям (final):');
  lines.push('');
  lines.push(
    md([
      ['Специализация', 'Система', 'Precision@5', 'nDCG@5', 'Нарушения в top-5', 'Выдача короче 5'],
      ...[formula, baseline].flatMap((system) =>
        Object.entries(system.bySpecialization).map(([spec, a]) => [specTitle(spec), system === formula ? 'формула' : 'baseline', num(a.precisionAt5, 2), num(a.ndcgAt5, 3), pct(a.violationRatePooled), `${a.shorterThan5} из ${a.needs}`]),
      ),
    ]),
  );
  lines.push('');
  lines.push('### 1.3 Выборка tuning (отладка данных; веса по ней не подбирались)');
  lines.push('');
  lines.push(md([AGG_HEAD, aggRow(formula.name, formula.bySplit.tuning), aggRow(baseline.name, baseline.bySplit.tuning)]));
  lines.push('');
  lines.push('### 1.4 Выдача по каждой потребности (top-5; в скобках оценка разметки, `v` — нарушено явное условие)');
  lines.push('');
  const topText = (row: NeedMetrics) => (row.top.length ? row.top.map((t) => `${t.candidateId}(${t.label}${t.violates ? 'v' : ''})`).join(' ') : '— пусто —');
  lines.push(
    md([
      ['Потребность', 'Выборка', 'Релевантных в пуле (из них «2»)', 'Формула: P@5 / nDCG', 'Формула: top-5', 'Baseline: P@5 / nDCG', 'Baseline: top-5'],
      ...formula.perNeed.map((row, i) => {
        const b = baseline.perNeed[i];
        return [row.needId, row.split, `${row.relevantInPool} (${row.strongInPool})`, `${num(row.precisionAt5, 2)} / ${num(row.ndcgAt5, 3)}${row.returned < 5 ? ` (возвращено ${row.returned})` : ''}`, topText(row), `${num(b.precisionAt5, 2)} / ${num(b.ndcgAt5, 3)}`, topText(b)];
      }),
    ]),
  );
  lines.push('');
  lines.push('### 1.5 Допустимые кандидаты, исключённые жёсткими условиями');
  lines.push('');
  if (m.falseExclusionList.length === 0) {
    lines.push('Нет.');
  } else {
    lines.push('Это не ошибки реализации, а следствие правил ТЗ (обязательный навык должен быть подтверждён тестом; вилки зарплат должны пересекаться): строгий фильтр теряет часть кандидатов, которых человек счёл бы допустимыми.');
    lines.push('');
    lines.push(md([['Потребность', 'Кандидат', 'Оценка', 'Причина исключения', 'Обоснование разметки'], ...m.falseExclusionList.map((f) => [f.needId, f.candidateId, String(f.label), f.rejectedBecause.join('; ') || '—', f.why])]));
  }
  lines.push('');
  lines.push('### 1.6 Чувствительность к весам (информационно)');
  lines.push('');
  lines.push('Итоговые веса заданы ТЗ и не менялись. Варианты ниже показывают, насколько метрики вообще реагируют на веса на этих данных. Столбец «final (post-hoc)» посчитан уже после фиксации весов и **не использовался для выбора**.');
  lines.push('');
  lines.push(
    md([
      ['Вариант', 'preferredFit / quality / ФСП', 'вклад заявленного навыка', 'tuning P@5', 'tuning nDCG@5', 'final (post-hoc) P@5', 'final (post-hoc) nDCG@5'],
      ...m.sensitivity.map((s) => [s.name, `${s.needWeights.preferredFit} / ${s.needWeights.assessmentQuality} / ${s.needWeights.fspEvidence}`, String(s.selfReportedCredit), num(s.tuning.precisionAt5, 2), num(s.tuning.ndcgAt5, 3), num(s.finalPostHoc.precisionAt5, 2), num(s.finalPostHoc.ndcgAt5, 3)]),
    ]),
  );
  lines.push('');
  lines.push('### 1.7 Что показывает и чего не показывает этот раздел');
  lines.push('');
  lines.push('* Разметка авторская и синтетическая, выполнена теми же людьми, что реализовали формулу; внешней экспертной оценки нет, поэтому метрики проверяют согласованность с задуманным смыслом, а не качество подбора для реальных работодателей.');
  lines.push('* Основной вклад в превосходство над baseline дают жёсткие условия (формат работы, зарплатная вилка, подтверждённые обязательные навыки), которых в baseline нет; сравнение порядка среди прошедших фильтры — слабая часть набора (см. находку F4).');
  lines.push('* В набор намеренно включены случаи, где формула ошибается по разметке (исключённые «допустимые» кандидаты, кандидат с ожиданиями ниже вилки). Метрики не «подогнаны» под 1.0 и не обещают такого результата на реальных данных.');
  lines.push('* Score — относительная мера соответствия описанной потребности, а не вероятность найма или процент пригодности.');
  return lines.join('\n');
}

const cellName = (c: Pick<CellResult, 'specialization' | 'grade'>) => `${specTitle(c.specialization)} · ${GRADE_RU[c.grade]}`;

function testingSection(r: ValidationResults): string {
  const t = r.testing;
  const lines: string[] = [];
  lines.push('## 2. Тестирование и банк заданий');
  lines.push('');
  lines.push('### 2.1 Параметры прогона');
  lines.push('');
  lines.push(
    md([
      ['Параметр', 'Значение'],
      ['Версия банка', `\`${t.bankVersion}\`; семейств ${t.families}, пар «семейство × грейд» ${t.familyGradePairs}`],
      ['Политика оценки', `${t.policy.version}: ${t.policy.durationMinutes} мин, ${t.policy.itemsPerGroup} мини-кейса на группу, проходной общий балл ${t.policy.passOverall}, минимум по группе ${t.policy.passGroupMin}, «уверенно» ${t.policy.confidentOverall}/${t.policy.confidentGroupMin}, навык подтверждается при ≥ ${t.policy.skillEvidence.minCases} кейсах и ≥ ${t.policy.skillEvidence.minScore}`],
      ['Корректность генерации', `${t.options.generationSeeds} seed (\`gen-0…\`) на каждую пару — ${t.generation.totalInstances} экземпляров`],
      ['Воспроизводимость', `${t.options.reproSeeds} seed на пару, ${Math.ceil(t.options.reproSeeds / 2)} попыток на пару «специализация × грейд»`],
      ['Симуляции', `${t.options.attemptsPerCell} попыток на пару «специализация × грейд» (12 пар), seed \`sim-<спец>-<грейд>-<номер>\``],
      ['Оценка распределения верных ответов', `${t.options.priorSeeds} seed на пару (\`prior-0…\`)`],
      ['Повторные попытки', `${t.options.retakeCandidates} кандидатов × ${t.options.retakeAttempts} последовательных попыток на пару «специализация × грейд»`],
    ]),
  );
  lines.push('');
  lines.push('### 2.2 Корректность генерации');
  lines.push('');
  const c = t.generation.checkTotals;
  lines.push(
    `Сгенерировано ${t.generation.totalInstances} экземпляров, ошибок генерации и структурной проверки: **${t.generation.totalErrors}**. ` +
      `Минимум различающихся отпечатков на пару — **${t.generation.minDistinctFingerprints}** из ${t.options.generationSeeds} seed (требование ТЗ — не менее 30). ` +
      `Дополнительные проверки на каждом экземпляре: верный ответ по ключу не получил полного балла — ${c.correctNotFull}; пустой ответ получил баллы — ${c.emptyNotZero}; заведомо неверный получил баллы — ${c.wrongNotZero}; «выбрать все» в MULTI_SELECT дал баллы — ${c.selectAllFull}; ключ или пояснение в публичной части — ${c.keyLeak}; недопустимый допуск числовой части — ${c.badTolerance}; показанный порядок ORDERING совпал с верным — ${c.shape}.`,
  );
  lines.push('');
  lines.push(
    md([
      ['Семейство', 'Грейд', 'Различающихся отпечатков', 'P(совпадения отпечатков)', 'Частей в кейсе', 'Сложность min / p50 / max (CV)', 'Форматы частей', 'мс / экземпляр'],
      ...t.generation.rows.map((row) => [
        `\`${row.family}\``,
        GRADE_RU[row.grade],
        `${row.distinctFingerprints} / ${row.seeds}`,
        String(row.fingerprintCollisionProbability),
        row.parts.min === row.parts.max ? String(row.parts.min) : `${row.parts.min}–${row.parts.max}`,
        `${row.complexity.min} / ${row.complexity.p50} / ${row.complexity.max} (${row.complexity.cv})`,
        Object.entries(row.formats).map(([f, n]) => `${f.replace('_', ' ').toLowerCase()} ${n}`).join(', '),
        String(row.msPerInstance),
      ]),
    ]),
  );
  lines.push('');
  lines.push('«P(совпадения отпечатков)» — вероятность, что два независимых экземпляра пары совпадут (Σ pᵢ² по эмпирическому распределению); «Сложность» — структурная оценка экземпляра (число шагов, ловушек и т. п.), CV — коэффициент вариации.');
  lines.push('');
  lines.push('### 2.3 Вручную решённые контрольные примеры');
  lines.push('');
  const k = t.controls;
  lines.push(
    `Контрольных примеров: **${k.total}** из ${k.expected} возможных пар «семейство × грейд»; проходят: **${k.pass}**; расходятся с ключом или пробами: ${k.fail}; устарели по версии семейства: ${k.stale}; экземпляр изменился: ${k.changed}. ` +
      `Ответы на каждый экземпляр записаны человеком по публичному условию, из них строится ${k.probes} неверных и граничных проб (виды: ${Object.entries(k.probeKinds)
        .map(([kind, n]) => `${kind} — ${n}`)
        .join('; ')}).`,
  );
  lines.push('');
  lines.push(md([['Семейство', 'Версия', 'Junior', 'Middle', 'Senior'], ...k.perFamily.map((f) => [`\`${f.family}\``, `v${f.version}`, mark(f.grades.JUNIOR === 'PASS'), mark(f.grades.MIDDLE === 'PASS'), mark(f.grades.SENIOR === 'PASS')])]));
  lines.push('');
  lines.push('Находки, сделанные при подготовке контрольных примеров и валидации (журнал `data/validation/findings.json`):');
  lines.push('');
  lines.push(md([['№', 'Область', 'Чем найдено', 'Что найдено', 'Что сделано', 'Статус'], ...r.findings.map((f) => [f.id, f.area, f.foundBy, f.found, f.action, f.status])]));
  lines.push('');
  lines.push('### 2.4 Воспроизводимость');
  lines.push('');
  const p = t.reproducibility;
  lines.push(
    md([
      ['Проверка', 'Результат'],
      ['Экземпляр с тем же seed и версией: условие, ключ и отпечаток идентичны', `${p.instancePairs - p.instanceMismatches} из ${p.instancePairs}`],
      ['Попытка с тем же источником seed: те же семейства и экземпляры', `${p.attemptPairs - p.attemptMismatches} из ${p.attemptPairs}`],
      ['Одинаковые ответы на воспроизведённую попытку дают идентичную оценку', `${p.attemptPairs - p.scoreMismatches} из ${p.attemptPairs}`],
      ['Разные seed: экземпляры отличаются (контроль, что seed вообще влияет)', `совпали ${p.differentSeedsDiffer.identical} из ${p.differentSeedsDiffer.pairs}`],
    ]),
  );
  lines.push('');
  lines.push('### 2.5 Стратегии ответов (по 300 попыток на пару)');
  lines.push('');
  lines.push('Ячейка: средний общий балл / доля прохождений. «Знает банк» — кандидат, который ответил на каждую часть самым частым верным ответом из 400 прошлых экземпляров (верхняя оценка пользы от запоминания банка без решения).');
  lines.push('');
  const strat = (cell: CellResult, name: string) => {
    const s = cell.strategies.find((x) => x.strategy === name)!;
    return `${num(s.overall.mean, 1)} / ${pct(s.passRate, 1)}`;
  };
  lines.push(
    md([
      ['Специализация · грейд', 'Верные', 'Без ответов', 'Неверные', 'Выбрать всё', 'Случайно', 'Знает банк'],
      ...t.cells.map((cell) => [cellName(cell), strat(cell, 'верные ответы'), strat(cell, 'без ответов'), strat(cell, 'заведомо неверные'), strat(cell, '«выбрать всё / первый вариант»'), strat(cell, 'случайное угадывание'), strat(cell, 'знает банк (самый частый верный ответ)')]),
    ]),
  );
  lines.push('');
  const memo = t.cells.map((cell) => cell.strategies.find((s) => s.strategy === 'знает банк (самый частый верный ответ)')!);
  lines.push(
    `«Знает банк»: средний балл по ячейкам ${num(Math.min(...memo.map((s) => s.overall.mean ?? 0)), 1)}–${num(Math.max(...memo.map((s) => s.overall.mean ?? 0)), 1)}, максимальный балл одной попытки ${Math.max(...memo.map((s) => s.overall.max ?? 0))}, наибольшая доля прохождений ${pct(Math.max(...memo.map((s) => s.passRate)))}.`,
  );
  lines.push('');
  lines.push('### 2.6 Синтетические профили решателя (только симуляция)');
  lines.push('');
  lines.push('Профиль задаёт вероятность верного ответа на часть задания в каждой из трёх групп; при ошибке подставляется заведомо неверный ответ. Это не модель реального человека: разброс отражает дискретность оценки (6 кейсов, 12–24 части), а не сложность вариантов.');
  lines.push('');
  const profileNames = t.cells[0].profiles.map((x) => x.profile);
  const avg = (name: string, pick: (x: CellResult['profiles'][number]) => number | null) => {
    const values = t.cells.map((cell) => pick(cell.profiles.find((x) => x.profile === name)!)).filter((v): v is number => v !== null);
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  lines.push(
    md([
      ['Профиль', 'Описание', 'Средний балл (sd внутри ячеек)', 'Прохождение: среднее [min; max] по ячейкам', '«Уверенно»', 'Согласованность pass/fail (измерено / ожидаемо)', 'Баллы по группам 1 / 2 / 3'],
      ...profileNames.map((name) => {
        const rates = t.cells.map((cell) => cell.profiles.find((x) => x.profile === name)!.passRate);
        const accuracy = t.cells[0].profiles.find((x) => x.profile === name)!.accuracy;
        const groups = [0, 1, 2].map((g) => num(avg(name, (x) => x.groupMeans[g]), 1)).join(' / ');
        return [
          name,
          accuracy.map((a) => `${Math.round(a * 100)}%`).join(' / '),
          `${num(avg(name, (x) => x.overall.mean), 1)} (${num(avg(name, (x) => x.overall.sd), 1)})`,
          `${pct(avg(name, (x) => x.passRate))} [${pct(Math.min(...rates))}; ${pct(Math.max(...rates))}]`,
          pct(avg(name, (x) => x.confidentRate)),
          `${num(avg(name, (x) => x.consistencyEmpirical), 3)} / ${num(avg(name, (x) => x.consistencyExpected), 3)}`,
          groups,
        ];
      }),
    ]),
  );
  lines.push('');
  lines.push('Доля прохождений по парам «специализация × грейд»:');
  lines.push('');
  lines.push(md([['Специализация · грейд', ...profileNames], ...t.cells.map((cell) => [cellName(cell), ...cell.profiles.map((x) => pct(x.passRate, 1))])]));
  lines.push('');
  const unbalanced = t.cells.map((cell) => cell.profiles.find((x) => x.profile === 'сильный, но слабая группа 3')!);
  lines.push(
    `Профиль «сильный, но слабая группа 3»: общий балл в среднем ${num(avg('сильный, но слабая группа 3', (x) => x.overall.mean), 1)}, прохождений ${pct(avg('сильный, но слабая группа 3', (x) => x.passRate))}; среди непрошедших попыток отказ только по порогу группы (общий ≥ 75): ${unbalanced.reduce((s, x) => s + x.failedByGroupOnly, 0)}, только по общему баллу: ${unbalanced.reduce((s, x) => s + x.failedByOverallOnly, 0)}, по обоим: ${unbalanced.reduce((s, x) => s + x.failedByBoth, 0)} — порог по группам действительно отсекает «перекошенных» решателей.`,
  );
  lines.push('');
  lines.push('### 2.7 Повторы экземпляров и пересечение семейств между попытками');
  lines.push('');
  lines.push(
    md([
      ['Специализация · грейд', 'Точные повторы с исключением виденных (как в сервисе)', 'Точные повторы без исключения', 'Совпадение семейств между попытками', 'Доля экземпляров того же семейства, отличных от прошлой попытки'],
      ...t.cells.map((cell) => [cellName(cell), `${pct(cell.retakes.exactRepeatRateWithDedup, 2)} (${cell.retakes.exactRepeatsWithDedup} из ${cell.retakes.slotsAfterFirst})`, pct(cell.retakes.exactRepeatRateWithoutDedup, 2), pct(cell.retakes.familyOverlapMean, 0), pct(cell.retakes.sameFamilyDifferentInstanceShare, 1)]),
    ]),
  );
  lines.push('');
  lines.push('В банке ровно по два семейства на группу, а в тест входят два кейса каждой группы, поэтому **набор семейств во всех попытках одной пары «специализация × грейд» совпадает полностью**; различаются только параметры экземпляров. Параметризация снижает точные повторы, но не является защитой от списывания и подготовки по банку.');
  lines.push('');
  lines.push('### 2.8 Ответы, одинаковые во всех экземплярах');
  lines.push('');
  const ca = t.constantAnswers;
  lines.push(
    `Из ${ca.totalParts} частей банка (по одному экземпляру на пару) в **${ca.constantParts}** (${pct(ca.share)}) верный ответ одинаков не менее чем в 90 % экземпляров — такие части проверяют знание, а не решение конкретных условий, и поддаются запоминанию. Это граница защитных свойств параметризации.`,
  );
  lines.push('');
  const bySpec = new Map<string, { parts: number; constant: number }>();
  for (const row of ca.rows) {
    const spec = row.family.startsWith('fe.') ? 'FRONTEND' : row.family.startsWith('be.') ? 'BACKEND' : row.family.startsWith('ml.') ? 'ML_ENGINEER' : 'MANUAL_QA';
    const e = bySpec.get(spec) ?? { parts: 0, constant: 0 };
    e.parts += row.parts;
    e.constant += row.constantParts;
    bySpec.set(spec, e);
  }
  lines.push(md([['Специализация', 'Частей', 'С постоянным ответом', 'Доля'], ...[...bySpec.entries()].map(([spec, e]) => [specTitle(spec), String(e.parts), String(e.constant), pct(e.constant / e.parts)])]));
  lines.push('');
  lines.push(`Время генерации одной попытки (6 экземпляров): ${num(Math.min(...t.cells.map((c) => c.attemptGenerationMs)), 1)}–${num(Math.max(...t.cells.map((c) => c.attemptGenerationMs)), 1)} мс на этой машине.`);
  return lines.join('\n');
}

const LEVEL_NAMES = ['нет уровня', 'Junior', 'Middle', 'Senior'];

function gradingSection(r: ValidationResults): string {
  const g = r.grading;
  const m = g.main;
  const lines: string[] = [];
  lines.push('### 2.9 Определение грейда: повторное прохождение (test-retest) и разделяющая сила заданий');
  lines.push('');
  lines.push(
    'Ответ организаторов на вопрос о проверке стабильности грейда: ожидается повторное прохождение теста одним и тем же профилем со сравнением присвоенных грейдов и оценка разделяющей силы заданий; допустима симуляция на синтетических кандидатах (PR.1).',
  );
  lines.push('');
  lines.push('**Модель (допущение команды, не измерение на людях).**');
  lines.push('');
  lines.push(
    `* У кандидата скрытая способность θ; трудность заданий: Junior ${g.model.difficulties.Junior}, Middle ${g.model.difficulties.Middle}, Senior ${g.model.difficulties.Senior}. Часть задания кандидат «знает» с вероятностью logistic(1,7·(θ − b)); иначе отвечает наугад тем же случайным ответом, что и стратегия «случайное угадывание» (вероятность угадать у каждого формата своя).`,
  );
  lines.push(
    `* Истинный уровень: нет уровня / Junior / Middle / Senior; центр θ — на ${g.model.levelOffset} выше трудности своего уровня (на своём уровне кандидат знает около 90 % частей), разброс внутри уровня σ = ${g.model.sigma}. По ${g.options.candidatesPerLevel} кандидатов на каждый уровень в каждой из 4 специализаций (${m.candidates} кандидатов, ${m.attempts} попыток).`,
  );
  lines.push(
    `* Процедура как в продукте: кандидат заявляет грейд (честно — ${Math.round(g.model.claimShares.honest * 100)} %, на ступень выше — ${Math.round(g.model.claimShares.over * 100)} %, на ступень ниже — ${Math.round(g.model.claimShares.under * 100)} %), проходит тест; при неуспехе сразу пробует уровень ниже; присвоенный грейд — первый пройденный или «нет». Автоматического повышения нет. Повтор — тот же профиль, новые экземпляры с исключением виденных отпечатков (как в сервисе).`,
  );
  lines.push('');
  lines.push('**Согласованность при повторном прохождении.**');
  lines.push('');
  lines.push(
    md([
      ['Показатель', 'Значение'],
      ['Совпадение присвоенных грейдов', pct(m.retestAgreement)],
      ['Каппа Коэна, взвешенная (линейные веса), 95 % интервал', `${num(m.kappaWeighted.value)} (${num(m.kappaWeighted.low)}–${num(m.kappaWeighted.high)})`],
      ['Каппа Коэна, невзвешенная', num(m.kappaUnweighted)],
    ]),
  );
  lines.push('');
  lines.push('Присвоенный грейд: строки — первое прохождение, столбцы — второе:');
  lines.push('');
  lines.push(md([['1-е \\ 2-е', ...LEVEL_NAMES], ...m.retestMatrix.map((row, i) => [LEVEL_NAMES[i], ...row.map(String)])]));
  lines.push('');
  lines.push('**Точность присвоения** (первое прохождение). Строки — истинный уровень, столбцы — присвоенный:');
  lines.push('');
  lines.push(md([['Истинный \\ присвоенный', ...LEVEL_NAMES], ...m.truthMatrix.map((row, i) => [LEVEL_NAMES[i], ...row.map(String)])]));
  lines.push('');
  const claimTitle: Record<string, string> = { honest: 'заявил свой уровень', over: 'заявил выше своего', under: 'заявил ниже своего' };
  lines.push(
    md([
      ['Как заявлен грейд', 'Кандидатов', 'Присвоен верно', 'Завышен', 'Занижен (выдан, но ниже)', 'Не выдан при наличии уровня'],
      ...m.byClaim.map((c) => [claimTitle[c.mode], String(c.n), pct(c.exact), pct(c.over), pct(c.under), pct(c.notIssued)]),
      ['все', String(m.candidates), pct(m.overall.exact), pct(m.overall.over), pct(m.overall.under), pct(m.overall.notIssued)],
    ]),
  );
  lines.push('');
  lines.push(
    'Кандидат, заявивший ниже своего уровня, получает не выше заявленного: платформа не повышает грейд автоматически (по ТЗ и по ответам организаторов), поэтому для повышения нужен отдельный тест на следующий уровень. Завышение у честно заявивших — доля кандидатов, которым присвоен уровень выше истинного.',
  );
  lines.push('');
  lines.push('**Чувствительность к допущениям модели** (меньшие выборки):');
  lines.push('');
  const sens = (s: ScenarioResult) => {
    const honest = s.byClaim.find((c) => c.mode === 'honest')!;
    return [s.name, String(s.candidates), pct(s.retestAgreement), `${num(s.kappaWeighted.value)} (${num(s.kappaWeighted.low)}–${num(s.kappaWeighted.high)})`, pct(honest.exact), pct(honest.over), pct(honest.notIssued)];
  };
  lines.push(
    md([
      ['Сценарий', 'Кандидатов', 'Совпадение при повторе', 'κ взвешенная', 'Верно у честно заявивших', 'Завышение', 'Не выдан при наличии уровня'],
      sens(m),
      ...g.sensitivity.map(sens),
    ]),
  );
  lines.push('');
  const s = g.itemSummary;
  const broken = g.sensitivity.flatMap((x) => {
    const honest = x.byClaim.find((c) => c.mode === 'honest')!;
    const problems = [
      ...(x.retestAgreement < 0.8 ? [`совпадение при повторе ${pct(x.retestAgreement)} (порог 80 %)`] : []),
      ...(x.kappaWeighted.value !== null && x.kappaWeighted.value < 0.6 ? [`κ ${num(x.kappaWeighted.value)} (порог 0,6)`] : []),
      ...(honest.over > 0.05 ? [`завышение у честно заявивших ${pct(honest.over)} (порог 5 %)`] : []),
    ];
    return problems.length ? [`«${x.name}»: ${problems.join(', ')}`] : [];
  });
  lines.push(
    broken.length
      ? `Пороги основного сценария выдерживаются не при всех допущениях: ${broken.join('; ')}. Качество определения грейда зависит от того, насколько трудность банка соответствует уровням — а на реальных людях она не калибровалась (пилот остаётся обязательным).`
      : 'Во всех проверенных вариантах допущений пороги основного сценария выдерживаются.',
  );
  lines.push('');
  lines.push(
    `При более трудном банке растёт доля «не выдан при наличии уровня» (кандидат с уровнем не проходит тест): ${pct(g.sensitivity.find((x) => x.shift > 0)?.byClaim.find((c) => c.mode === 'honest')?.notIssued ?? null)} у честно заявивших; при более лёгком — завышение: ${pct(g.sensitivity.find((x) => x.shift < 0)?.byClaim.find((c) => c.mode === 'honest')?.over ?? null)}. Это две стороны одной настройки порога и трудности.`,
  );
  lines.push('');
  lines.push('**Разделяющая сила заданий.** Для каждой пары «семейство × грейд» по всем попыткам этого грейда в основном прогоне:');
  lines.push('');
  lines.push(
    `* корреляция балла кейса со средним баллом остальных кейсов попытки: медиана ${num(s.medianCorrelation)}, отрицательных — ${s.negativeCorrelations} из ${s.pairs};`,
  );
  lines.push(
    `* индекс различения D (верхние 27 % попыток по остальным кейсам минус нижние 27 %): медиана ${num(s.medianD)}; D ≥ 0,2 у ${s.dAtLeast02} из ${s.withD} пар (${pct(s.dShare)});`,
  );
  lines.push(`* разница среднего балла кейса между кандидатами этого уровня и уровня ниже: медиана ${num(s.medianGap)}, неположительная у ${s.nonPositiveGap} пар.`);
  lines.push('');
  lines.push('Пары с наименьшим индексом D:');
  lines.push('');
  const worst = [...g.items].filter((i) => i.discriminationD !== null).sort((a, b) => a.discriminationD! - b.discriminationD!).slice(0, 12);
  lines.push(
    md([
      ['Семейство', 'Грейд', 'Попыток', 'Корреляция с остальными', 'D', 'Балл на своём уровне', 'Балл на уровень ниже', 'Разница'],
      ...worst.map((i) => [`\`${i.family}\``, GRADE_RU[i.grade], String(i.attempts), num(i.itemRestCorrelation), num(i.discriminationD), num(i.meanAtLevel), num(i.meanBelow), num(i.levelGap)]),
    ]),
  );
  lines.push('');
  lines.push(
    `Как читать: в модели все задания одного грейда одинаково трудны, поэтому различия между парами определяются долей угадывания (формат ответа, число вариантов) и составом тех, кто проходит этот грейд. Слабее всего различают задания Senior${worst.every((i) => i.grade === 'SENIOR') ? ' (все 12 пар таблицы)' : ''}: тест Senior проходят в основном кандидаты Senior, диапазон способностей узкий, и корреляция неизбежно ниже (ограничение диапазона). Это свойство модели и состава, а не доказательство слабости конкретных заданий. Таблица по всем ${s.pairs} парам — в docs/validation-results.json (grading.items).`,
  );
  lines.push('');
  lines.push(
    'Чего раздел не показывает: способность и трудность заданы командой, поэтому согласованность и разделяющая сила проверяют правила присвоения и устройство банка в рамках этой модели; реальные люди могут вести себя иначе (подготовка по банку, усталость, подсказки). Для выводов о надёжности нужен пилот с настоящими кандидатами.',
  );
  return lines.join('\n');
}

function resumeSection(r: ValidationResults): string {
  const res = r.resume;
  const table = (scores: ResumeResults['synthetic']['scores']) =>
    md([['Поле', 'Метрика', 'Значение', 'Проверено'], ...scores.map((s) => [s.field, s.metric, s.value === null ? '—' : pct(s.value), String(s.n)])]);
  const out: string[] = [];
  out.push('## 3. Распознавание PDF-резюме');
  out.push('');
  out.push('Правила и словари справочников платформы, без ML и внешних сервисов (`apps/api/src/domain/resume/parse.ts`). Результат — предложения для профиля; кандидат применяет их сам.');
  out.push('');
  out.push(`### 3.1 Синтетическая выборка: ${res.synthetic.resumes} резюме (${res.synthetic.perLayout} на каждую из ${res.synthetic.layouts.length} вёрсток), разметка известна заранее`);
  out.push('');
  out.push(table(res.synthetic.scores));
  out.push('');
  out.push('Вёрстки: ' + res.synthetic.layouts.map((l, i) => `${i + 1}) ${l}`).join('; ') + '.');
  out.push('');
  out.push('По вёрсткам (F1 навыков / ФИО / стаж ±12 мес.):');
  out.push('');
  const cell = (scores: ResumeResults['synthetic']['scores'], field: string, metric: string) => {
    const v = scores.find((s) => s.field === field && s.metric === metric)?.value;
    return v === null || v === undefined ? '—' : pct(v);
  };
  out.push(md([['Вёрстка', 'F1 навыков', 'ФИО', 'Стаж ±12 мес.', 'Телефон', 'Email'], ...res.synthetic.byLayout.map((l) => [l.layout, cell(l.scores, 'Навыки', 'F1'), cell(l.scores, 'ФИО', 'точное совпадение'), cell(l.scores, 'Стаж', 'отклонение ≤ 12 мес.'), cell(l.scores, 'Телефон', 'точное совпадение (после нормализации)'), cell(l.scores, 'Email', 'точное совпадение')])]));
  out.push('');
  out.push(`### 3.2 Независимый ручной набор: ${res.handwritten.cases} резюме`);
  out.push('');
  out.push(table(res.handwritten.scores));
  out.push('');
  out.push(res.handwritten.misses.length ? 'Расхождения с разметкой (парсер не подгонялся под эти случаи):' : 'Расхождений с разметкой нет.');
  out.push('');
  if (res.handwritten.misses.length) out.push(md([['Резюме', 'Поле', 'Ожидалось', 'Получено'], ...res.handwritten.misses.map((m) => [m.caseId, m.field, m.expected, m.actual])]));
  out.push('');
  out.push('Ограничения этого раздела:');
  out.push('');
  for (const item of res.limitations) out.push(`* ${item}`);
  return out.join('\n');
}

export function renderMarkdown(r: ValidationResults): string {
  const lines: string[] = [];
  lines.push('# Результаты валидации качества');
  lines.push('');
  lines.push('> Файл сформирован командой `pnpm validate:quality` (`docs/validation-results.json` — те же данные в машинном виде). Все числа получены этим запуском; вручную в отчёт ничего не добавлено, кроме журнала находок `data/validation/findings.json`. Данные синтетические, разметка авторская.');
  lines.push('');
  lines.push('## Запуск');
  lines.push('');
  lines.push(
    md([
      ['Параметр', 'Значение'],
      ['Время запуска (UTC)', r.generatedAt],
      ['Длительность', `${r.durationSeconds} с (режим: ${r.mode === 'full' ? 'полный' : 'быстрый'})`],
      ['Коммит', r.git.commit ? `\`${r.git.commit}\` (${r.git.note})` : r.git.note],
      ['Окружение', `Node ${r.environment.node}; ${r.environment.platform}; ${r.environment.cpu}; ОЗУ ${r.environment.memoryGb} ГБ`],
      ['Версии правил', Object.entries(r.versions).map(([k, v]) => `${k}: \`${v}\``).join('; ')],
      ['Фиксированные seed', 'генерация `gen-<i>`, воспроизводимость `repro-<i>`, симуляции `sim-<спец>-<грейд>-<i>`, бутстреп `bootstrap|<метрика>`; все генераторы детерминированы'],
    ]),
  );
  lines.push('');
  lines.push('## Сводка проверок');
  lines.push('');
  const gates = [...r.matching.gates, ...r.testing.gates, ...r.grading.gates, ...r.resume.gates];
  lines.push(md([['Проверка', 'Итог', 'Данные'], ...gates.map((g) => [g.name, mark(g.ok), g.detail])]));
  lines.push('');
  lines.push(`Итог: ${r.gatesOk ? '**все проверки пройдены**' : '**есть непройденные проверки**'}.`);
  lines.push('');
  lines.push(matchingSection(r));
  lines.push('');
  lines.push(testingSection(r));
  lines.push('');
  lines.push(gradingSection(r));
  lines.push('');
  lines.push(resumeSection(r));
  lines.push('');
  lines.push('## 4. Ограничения');
  lines.push('');
  for (const item of r.limitations) lines.push(`* ${item}`);
  lines.push('');
  return lines.join('\n');
}
