// Общие помощники отладочных сквозных прогонов через HTTP API (не часть автотестов).
import pg from 'pg';

export const BASE = process.env.SMOKE_API ?? 'http://localhost:3001/api/v1';
const ORIGIN = 'http://localhost:3000';
const MAILPIT = 'http://localhost:8025/api/v1';
const DB = process.env.DATABASE_URL ?? 'postgresql://fsp:fsp_local_password@localhost:5433/fsp';

export class Actor {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
  }
  cookie() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async raw(method, path, body, extra = {}) {
    if (!this.jar.has('fsp_csrf') && method !== 'GET') await this.raw('GET', '/auth/csrf');
    const headers = { Origin: ORIGIN, Cookie: this.cookie(), ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.jar.has('fsp_csrf')) headers['X-CSRF-Token'] = this.jar.get('fsp_csrf');
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (!v || /Expires=Thu, 01 Jan 1970/.test(c)) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/pdf')) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
  async ok(method, path, body, extra) {
    const r = await this.raw(method, path, body, extra);
    if (r.status >= 400) {
      console.error(`✗ [${this.name}] ${method} ${path} → ${r.status}`, JSON.stringify(r.json, null, 1));
      process.exit(1);
    }
    return r.json ?? r;
  }
}

export async function registerVerified(actor, email, role) {
  await actor.ok('POST', '/auth/register', { email, password: 'Very-Strong-Pass-1', role, acceptPrivacyPolicy: true });
  await new Promise((r) => setTimeout(r, 700));
  const list = await (await fetch(`${MAILPIT}/search?query=to:${encodeURIComponent(email)}`)).json();
  const msg = await (await fetch(`${MAILPIT}/message/${list.messages[0].ID}`)).json();
  const token = /token=([A-Za-z0-9_-]+)/.exec(msg.Text)[1];
  await actor.ok('POST', '/auth/verify-email', { token });
}

export async function privateKeys(attemptId) {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  const { rows } = await client.query('SELECT id, "privateKey" FROM "AssessmentItem" WHERE "attemptId" = $1 ORDER BY position', [attemptId]);
  await client.end();
  return rows;
}

export function answerFor(key, mode = 'correct') {
  const parts = {};
  for (const p of key.parts) {
    const wrong = mode === 'wrong';
    if (p.format === 'SINGLE_CHOICE') parts[p.partId] = wrong ? null : { optionId: p.correctOptionId };
    if (p.format === 'MULTI_SELECT') parts[p.partId] = wrong ? null : { optionIds: p.correctOptionIds };
    if (p.format === 'NUMERIC') parts[p.partId] = { value: wrong ? p.correctValue + 1 : p.correctValue };
    if (p.format === 'MATCHING') parts[p.partId] = wrong ? null : { pairs: p.correctPairs };
    if (p.format === 'ORDERING') parts[p.partId] = wrong ? null : { order: p.correctOrder };
    if (parts[p.partId] === null) delete parts[p.partId];
  }
  return { parts };
}

export async function passAssessment(actor, specialization, grade, mode = 'correct') {
  const attempt = await actor.ok('POST', '/candidate/assessments', { specialization, grade });
  const rows = await privateKeys(attempt.id);
  const answers = rows.map((r) => ({ itemId: r.id, answer: answerFor(r.privateKey, mode), revision: 1 }));
  return actor.ok('POST', `/candidate/assessments/${attempt.id}/submit`, { answers });
}

export const check = (condition, label) => {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) process.exitCode = 1;
};
