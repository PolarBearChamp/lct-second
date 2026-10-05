// Генерация data/fixtures/fsp-mock.json: сохраняет вручную написанных участников FSP-DEMO-* и пересоздаёт FSP-SEED-*.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildAllSeedParticipants } from './seed/fsp-data';

const file = path.resolve(__dirname, '../../../data/fixtures/fsp-mock.json');
const current = JSON.parse(readFileSync(file, 'utf8')) as { _comment: string; registry: string; participants: Array<{ participant_id: string }> };
const manual = current.participants.filter((p) => !p.participant_id.startsWith('FSP-SEED-'));
const next = { ...current, participants: [...manual, ...buildAllSeedParticipants()] };
writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`fsp-mock.json: вручную ${manual.length}, сгенерировано ${next.participants.length - manual.length}`);
