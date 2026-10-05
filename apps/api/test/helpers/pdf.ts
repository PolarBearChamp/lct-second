import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface PdfContent {
  pages: number;
  text: string;
  info: Record<string, unknown>;
}

/** Извлекает текст и метаданные PDF отдельным процессом (pdfjs-dist — ESM-пакет). */
export function readPdf(buffer: Buffer): PdfContent {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsp-pdf-'));
  try {
    const file = path.join(dir, 'file.pdf');
    writeFileSync(file, buffer);
    const script = path.resolve(__dirname, '../../scripts/pdf-text.mjs');
    const out = execFileSync(process.execPath, [script, file], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(out) as PdfContent;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** pdfjs разделяет слова пробелами по-разному — сравниваем с нормализацией пробелов. */
export const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
