// Манифест банка заданий: версии, семейства, грейды, навыки, форматы и число различающихся экземпляров.
// Пишет data/assessment-bank/manifest.json и data/assessment-bank/README.md.
//
//   pnpm bank:manifest
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assessableSkills, BANK_VERSION, FAMILIES } from '../src/domain/assessment/bank/registry';
import { instantiate } from '../src/domain/assessment/instantiate';
import { getGroup, getSkill, getSpecialization, SPECIALIZATION_CODES, type GradeCode } from '../src/domain/catalog/catalog';
import { repoRoot } from './validation/common';

const SEEDS = 300;

interface GradeEntry {
  grade: GradeCode;
  note: string;
  distinctInstances: number;
  seedsTried: number;
  parts: { min: number; max: number };
  formats: Record<string, number>;
}

const families = FAMILIES.map((family) => ({
  id: family.id,
  version: family.version,
  specialization: family.specialization,
  group: family.group,
  groupTitle: getGroup(family.group)?.title ?? family.group,
  title: family.title,
  description: family.description,
  skillTags: family.skillTags,
  grades: family.supportedGrades.map((grade): GradeEntry => {
    const fingerprints = new Set<string>();
    const formats: Record<string, number> = {};
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const instance = instantiate(family, grade, `manifest-${i}`);
      fingerprints.add(instance.fingerprint);
      min = Math.min(min, instance.public.parts.length);
      max = Math.max(max, instance.public.parts.length);
      if (i === 0) for (const part of instance.public.parts) formats[part.format] = (formats[part.format] ?? 0) + 1;
    }
    return { grade, note: family.gradeNotes[grade], distinctInstances: fingerprints.size, seedsTried: SEEDS, parts: { min, max }, formats };
  }),
}));

const skills = SPECIALIZATION_CODES.map((spec) => ({
  specialization: spec,
  skills: [...assessableSkills(spec).entries()].sort().map(([skill, ids]) => ({ skill, title: getSkill(skill)?.title ?? skill, families: ids })),
}));

const manifest = {
  bankVersion: BANK_VERSION,
  note: 'Определения заданий — код в apps/api/src/domain/assessment/bank; экземпляры генерируются детерминированно из (семейство, версия, грейд, seed). Различающиеся экземпляры считаются по отпечатку значимых условий (без учёта порядка вариантов).',
  families: families.length,
  familyGradePairs: families.reduce((sum, f) => sum + f.grades.length, 0),
  minDistinctInstances: Math.min(...families.flatMap((f) => f.grades.map((g) => g.distinctInstances))),
  seedsTried: SEEDS,
  familiesDetail: families,
  skillsBySpecialization: skills,
};

const dir = path.join(repoRoot(), 'data', 'assessment-bank');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const lines: string[] = [];
lines.push('# Банк заданий');
lines.push('');
lines.push(`Версия банка: \`${BANK_VERSION}\` · семейств: ${manifest.families} · пар «семейство × грейд»: ${manifest.familyGradePairs} · минимум различающихся экземпляров на пару при ${SEEDS} seed: **${manifest.minDistinctInstances}**.`);
lines.push('');
lines.push('Файл сформирован `pnpm bank:manifest` (машинная форма — `manifest.json`). Определения семейств — код в `apps/api/src/domain/assessment/bank/`: экземпляр детерминированно строится из (семейство, версия, грейд, seed), публичная часть и закрытый ключ разделены, снимок экземпляра хранится в попытке и не зависит от последующих изменений банка.');
lines.push('');
for (const spec of SPECIALIZATION_CODES) {
  lines.push(`## ${getSpecialization(spec)?.title ?? spec}`);
  lines.push('');
  lines.push('| Семейство | Версия | Группа | Навыки | Грейд | Различающихся экземпляров | Частей | Что меняется в грейде |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const family of families.filter((f) => f.specialization === spec)) {
    family.grades.forEach((g, index) => {
      lines.push(
        `| ${index === 0 ? `\`${family.id}\` — ${family.title}` : ''} | ${index === 0 ? `v${family.version}` : ''} | ${index === 0 ? family.groupTitle : ''} | ${index === 0 ? family.skillTags.join(', ') : ''} | ${g.grade} | ${g.distinctInstances} из ${g.seedsTried} | ${g.parts.min === g.parts.max ? g.parts.min : `${g.parts.min}–${g.parts.max}`} (${Object.entries(g.formats).map(([f, n]) => `${f} ${n}`).join(', ')}) | ${g.note} |`,
      );
    });
  }
  lines.push('');
  lines.push('Проверяемые навыки (навык подтверждается, только если реально оценён ≥ 2 кейсами и результат ≥ 70):');
  lines.push('');
  for (const item of skills.find((s) => s.specialization === spec)!.skills) lines.push(`* \`${item.skill}\` (${item.title}) — ${item.families.map((f) => `\`${f}\``).join(', ')}`);
  lines.push('');
}
writeFileSync(path.join(dir, 'README.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(`Манифест записан: data/assessment-bank/manifest.json, README.md (версия ${BANK_VERSION}, минимум различающихся экземпляров ${manifest.minDistinctInstances})`);
