import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { unprocessable } from '../../common/errors';

/** Ограничения разбора недоверенного PDF: размер и число страниц, объём текста, время и память процесса. */
export const RESUME_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPages: 10,
  maxChars: 60_000,
  timeoutMs: 20_000,
  maxOldSpaceMb: 256,
  maxOutputBytes: 1024 * 1024,
} as const;

function workerPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'assets/pdf/pdf-text-worker.mjs'),
    path.resolve(process.cwd(), 'apps/api/assets/pdf/pdf-text-worker.mjs'),
    path.resolve(__dirname, '../../../../assets/pdf/pdf-text-worker.mjs'),
    path.resolve(__dirname, '../../../assets/pdf/pdf-text-worker.mjs'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Не найден assets/pdf/pdf-text-worker.mjs');
  return found;
}

type WorkerResult = { text: string; pages: number; truncated: boolean } | { error: 'PASSWORD' | 'INVALID' };

function runWorker(data: Buffer): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = workerPath();
    const child = spawn(process.execPath, [`--max-old-space-size=${RESUME_LIMITS.maxOldSpaceMb}`, worker], {
      cwd: path.dirname(worker),
      env: { ...process.env, PDF_MAX_PAGES: String(RESUME_LIMITS.maxPages), PDF_MAX_CHARS: String(RESUME_LIMITS.maxChars) },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const out: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    }, RESUME_LIMITS.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > RESUME_LIMITS.maxOutputBytes) {
        child.kill('SIGKILL');
        finish(() => reject(Object.assign(new Error('output too large'), { code: 'OUTPUT' })));
        return;
      }
      out.push(chunk);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', () =>
      finish(() => {
        try {
          resolve(JSON.parse(Buffer.concat(out).toString('utf8')) as WorkerResult);
        } catch {
          reject(Object.assign(new Error('worker failed'), { code: 'WORKER' }));
        }
      }),
    );
    child.stdin.on('error', () => undefined); // процесс мог завершиться раньше, чем дочитал вход
    child.stdin.end(data);
  });
}

/**
 * Текст PDF. Разбор идёт в отдельном процессе (свой лимит памяти, жёсткий таймаут); файл нигде не сохраняется.
 * OCR не выполняется: скан без текстового слоя обрабатывает вызывающий код (RESUME_NO_TEXT).
 */
export async function extractPdfText(data: Buffer): Promise<{ text: string; pages: number; truncated: boolean }> {
  if (data.length < 8 || data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw unprocessable('RESUME_NOT_PDF', 'Файл не похож на PDF. Загрузите резюме в формате PDF.');
  }
  let result: WorkerResult;
  try {
    result = await runWorker(data);
  } catch (error) {
    if ((error as { code?: string }).code === 'TIMEOUT') {
      throw unprocessable('RESUME_UNREADABLE', 'Не удалось прочитать PDF за отведённое время. Попробуйте файл меньшего объёма.');
    }
    throw unprocessable('RESUME_UNREADABLE', 'Не удалось прочитать PDF: файл повреждён или имеет неподдерживаемую структуру.');
  }
  if ('error' in result) {
    if (result.error === 'PASSWORD') throw unprocessable('RESUME_ENCRYPTED', 'PDF защищён паролем. Снимите защиту и загрузите файл снова.');
    throw unprocessable('RESUME_UNREADABLE', 'Не удалось прочитать PDF: файл повреждён или имеет неподдерживаемую структуру.');
  }
  return result;
}
