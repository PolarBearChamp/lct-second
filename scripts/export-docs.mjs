#!/usr/bin/env node
/**
 * Экспорт единого документа для сдачи (docs/submission.md) в PDF и DOCX.
 *
 *   pnpm docs:export                       — PDF и DOCX в docs/export/
 *   node scripts/export-docs.mjs --input docs/submission.md --name FSP-Talent-MVP
 *
 * PDF: Markdown → HTML (marked) → печать в Chromium (Playwright). Кириллица и таблицы отрисовываются браузерным
 * движком; фирменный моноширинный шрифт (JetBrains Mono, OFL) встроен из репозитория, без внешних запросов.
 * DOCX: Markdown → структура документа (docx): заголовки, списки, таблицы, код, цитаты, ссылки.
 *
 * После экспорта выполняется самопроверка: PDF содержит ожидаемое число страниц и кириллический текст (pdfjs),
 * DOCX — таблицы и заголовки в том же количестве, что и в исходном Markdown. При расхождении скрипт завершается с ошибкой.
 *
 * Требования: `pnpm install` и браузер Chromium для Playwright (`pnpm --filter @fsp/e2e install-browsers`).
 * Если Chromium недоступен, PDF не создаётся, скрипт сообщает причину и завершается с ненулевым кодом (DOCX создаётся).
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { input: 'docs/submission.md', name: 'FSP-Talent-MVP-submission', outDir: 'docs/export' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') args.input = argv[(i += 1)];
    else if (argv[i] === '--name') args.name = argv[(i += 1)];
    else if (argv[i] === '--out') args.outDir = argv[(i += 1)];
  }
  return args;
}

const unescapeHtml = (value) =>
  value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ───────────────────────────── PDF ─────────────────────────────

const BRAND = { 500: '#402fff', 700: '#2a1bb8', 800: '#21168e', ink: '#1b1c21', soft: '#3a3c45', line: '#d6d7e0', surface: '#f6f6fb' };

async function fontFace(file, weight) {
  const buffer = await readFile(path.join(ROOT, 'apps', 'web', 'src', 'app', 'fonts', file));
  return `@font-face{font-family:"JetBrains Mono";font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${buffer.toString('base64')}) format("woff2");}`;
}

async function buildHtml(markdown, title) {
  const body = marked.parse(markdown, { gfm: true });
  const fonts = (await Promise.all([fontFace('JetBrainsMono-Regular.woff2', 400), fontFace('JetBrainsMono-Bold.woff2', 700)])).join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${fonts}
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
html { font-size: 10.5pt; }
body { margin: 0; color: ${BRAND.ink}; font-family: "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif; line-height: 1.45; }
h1, h2, h3, h4 { font-family: "JetBrains Mono", "Consolas", monospace; color: ${BRAND[800]}; line-height: 1.25; break-after: avoid; }
h1 { font-size: 21pt; margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 2px solid ${BRAND[500]}; }
h2 { font-size: 15pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid ${BRAND.line}; break-before: auto; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; }
h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; color: ${BRAND[700]}; }
p { margin: 0 0 2.6mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0 0 1mm; }
li > p { margin: 0 0 1mm; }
a { color: ${BRAND[500]}; text-decoration: none; }
code { font-family: "JetBrains Mono", "Consolas", monospace; font-size: 0.88em; background: ${BRAND.surface}; border: 1px solid ${BRAND.line}; border-radius: 3px; padding: 0 1.5mm; overflow-wrap: anywhere; }
pre { margin: 0 0 3.5mm; padding: 3mm 3.5mm; background: ${BRAND.surface}; border: 1px solid ${BRAND.line}; border-left: 3px solid ${BRAND[500]}; border-radius: 3px; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid-page; }
pre code { background: none; border: 0; padding: 0; font-size: 8.8pt; }
blockquote { margin: 0 0 3.5mm; padding: 2mm 4mm; border-left: 3px solid ${BRAND[500]}; background: ${BRAND.surface}; color: ${BRAND.soft}; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 1px solid ${BRAND.line}; margin: 5mm 0; }
table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 8.8pt; table-layout: auto; }
th, td { border: 1px solid ${BRAND.line}; padding: 1.4mm 2mm; text-align: left; vertical-align: top; overflow-wrap: break-word; }
td code, th code { overflow-wrap: break-word; }
th[align="right"], td[align="right"] { text-align: right; }
th[align="center"], td[align="center"] { text-align: center; }
th { background: #ebe9ff; color: ${BRAND[800]}; font-weight: 700; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #fafaff; }
img { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function exportPdf(markdown, title, outFile) {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch (error) {
    throw new Error(`Не удалось загрузить Playwright (${error.message}). Выполните pnpm install.`);
  }
  const html = await buildHtml(markdown, title);
  const htmlFile = outFile.replace(/\.pdf$/, '.html');
  await writeFile(htmlFile, html, 'utf8');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(`Не удалось запустить Chromium (${error.message.split('\n')[0]}). Установите браузер: pnpm --filter @fsp/e2e install-browsers`);
  }
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: outFile,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#6b6c78;padding:0 16mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>ФСП Таланты — MVP платформы обратного подбора</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
  }
}

function verifyPdf(file, markdown, expectedHeadings) {
  const script = path.join(ROOT, 'apps', 'api', 'scripts', 'pdf-text.mjs');
  const output = execFileSync(process.execPath, [script, file], { cwd: path.join(ROOT, 'apps', 'api'), maxBuffer: 256 * 1024 * 1024 });
  const { pages, text } = JSON.parse(output.toString('utf8'));
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const flat = text.replace(/\s+/g, '');
  const missing = expectedHeadings.filter((heading) => !flat.includes(heading.replace(/\s+/g, '')));
  const problems = [];
  const sourceCyrillic = (markdown.match(/[А-Яа-яЁё]/g) ?? []).length;
  if (pages < 1) problems.push('PDF не содержит страниц');
  if (cyrillic < sourceCyrillic * 0.85) problems.push(`в PDF ${cyrillic} кириллических символов при ${sourceCyrillic} в источнике`);
  if (/�/.test(text)) problems.push('в тексте PDF есть символы замены U+FFFD (проблема со шрифтом)');
  if (missing.length) problems.push(`в PDF не найдены заголовки: ${missing.slice(0, 5).join('; ')}`);
  return { pages, cyrillic, latin, problems };
}

// ───────────────────────────── DOCX ─────────────────────────────

const FONT = 'Arial';
const MONO = 'Consolas';
const PAGE_WIDTH_DXA = 11906 - 2 * 1000; // A4 минус поля 1000 twips

function inlineRuns(tokens, style = {}) {
  const runs = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text':
        if (token.tokens?.length) runs.push(...inlineRuns(token.tokens, style));
        else runs.push(new TextRun({ text: unescapeHtml(token.text), font: FONT, ...style }));
        break;
      case 'escape':
        runs.push(new TextRun({ text: unescapeHtml(token.text), font: FONT, ...style }));
        break;
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...style, bold: true }));
        break;
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...style, italics: true }));
        break;
      case 'del':
        runs.push(...inlineRuns(token.tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        runs.push(new TextRun({ text: unescapeHtml(token.text), font: MONO, size: 19, shading: { type: ShadingType.CLEAR, fill: 'F2F1FB', color: 'auto' }, ...style }));
        break;
      case 'br':
        runs.push(new TextRun({ break: 1 }));
        break;
      case 'link': {
        const children = inlineRuns(token.tokens, { ...style, color: '402FFF', underline: {} });
        if (/^https?:/i.test(token.href)) runs.push(new ExternalHyperlink({ link: token.href, children }));
        else runs.push(...children);
        break;
      }
      case 'image':
        runs.push(new TextRun({ text: unescapeHtml(token.text || token.href), font: FONT, italics: true, ...style }));
        break;
      case 'html':
        break;
      default:
        if (token.raw) runs.push(new TextRun({ text: unescapeHtml(token.raw), font: FONT, ...style }));
    }
  }
  return runs;
}

const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const HEADING_SIZES = [38, 30, 25, 22, 21, 21];

function cellBorders() {
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'D6D7E0' };
  return { top: line, bottom: line, left: line, right: line };
}

class DocxBuilder {
  constructor() {
    this.orderedInstances = 0;
    this.stats = { headings: 0, tables: 0, tableRows: 0 };
  }

  blocks(tokens, context = {}) {
    const out = [];
    for (const token of tokens) out.push(...this.block(token, context));
    return out;
  }

  block(token, context) {
    switch (token.type) {
      case 'heading': {
        this.stats.headings += 1;
        const level = Math.min(token.depth, 6);
        return [
          new Paragraph({
            heading: HEADING_LEVELS[level - 1],
            spacing: { before: level === 1 ? 0 : level === 2 ? 360 : 240, after: 120 },
            keepNext: true,
            border: level <= 2 ? { bottom: { style: BorderStyle.SINGLE, size: level === 1 ? 12 : 4, color: level === 1 ? '402FFF' : 'D6D7E0', space: 2 } } : undefined,
            children: inlineRuns(token.tokens, { bold: true, color: '21168E', size: HEADING_SIZES[level - 1] }),
          }),
        ];
      }
      case 'paragraph':
        return [new Paragraph({ spacing: { after: 120 }, children: inlineRuns(token.tokens), ...context.paragraph })];
      case 'text': // «голый» текст внутри элемента списка
        return [new Paragraph({ spacing: { after: 60 }, children: inlineRuns(token.tokens ?? [token]), ...context.paragraph })];
      case 'list':
        return this.list(token, context.listLevel ?? 0);
      case 'table':
        return [this.table(token), new Paragraph({ spacing: { after: 120 }, children: [] })];
      case 'code': {
        const lines = token.text.split('\n');
        return [
          new Paragraph({
            spacing: { after: 160 },
            shading: { type: ShadingType.CLEAR, fill: 'F6F6FB', color: 'auto' },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: '402FFF', space: 6 } },
            indent: { left: 160 },
            children: lines.map((line, index) => new TextRun({ text: line, font: MONO, size: 18, break: index === 0 ? 0 : 1 })),
          }),
        ];
      }
      case 'blockquote':
        return this.blocks(token.tokens, {
          paragraph: {
            indent: { left: 300 },
            shading: { type: ShadingType.CLEAR, fill: 'F6F6FB', color: 'auto' },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: '402FFF', space: 8 } },
          },
        });
      case 'hr':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D6D7E0', space: 1 } }, spacing: { after: 120 }, children: [] })];
      case 'space':
      case 'html':
        return [];
      default:
        return token.raw?.trim() ? [new Paragraph({ children: [new TextRun({ text: token.raw.trim(), font: FONT })] })] : [];
    }
  }

  list(token, level) {
    const out = [];
    const instance = token.ordered ? (this.orderedInstances += 1) : 0;
    for (const item of token.items) {
      const numbering = token.ordered ? { reference: 'ordered', level: Math.min(level, 3), instance } : { reference: 'bullets', level: Math.min(level, 3) };
      let first = true;
      for (const child of item.tokens) {
        if (child.type === 'list') out.push(...this.list(child, level + 1));
        else if (child.type === 'text' || child.type === 'paragraph') {
          const prefix = item.task ? [new TextRun({ text: item.checked ? '☑ ' : '☐ ', font: FONT })] : [];
          out.push(new Paragraph({ numbering: first ? numbering : undefined, indent: first ? undefined : { left: 720 + level * 360 }, spacing: { after: 60 }, children: [...prefix, ...inlineRuns(child.tokens ?? [child])] }));
          first = false;
        } else out.push(...this.block(child, { listLevel: level }));
      }
    }
    return out;
  }

  table(token) {
    this.stats.tables += 1;
    const columns = token.header.length;
    const widths = this.columnWidths(token, columns);
    const makeRow = (cells, header) =>
      new TableRow({
        tableHeader: header,
        cantSplit: true,
        children: cells.map(
          (cell, index) =>
            new TableCell({
              width: { size: widths[index], type: WidthType.DXA },
              borders: cellBorders(),
              margins: { top: 50, bottom: 50, left: 80, right: 80 },
              shading: header ? { type: ShadingType.CLEAR, fill: 'EBE9FF', color: 'auto' } : undefined,
              children: [
                new Paragraph({
                  alignment: token.align?.[index] === 'right' ? AlignmentType.RIGHT : token.align?.[index] === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
                  children: inlineRuns(cell.tokens, { size: 17, ...(header ? { bold: true, color: '21168E' } : {}) }),
                }),
              ],
            }),
        ),
      });
    this.stats.tableRows += 1 + token.rows.length;
    return new Table({
      width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      rows: [makeRow(token.header, true), ...token.rows.map((row) => makeRow(row, false))],
    });
  }

  /** Ширина столбцов пропорциональна «весу» содержимого (длина текста с ограничением), минимум 8 % ширины. */
  columnWidths(token, columns) {
    const weights = new Array(columns).fill(0);
    const rows = [token.header, ...token.rows];
    for (const row of rows) {
      row.forEach((cell, index) => {
        weights[index] = Math.max(weights[index], Math.min(unescapeHtml(cell.text ?? '').length, 60));
      });
    }
    const safe = weights.map((w) => Math.max(w, 6));
    const total = safe.reduce((sum, w) => sum + w, 0);
    const min = Math.floor(PAGE_WIDTH_DXA * 0.07);
    const raw = safe.map((w) => Math.max(min, Math.floor((w / total) * PAGE_WIDTH_DXA)));
    const scale = PAGE_WIDTH_DXA / raw.reduce((sum, w) => sum + w, 0);
    const widths = raw.map((w) => Math.floor(w * scale));
    widths[widths.length - 1] += PAGE_WIDTH_DXA - widths.reduce((sum, w) => sum + w, 0);
    return widths;
  }
}

