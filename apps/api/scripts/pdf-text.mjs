// Извлечение текста и метаданных PDF (pdfjs-dist) — используется тестами приватности.
// Запуск: node scripts/pdf-text.mjs <file.pdf>  → JSON { pages, text, info }
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/pdf-text.mjs <file.pdf>');
  process.exit(2);
}
const data = new Uint8Array(readFileSync(file));
const pdf = await getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
const texts = [];
for (let i = 1; i <= pdf.numPages; i += 1) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
}
const meta = await pdf.getMetadata();
process.stdout.write(JSON.stringify({ pages: pdf.numPages, text: texts.join('\n'), info: meta.info }));
