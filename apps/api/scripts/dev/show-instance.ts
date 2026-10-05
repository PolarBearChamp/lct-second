// Отладка: вывести экземпляр семейства с ключом в семантической форме.
import { getFamily } from '../../src/domain/assessment/bank/registry';
import { instantiate } from '../../src/domain/assessment/instantiate';

const [familyId, grade, seed] = process.argv.slice(2);
const inst = instantiate(getFamily(familyId)!, grade as 'JUNIOR', seed ?? 'example-1');
for (const block of inst.public.context) {
  if (block.type === 'code') console.log(block.code);
  else if (block.type === 'text') console.log(block.text);
  else if (block.type === 'table') console.log([block.columns.join(' | '), ...block.rows.map((r) => r.join(' | '))].join('\n'));
  else console.log(block.items.map((i) => ` - ${i}`).join('\n'));
}
const sem = inst.key.semanticMap;
for (const [i, part] of inst.public.parts.entries()) {
  const key = inst.key.parts[i];
  let answer = '';
  if (key.format === 'SINGLE_CHOICE') answer = sem[key.correctOptionId];
  if (key.format === 'MULTI_SELECT') answer = key.correctOptionIds.map((id) => sem[id]).join(', ');
  if (key.format === 'NUMERIC') answer = String(key.correctValue);
  if (key.format === 'ORDERING') answer = key.correctOrder.map((id) => sem[id].split(':')[2]).join(' → ');
  if (key.format === 'MATCHING') answer = Object.entries(key.correctPairs).map(([l, r]) => `${sem[l].split(':')[2]}=${sem[r].split(':')[2]}`).join(', ');
  console.log(`\n[${part.format}] ${part.prompt}`);
  if ('options' in part) console.log(part.options.map((o) => `   * ${o.label}`).join('\n'));
  console.log(`   => ${answer}`);
}
