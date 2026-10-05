// Стресс-проверка банка: много seed на каждую пару семейство × грейд. Ловит редкие некорректные экземпляры.
import { FAMILIES } from '../../src/domain/assessment/bank/registry';
import { correctAnswerFromKey, evaluateItem } from '../../src/domain/assessment/evaluate';
import { instantiate } from '../../src/domain/assessment/instantiate';

const count = Number(process.argv[2] ?? 1500);
const filter = process.argv[3];
let failures = 0;
const started = Date.now();
for (const family of FAMILIES.filter((f) => !filter || f.id.startsWith(filter))) {
  for (const grade of family.supportedGrades) {
    let errors = 0;
    const fingerprints = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      try {
        const inst = instantiate(family, grade, `stress-${i}`);
        fingerprints.add(inst.fingerprint);
        const full = evaluateItem(inst.key, correctAnswerFromKey(inst.key));
        if (full.earned !== full.total) throw new Error('правильный ответ не получает полный балл');
      } catch (error) {
        errors += 1;
        if (errors <= 2) console.log(`✗ ${family.id} ${grade} seed=stress-${i}: ${(error as Error).message.slice(0, 200)}`);
      }
    }
    failures += errors;
    if (errors) console.log(`  ${family.id} ${grade}: ошибок ${errors}/${count}`);
    else if (fingerprints.size < 30) console.log(`  ⚠ ${family.id} ${grade}: уникальных отпечатков ${fingerprints.size}`);
  }
}
console.log(`\nГотово за ${((Date.now() - started) / 1000).toFixed(1)} с, ошибок: ${failures}`);
process.exit(failures ? 1 : 0);