async function exportDocx(markdown, title, outFile) {
  const builder = new DocxBuilder();
  const tokens = marked.lexer(markdown, { gfm: true });
  const children = builder.blocks(tokens);
  const bulletLevels = [0, 1, 2, 3].map((level) => ({
    level,
    format: LevelFormat.BULLET,
    text: level % 2 === 0 ? '•' : '–',
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 260 } } },
  }));
  const orderedLevels = [0, 1, 2, 3].map((level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
  }));
  const document = new Document({
    creator: 'ФСП Таланты (MVP)',
    title,
    description: 'Единый документ для сдачи MVP (экспорт из docs/submission.md)',
    styles: {
      default: { document: { run: { font: FONT, size: 21 } } },
      paragraphStyles: HEADING_LEVELS.map((id, index) => ({
        id: id === HeadingLevel.HEADING_1 ? 'Heading1' : `Heading${index + 1}`,
        name: `heading ${index + 1}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT, bold: true, color: '21168E', size: HEADING_SIZES[index] },
      })),
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: bulletLevels },
        { reference: 'ordered', levels: orderedLevels },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 }, size: { width: 11906, height: 16838 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'ФСП Таланты — MVP платформы обратного подбора · стр. ', size: 16, color: '6B6C78', font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '6B6C78', font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  await writeFile(outFile, await Packer.toBuffer(document));
  return builder.stats;
}

async function verifyDocx(file, expected) {
  // DOCX — zip: проверяем сигнатуру и считаем таблицы/абзацы-заголовки в document.xml.
  const { default: JSZip } = await import('jszip').catch(() => ({ default: null }));
  if (!JSZip) return { skipped: true, problems: [] };
  const zip = await JSZip.loadAsync(await readFile(file));
  const xml = await zip.file('word/document.xml').async('string');
  const tables = (xml.match(/<w:tbl>/g) ?? []).length;
  const headings = (xml.match(/<w:pStyle w:val="Heading\d"\/>/g) ?? []).length;
  const problems = [];
  if (tables !== expected.tables) problems.push(`таблиц в DOCX ${tables}, в Markdown ${expected.tables}`);
  if (headings !== expected.headings) problems.push(`заголовков в DOCX ${headings}, в Markdown ${expected.headings}`);
  if (!/[А-Яа-яЁё]/.test(xml)) problems.push('в DOCX нет кириллического текста');
  return { skipped: false, tables, headings, problems };
}

// ───────────────────────────── запуск ─────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(ROOT, args.input);
  const outDir = path.resolve(ROOT, args.outDir);
  await mkdir(outDir, { recursive: true });
  const markdown = await readFile(input, 'utf8');
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? 'Документ для сдачи MVP').trim();
  const headingTexts = [...markdown.matchAll(/^#{1,2}\s+(.+)$/gm)].map((match) => match[1].replace(/[`*_]/g, '').trim()).slice(0, 12);
  console.log(`[docs:export] источник: ${path.relative(ROOT, input)} (${markdown.length} символов), заголовок: «${title}»`);

  let failures = 0;
  const docxFile = path.join(outDir, `${args.name}.docx`);
  const stats = await exportDocx(markdown, title, docxFile);
  const docxCheck = await verifyDocx(docxFile, stats);
  console.log(
    `[docs:export] DOCX: ${path.relative(ROOT, docxFile)} — заголовков ${stats.headings}, таблиц ${stats.tables} (строк ${stats.tableRows})` +
      (docxCheck.skipped ? '; структурная проверка пропущена (jszip недоступен)' : docxCheck.problems.length ? `; ПРОБЛЕМЫ: ${docxCheck.problems.join('; ')}` : '; структурная проверка пройдена'),
  );
  if (docxCheck.problems.length) failures += 1;

  const pdfFile = path.join(outDir, `${args.name}.pdf`);
  try {
    await exportPdf(markdown, title, pdfFile);
    const check = verifyPdf(pdfFile, markdown, headingTexts);
    console.log(`[docs:export] PDF: ${path.relative(ROOT, pdfFile)} — страниц ${check.pages}, кириллических символов ${check.cyrillic}, латинских ${check.latin}` + (check.problems.length ? `; ПРОБЛЕМЫ: ${check.problems.join('; ')}` : '; проверка текста пройдена'));
    if (check.problems.length) failures += 1;
  } catch (error) {
    failures += 1;
    console.error(`[docs:export] PDF не создан: ${error.message}`);
  }

  if (failures) {
    console.error(`[docs:export] завершено с ошибками: ${failures}`);
    process.exit(1);
  }
  console.log('[docs:export] готово');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
