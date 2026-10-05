// Отладочный предпросмотр банка: разнообразие экземпляров и пример условия.
import { FAMILIES } from '../../src/domain/assessment/bank/registry';
import { instantiate } from '../../src/domain/assessment/instantiate';

const familyFilter = process.argv[2];
const show = process.argv[3];
for (const family of FAMILIES.filter((f) => !familyFilter || f.id.startsWith(familyFilter))) {
  const line: string[] = [];
  for (const grade of family.supportedGrades) {
    const fps = new Set<string>();
    for (let i = 0; i < 300; i += 1) fps.add(instantiate(family, grade, `preview-${i}`).fingerprint);
    line.push(`${grade}=${fps.size}`);
  }
  console.log(family.id.padEnd(32), line.join('  '));
  if (show) {
    const inst = instantiate(family, show as 'JUNIOR', 'example-1');
    console.log(JSON.stringify({ public: inst.public, key: inst.key.parts }, null, 1).slice(0, 6000));
  }
}
