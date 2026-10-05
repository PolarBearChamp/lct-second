// Для ручного составления контрольных примеров: печатает ПУБЛИЧНУЮ часть экземпляра (без ключа и без ответов).
import { getFamily } from '../../src/domain/assessment/bank/registry';
import { instantiate } from '../../src/domain/assessment/instantiate';
import type { GradeCode } from '../../src/domain/catalog/catalog';

const [familyId, gradesArg, seed = 'control-1'] = process.argv.slice(2);
const family = getFamily(familyId);
if (!family) throw new Error(`Нет семейства ${familyId}`);
const grades = (gradesArg ? gradesArg.split(',') : family.supportedGrades) as GradeCode[];

for (const grade of grades) {
  const inst = instantiate(family, grade, seed);
  console.log(`\n${'═'.repeat(100)}\n${family.id} v${family.version} · ${grade} · seed=${seed} · fingerprint=${inst.fingerprint}\n${inst.public.title}`);
  for (const block of inst.public.context) {
    if (block.type === 'code') console.log(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
    else if (block.type === 'text') console.log(block.text);
    else if (block.type === 'table') {
      if (block.caption) console.log(`[${block.caption}]`);
      console.log([block.columns.join(' | '), ...block.rows.map((r) => r.map((c) => (c === null ? 'NULL' : String(c))).join(' | '))].join('\n'));
    } else console.log(block.items.map((i) => ` - ${i}`).join('\n'));
  }
  for (const part of inst.public.parts) {
    console.log(`\n[${part.id}] ${part.format}: ${part.prompt}`);
    switch (part.format) {
      case 'SINGLE_CHOICE':
      case 'MULTI_SELECT':
        for (const o of part.options) console.log(`   * ${o.label}`);
        break;
      case 'NUMERIC':
        console.log(`   (число${part.integer ? ', целое' : ''}${part.unit ? `, ${part.unit}` : ''})`);
        break;
      case 'MATCHING':
        console.log('   слева:');
        for (const o of part.left) console.log(`   L ${o.label}`);
        console.log('   справа:');
        for (const o of part.right) console.log(`   R ${o.label}`);
        break;
      case 'ORDERING':
        for (const o of part.items) console.log(`   ~ ${o.label}`);
        break;
    }
  }
}
