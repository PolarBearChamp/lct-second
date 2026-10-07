// Извлечение текста из PDF в отдельном процессе (изоляция разбора недоверенного файла: свой лимит памяти, жёсткий таймаут).
// Вход: PDF в stdin. Выход: одна строка JSON в stdout — { text, pages, truncated } или { error: 'PASSWORD' | 'INVALID' }.
// Параметры: PDF_MAX_PAGES, PDF_MAX_CHARS (переменные окружения).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 10);
const MAX_CHARS = Number(process.env.PDF_MAX_CHARS ?? 60000);

/** Группирует фрагменты страницы в строки по вертикальной позиции (допуск 2 пт), внутри строки — слева направо. */
function itemsToLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str || !Array.isArray(item.transform)) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
    if (row) row.parts.push({ x, text: item.str });
    else rows.push({ y, parts: [{ x, text: item.str }] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const data = new Uint8Array(Buffer.concat(chunks));

try {
  const loading = getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const pdf = await loading.promise;
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  const lines = [];
  for (let index = 1; index <= pages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    lines.push(...itemsToLines(content.items), '');
  }
  let text = lines.join('\n');
  let truncated = pdf.numPages > MAX_PAGES;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  process.stdout.write(JSON.stringify({ text, pages, truncated }));
  await loading.destroy();
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error?.name === 'PasswordException' ? 'PASSWORD' : 'INVALID' }));
}
process.exit(0);
