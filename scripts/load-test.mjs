#!/usr/bin/env node
/**
 * Короткий нагрузочный прогон основных операций (ориентир ТЗ: «десятки пользователей одновременно»).
 *
 *   node scripts/load-test.mjs [--base http://localhost:3000] [--duration 12] [--levels 10,30,60]
 *
 * Работает через web-прокси (`/api/v1`) с настоящими сессиями демо-аккаунтов и CSRF. Защитные механизмы не отключаются,
 * поэтому число входов ограничено лимитами API: сессии создаются один раз (по одной на демо-аккаунт), а нагрузку создают
 * параллельные «виртуальные пользователи», разделяющие эти сессии.
 *
 * Измеряются задержки (p50/p95/p99), число запросов в секунду и ошибки по операциям. Это замер на одной машине с синтетическими
 * данными, а не тест производительности промышленной системы. Запрос считается ошибкой при статусе ≥ 400 (кроме явно допустимых 409).
 */
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, value, index, all) => (value.startsWith('--') ? [...acc, [value.slice(2), all[index + 1]]] : acc), []));
const BASE = args.base ?? 'http://localhost:3000';
const DURATION_MS = Number(args.duration ?? 12) * 1000;
const LEVELS = String(args.levels ?? '10,30,60').split(',').map(Number);
const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo-Password-2026';

class Session {
  cookies = new Map();
  csrf = null;

  async raw(method, path, body) {
    const headers = { Origin: BASE, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    const response = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }

  async login(email) {
    const csrf = await (await this.raw('GET', '/auth/csrf')).json();
    this.csrf = csrf.csrfToken;
    const response = await this.raw('POST', '/auth/login', { email, password: PASSWORD });
    if (!response.ok) throw new Error(`вход ${email}: ${response.status} ${await response.text()}`);
    const csrfAfter = await (await this.raw('GET', '/auth/csrf')).json();
    this.csrf = csrfAfter.csrfToken;
    return this;
  }

  async json(method, path, body) {
    const response = await this.raw(method, path, body);
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function main() {
  const employers = await Promise.all(['hr.fintech', 'hr.retail', 'hr.industry', 'hr.edu'].map((name) => new Session().login(`${name}@demo.example`)));
  const specializations = ['BACKEND', 'FRONTEND', 'ML_ENGINEER'];
  const candidates = await Promise.all(['anna.demidova', 'igor.sokolov', 'maria.volkova'].map((name) => new Session().login(`${name}@demo.example`)));

  // Подготовка: потребность и список кандидатов каждой компании (по одной потребности на сессию).
  const contexts = [];
  for (const session of employers) {
    const needs = await session.json('GET', '/employer/needs');
    // Берём первую потребность компании, по которой есть хотя бы один подходящий кандидат.
    for (const need of (needs.items ?? needs).filter((n) => n.status !== 'ARCHIVED')) {
      const selection = await session.json('POST', `/employer/needs/${need.id}/selections`, {});
      const candidateId = (selection.items ?? []).find((item) => item.candidate)?.candidate.candidateId;
      if (!candidateId) continue;
      contexts.push({ session, needId: need.id, selectionId: selection.id, candidateId, specialization: need.specialization });
      break;
    }
  }
  if (!contexts.length) throw new Error('нет потребностей для нагрузочного прогона: выполните seed');

  const bank = await employers[0].json('GET', '/employer/candidates?pageSize=1');
  console.log(`Объём данных: кандидатов в банке — ${bank.total}; потребностей и подборок демо-компаний — как после seed. Сессий: ${employers.length} работодателя и ${candidates.length} кандидата.`);

  const operations = [
    { name: 'банк кандидатов (страница 20)', weight: 4, run: (c) => c.session.raw('GET', `/employer/candidates?specialization=${c.specialization}&pageSize=20`) },
    { name: 'построение подборки (ранжирование)', weight: 2, run: (c) => c.session.raw('POST', `/employer/needs/${c.needId}/selections`, {}) },
    { name: 'сохранённая подборка', weight: 3, run: (c) => c.session.raw('GET', `/employer/selections/${c.selectionId}`) },
    { name: 'карточка кандидата с объяснением', weight: 3, run: (c) => c.session.raw('GET', `/employer/candidates/${c.candidateId}?needId=${c.needId}`) },
    { name: 'PDF карточки кандидата', weight: 1, run: (c) => c.session.raw('GET', `/employer/candidates/${c.candidateId}/pdf`) },
    { name: 'кандидат: профиль', weight: 2, run: (_c, i) => candidates[i % candidates.length].raw('GET', '/candidate/profile') },
    { name: 'кандидат: допуск к тестам', weight: 2, run: (_c, i) => candidates[i % candidates.length].raw('GET', `/candidate/assessments/eligibility?specialization=${specializations[i % candidates.length]}`) },
  ];
  const pool = operations.flatMap((op) => Array(op.weight).fill(op));

  const report = [];
  for (const level of LEVELS) {
    const stats = new Map(operations.map((op) => [op.name, { latencies: [], errors: 0 }]));
    const deadline = performance.now() + DURATION_MS;
    let total = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: level }, async (_, worker) => {
        let step = worker;
        while (performance.now() < deadline) {
          const op = pool[step % pool.length];
          step += 1;
          const context = contexts[(worker + step) % contexts.length];
          const t0 = performance.now();
          let ok = false;
          try {
            const response = await op.run(context, worker + step);
            await response.arrayBuffer();
            ok = response.status < 400;
          } catch {
            ok = false;
          }
          const entry = stats.get(op.name);
          entry.latencies.push(performance.now() - t0);
          if (!ok) entry.errors += 1;
          total += 1;
        }
      }),
    );
    const seconds = (performance.now() - started) / 1000;
    report.push({
      level,
      requests: total,
      rps: total / seconds,
      operations: [...stats].map(([name, s]) => {
        const sorted = [...s.latencies].sort((a, b) => a - b);
        return { name, count: sorted.length, errors: s.errors, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
      }),
    });
  }

  for (const row of report) {
    console.log(`\nОдновременных виртуальных пользователей: ${row.level}; запросов: ${row.requests}; ${row.rps.toFixed(0)} запросов/с`);
    console.log('| Операция | Запросов | Ошибок | p50, мс | p95, мс | p99, мс |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const op of row.operations) console.log(`| ${op.name} | ${op.count} | ${op.errors} | ${op.p50.toFixed(0)} | ${op.p95.toFixed(0)} | ${op.p99.toFixed(0)} |`);
  }
  const totalErrors = report.flatMap((r) => r.operations).reduce((sum, op) => sum + op.errors, 0);
  console.log(`\nВсего ошибок (статус ≥ 400 или сбой соединения): ${totalErrors}`);
  if (totalErrors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
