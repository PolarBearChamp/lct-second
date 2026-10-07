import path from 'node:path';
import PDFDocument from 'pdfkit';

const FONT = path.resolve(__dirname, '../../assets/fonts/JetBrainsMono-Regular.ttf');

/** PDF с текстовым слоем: каждая строка — отдельная строка страницы (как в обычном резюме). */
export function makeResumePdf(lines: string[], options: { pages?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Regular', FONT);
    doc.font('Regular').fontSize(10);
    const perPage = options.pages && options.pages > 1 ? Math.ceil(lines.length / options.pages) : lines.length;
    lines.forEach((line, index) => {
      if (index > 0 && index % perPage === 0) doc.addPage();
      doc.text(line || ' ', { lineGap: 2 });
    });
    doc.end();
  });
}

/** PDF без текста (только графика) — имитация скана. */
export function makeImageOnlyPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.rect(50, 50, 300, 400).fill('#cccccc');
    doc.end();
  });
}
