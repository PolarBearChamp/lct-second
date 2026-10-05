// Отладочный сквозной прогон пути кандидата через HTTP API (не часть тестов; правильные ответы берутся из БД).
import pg from 'pg';

const BASE = process.env.SMOKE_API ?? 'http://localhost:3001/api/v1';
const ORIGIN = 'http://localhost:3000';
const MAILPIT = 'http://localhost:8025/api/v1';
const DB = process.env.DATABASE_URL ?? 'postgresql://fsp:fsp_local_password@localhost:5433/fsp';

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function call(method, path, body, extra = {}) {
  const headers = { Origin: ORIGIN, Cookie: cookieHeader(), ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jar.has('fsp_csrf')) headers['X-CSRF-Token'] = jar.get('fsp_csrf');
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (v === '' || /Expires=Thu, 01 Jan 1970/.test(c)) jar.delete(k);
    else jar.set(k, v);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const ok = (r, label) => {
  if (r.status >= 400) {
    console.error(label, r.status, JSON.stringify(r.json, null, 1));
    process.exit(1);
  }
  console.log(`✓ ${label} → ${r.status}`);
  return r.json;
};

const email = `smoke.${Date.now()}@example.com`;
await call('GET', '/auth/csrf');
ok(await call('POST', '/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true }), 'register');
await new Promise((r) => setTimeout(r, 800));
const list = await (await fetch(`${MAILPIT}/search?query=to:${encodeURIComponent(email)}`)).json();
const msg = await (await fetch(`${MAILPIT}/message/${list.messages[0].ID}`)).json();
const token = /token=([A-Za-z0-9_-]+)/.exec(msg.Text)[1];
ok(await call('POST', '/auth/verify-email', { token }), 'verify-email');
ok(
  await call('PATCH', '/candidate/profile', {
    fullName: 'Смоук Тестовый Кандидат',
    city: 'Казань',
    timezone: 'Europe/Moscow',
    workFormats: ['REMOTE', 'HYBRID'],
    experienceMonths: 30,
    skills: [{ code: 'postgresql', months: 24 }, { code: 'nestjs', months: 12 }, { code: 'sql' }],
    disclosureChannels: ['EMAIL', 'PHONE'],
    phone: '+7 900 000-00-00',
    salaryFrom: 180000,
    salaryTo: 250000,
  }),
  'profile patch',
);
const survey = ok(
  await call('PUT', '/candidate/survey', {
    answers: { industries: ['FINTECH'], focus: 'SERVER', recentTasks: ['API', 'DB'], experience: 'Y1_3', autonomy: 'INDEPENDENT', fspParticipation: 'NO' },
  }),
  'survey',
);
console.log('  recommendation:', survey.recommendation.specialization, survey.recommendation.grade);
ok(await call('PATCH', '/candidate/profile', { activeSpecialization: 'BACKEND', declaredGrade: 'MIDDLE' }), 'choose spec');
const elig = ok(await call('GET', '/candidate/assessments/eligibility?specialization=BACKEND'), 'eligibility');
console.log('  grades:', elig.grades.map((g) => `${g.grade}:${g.allowed}`).join(' '));
const attempt = ok(await call('POST', '/candidate/assessments', { specialization: 'BACKEND', grade: 'MIDDLE' }, { 'Idempotency-Key': 'smoke-key-0001' }), 'start');
const again = await call('POST', '/candidate/assessments', { specialization: 'BACKEND', grade: 'MIDDLE' }, { 'Idempotency-Key': 'smoke-key-0001' });
console.log(`  idempotent start → ${again.status}, same id: ${again.json.id === attempt.id}`);
const second = await call('POST', '/candidate/assessments', { specialization: 'BACKEND', grade: 'JUNIOR' });
console.log(`  second start → ${second.status} ${second.json.code} ${second.json.details?.reason}`);
console.log(`  items: ${attempt.items.length}, parts: ${attempt.items.reduce((s, i) => s + i.task.parts.length, 0)}`);
console.log('  public snapshot leaks key?', JSON.stringify(attempt).includes('correct'));

const client = new pg.Client({ connectionString: DB });
await client.connect();
const { rows } = await client.query('SELECT id, "privateKey" FROM "AssessmentItem" WHERE "attemptId" = $1 ORDER BY position', [attempt.id]);
await client.end();
const answerFor = (key, wrong = false) => {
  const parts = {};
  for (const p of key.parts) {
    if (p.format === 'SINGLE_CHOICE') parts[p.partId] = { optionId: p.correctOptionId };
    if (p.format === 'MULTI_SELECT') parts[p.partId] = { optionIds: p.correctOptionIds };
    if (p.format === 'NUMERIC') parts[p.partId] = { value: wrong ? p.correctValue + 1 : p.correctValue };
    if (p.format === 'MATCHING') parts[p.partId] = { pairs: p.correctPairs };
    if (p.format === 'ORDERING') parts[p.partId] = { order: p.correctOrder };
  }
  return { parts };
};
// Автосохранение: ревизия 2, затем устаревшая ревизия 1 → 409.
ok(await call('PUT', `/candidate/assessments/${attempt.id}/answers/${rows[0].id}`, { answer: answerFor(rows[0].privateKey), revision: 2 }), 'autosave r2');
const stale = await call('PUT', `/candidate/assessments/${attempt.id}/answers/${rows[0].id}`, { answer: { parts: {} }, revision: 1 });
console.log(`  stale autosave → ${stale.status} ${stale.json.code}`);
const finals = rows.slice(1).map((r) => ({ itemId: r.id, answer: answerFor(r.privateKey), revision: 1 }));
const result = ok(await call('POST', `/candidate/assessments/${attempt.id}/submit`, { answers: finals }), 'submit');
console.log(`  status=${result.status} overall=${result.overallScore} confident=${result.confident} granted=${result.qualificationGranted}`);
console.log('  groups:', result.groups.map((g) => `${g.group}:${g.score}`).join(' '));
console.log('  skills:', result.skills.map((s) => `${s.skill}:${s.status}(${s.cases})`).join(' '));
const resubmit = ok(await call('POST', `/candidate/assessments/${attempt.id}/submit`, {}), 'resubmit (idempotent)');
console.log(`  resubmit same: ${resubmit.overallScore === result.overallScore && resubmit.status === result.status}`);
const elig2 = ok(await call('GET', '/candidate/assessments/eligibility?specialization=BACKEND'), 'eligibility after pass');
console.log('  grades:', elig2.grades.map((g) => `${g.grade}:${g.allowed}:${g.reason ?? ''}`).join(' '));
ok(await call('PUT', '/candidate/consents', { profilePublication: true }), 'consent');
ok(await call('PATCH', '/candidate/profile', { isDiscoverable: true }), 'discoverable');
const me = ok(await call('GET', '/auth/me'), 'me');
console.log('  discoverable:', me.candidate.discoverable, 'issues:', me.candidate.discoverabilityIssues.map((i) => i.code).join(','));
const preview = ok(await call('GET', '/candidate/profile/preview'), 'redacted preview');
const leaked = ['Смоук', 'smoke.', '+7 900', 'example.com'].filter((s) => JSON.stringify(preview).includes(s));
console.log('  preview leaks:', leaked.length ? leaked : 'none', '| displayName:', preview.displayName);
const quals = ok(await call('GET', '/candidate/qualifications'), 'qualifications');
console.log('  history:', quals.history.map((h) => `${h.eventType}:${h.grade}`).join(' '));
console.log(`\nSMOKE_EMAIL=${email}`);
