import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SPECIALIZATION_CODES } from '../catalog/catalog';
import { FAMILIES } from './bank/registry';
import { runControl, type ControlEntry } from './controls';

const dir = path.resolve(__dirname, '../../../../../data/validation/controls');
const entries: ControlEntry[] = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .flatMap((file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as ControlEntry[]);

describe('контрольные примеры банка (решены вручную по публичному условию)', () => {
  it('охватывают каждую пару «семейство × грейд» ровно одним контролем', () => {
    const expected = FAMILIES.flatMap((family) => family.supportedGrades.map((grade) => `${family.id}:${grade}`)).sort();
    const actual = entries.map((entry) => `${entry.family}:${entry.grade}`).sort();
    expect(actual).toEqual(expected);
    expect(new Set(SPECIALIZATION_CODES).size).toBe(4);
    expect(entries.length).toBe(FAMILIES.length * 3);
  });

  it.each(entries.map((entry) => [`${entry.family} · ${entry.grade}`, entry] as const))('%s: ручной ответ принят, неверные и граничные отклонены', (_name, entry) => {
    const result = runControl(entry);
    expect({ error: result.error, handMismatches: result.handMismatches, probeFailures: result.probeFailures }).toEqual({ error: undefined, handMismatches: [], probeFailures: [] });
    expect(result.status).toBe('PASS');
    expect(result.probes).toBeGreaterThan(result.parts);
  });
});
