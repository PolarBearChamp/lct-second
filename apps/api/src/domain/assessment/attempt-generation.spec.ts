import { generateAttemptInstances, emptyHistory, type AttemptHistory } from './attempt-generation';
import { SPECIALIZATION_CODES, type GradeCode } from '../catalog/catalog';

const policy = { itemsPerGroup: 2, maxFingerprintRetries: 40 };
const GRADES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];

/** Детерминированный источник seed: s0, s1, … */
const counter = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${n++}`;
};

const historyOf = (...attempts: ReturnType<typeof generateAttemptInstances>[]): AttemptHistory => {
  const familyUse = new Map<string, number>();
  const seenFingerprints = new Set<string>();
  for (const attempt of attempts) {
    for (const instance of attempt.instances) {
      familyUse.set(instance.familyId, (familyUse.get(instance.familyId) ?? 0) + 1);
      seenFingerprints.add(instance.fingerprint);
    }
  }
  return { familyUse, seenFingerprints };
};

describe('выбор экземпляров попытки', () => {
  it('шесть мини-кейсов: по два из каждой группы, семейства внутри попытки не повторяются', () => {
    for (const specialization of SPECIALIZATION_CODES) {
      for (const grade of GRADES) {
        const { instances, blueprint } = generateAttemptInstances(specialization, grade, policy, emptyHistory(), counter(`${specialization}-${grade}`));
        expect(instances).toHaveLength(6);
        expect(new Set(instances.map((i) => i.familyId)).size).toBe(6);
        expect(new Set(instances.map((i) => i.groupCode)).size).toBe(3);
        expect(blueprint.slots.map((s) => s.familyId)).toEqual(instances.map((i) => i.familyId));
        expect(instances.every((i) => i.grade === grade && i.specialization === specialization)).toBe(true);
      }
    }
  });

  it('при одинаковой истории и последовательности seed результат воспроизводится', () => {
    const a = generateAttemptInstances('BACKEND', 'MIDDLE', policy, emptyHistory(), counter('repro'));
    const b = generateAttemptInstances('BACKEND', 'MIDDLE', policy, emptyHistory(), counter('repro'));
    expect(b.instances.map((i) => [i.familyId, i.seed, i.fingerprint])).toEqual(a.instances.map((i) => [i.familyId, i.seed, i.fingerprint]));
    const other = generateAttemptInstances('BACKEND', 'MIDDLE', policy, emptyHistory(), counter('другой'));
    expect(other.instances.map((i) => i.seed)).not.toEqual(a.instances.map((i) => i.seed));
  });

  it('предъявленные ранее экземпляры не повторяются, пока есть альтернативы; история не изменяется', () => {
    for (const specialization of SPECIALIZATION_CODES) {
      const first = generateAttemptInstances(specialization, 'MIDDLE', policy, emptyHistory(), counter(`a-${specialization}`));
      const history = historyOf(first);
      const sizeBefore = history.seenFingerprints.size;
      const second = generateAttemptInstances(specialization, 'MIDDLE', policy, history, counter(`b-${specialization}`));
      expect(second.exactRepeats).toBe(0);
      const seen = new Set(first.instances.map((i) => i.fingerprint));
      expect(second.instances.filter((i) => seen.has(i.fingerprint))).toEqual([]);
      expect(history.seenFingerprints.size).toBe(sizeBefore);
    }
  });

  it('если альтернатив нет, допускается точный повтор и он учитывается (а не скрывается)', () => {
    const constant = () => 'один-и-тот-же-seed';
    const first = generateAttemptInstances('FRONTEND', 'JUNIOR', policy, emptyHistory(), constant);
    const repeat = generateAttemptInstances('FRONTEND', 'JUNIOR', { ...policy, maxFingerprintRetries: 3 }, historyOf(first), constant);
    expect(repeat.exactRepeats).toBe(6);
    expect(repeat.instances.map((i) => i.fingerprint)).toEqual(first.instances.map((i) => i.fingerprint));
  });
});
