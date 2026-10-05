import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRng } from '../../src/domain/assessment/rng';

/** Корень репозитория (каталог с pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Не найден корень репозитория (pnpm-workspace.yaml)');
}

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function sha256File(file: string): string {
  return sha256(readFileSync(file));
}

export const rel = (file: string) => path.relative(repoRoot(), file).split(path.sep).join('/');

export interface GitInfo {
  commit: string | null;
  dirty: boolean | null;
  note: string;
}

export function gitInfo(): GitInfo {
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const commit = run('rev-parse', '--short', 'HEAD');
    const dirty = run('status', '--porcelain').length > 0;
    return { commit, dirty, note: dirty ? 'в рабочем дереве есть незакоммиченные изменения' : 'рабочее дерево чистое' };
  } catch {
    return { commit: null, dirty: null, note: 'git недоступен' };
  }
}

export function environmentInfo() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: cpus.length ? `${cpus[0].model.trim()} × ${cpus.length}` : 'неизвестно',
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
  };
}

// ───────────────────────────── Статистика ─────────────────────────────

export const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export const round = (value: number | null, digits = 3): number | null => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

/**
 * Бутстреп-интервал для среднего по потребностям (перевыборка потребностей с возвращением, фиксированный seed).
 * При 8–12 потребностях интервал широкий — он показывает неопределённость, а не доказывает различие.
 */
export function bootstrapMean(values: number[], seed: string, resamples = 2000): { mean: number; low: number; high: number } | null {
  if (values.length === 0) return null;
  const rng = createRng(`bootstrap|${seed}`);
  const means: number[] = [];
  for (let b = 0; b < resamples; b += 1) {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) sum += values[rng.int(0, values.length - 1)];
    means.push(sum / values.length);
  }
  return { mean: mean(values)!, low: quantile(means, 0.025)!, high: quantile(means, 0.975)! };
}

export const pct = (value: number | null, digits = 1) => (value === null ? '—' : `${(value * 100).toFixed(digits)} %`);
export const num = (value: number | null, digits = 3) => (value === null ? '—' : value.toFixed(digits));
