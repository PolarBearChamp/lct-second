import type { AssessmentPolicy } from '../../config/policies';
import type { GradeCode, SpecializationCode } from '../catalog/catalog';
import { buildStandardBlueprint, type StandardBlueprint } from './blueprint';
import { getFamily } from './bank/registry';
import { instantiate } from './instantiate';
import { createRng } from './rng';
import type { PrivateTaskInstance } from './types';

/** Что кандидат уже видел в предыдущих попытках. */
export interface AttemptHistory {
  /** Сколько раз кандидату уже выпадало каждое семейство. */
  familyUse: ReadonlyMap<string, number>;
  /** Отпечатки экземпляров, уже предъявленных кандидату. */
  seenFingerprints: ReadonlySet<string>;
}

export interface GeneratedAttempt {
  blueprint: StandardBlueprint;
  instances: PrivateTaskInstance[];
  /** Экземпляры, для которых за maxFingerprintRetries попыток не нашлось нового отпечатка (точный повтор). */
  exactRepeats: number;
}

export const emptyHistory = (): AttemptHistory => ({ familyUse: new Map(), seenFingerprints: new Set() });

/**
 * Генерация экземпляров одной попытки по общему плану специализации. Экземпляры с отпечатком, который кандидат уже
 * видел (или который уже выпал в этой же попытке), перегенерируются до maxFingerprintRetries раз; если альтернатив
 * нет, допускается точный повтор и он учитывается в exactRepeats. Функция не обращается к БД и не меняет history —
 * её использует и сервис попыток, и скрипт валидации качества.
 *
 * Порядок обращений к seedSource фиксирован (план, затем экземпляр каждого слота и его повторные попытки),
 * поэтому при детерминированном seedSource результат воспроизводим.
 */
export function generateAttemptInstances(
  specialization: SpecializationCode,
  grade: GradeCode,
  policy: Pick<AssessmentPolicy, 'itemsPerGroup' | 'maxFingerprintRetries'>,
  history: AttemptHistory,
  seedSource: () => string,
): GeneratedAttempt {
  const blueprint = buildStandardBlueprint(specialization, grade, createRng(`blueprint|${seedSource()}`), policy, new Map(history.familyUse));
  const seen = new Set(history.seenFingerprints);
  let exactRepeats = 0;
  const instances = blueprint.slots.map((slot) => {
    const family = getFamily(slot.familyId)!;
    let instance = instantiate(family, grade, seedSource());
    for (let retry = 0; retry < policy.maxFingerprintRetries && seen.has(instance.fingerprint); retry += 1) {
      instance = instantiate(family, grade, seedSource());
    }
    if (seen.has(instance.fingerprint)) exactRepeats += 1;
    seen.add(instance.fingerprint);
    return instance;
  });
  return { blueprint, instances, exactRepeats };
}
