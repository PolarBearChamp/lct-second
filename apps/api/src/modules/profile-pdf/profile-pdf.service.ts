import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { Clock } from '../../common/clock';
import type { CandidateProfileView } from '../../domain/privacy/profile-view';
import { disciplineTitle, eventLevelTitle } from '../../domain/matching/fsp-relevance';

const BRAND = '#402FFF';
const INK = '#1B1C21';
const MUTED = '#5B5E6B';
const LINE = '#E2E2EA';
const SUCCESS = '#067647';

const WORK_FORMATS: Record<string, string> = { REMOTE: 'удалённо', HYBRID: 'гибрид', OFFICE: 'офис' };
const CHANNELS: Record<string, string> = { EMAIL: 'Email', PHONE: 'Телефон', MESSENGER: 'Мессенджер' };
const OUTCOMES: Record<string, string> = { WIN: 'Победа', PRIZE: 'Призёр', PARTICIPATION: 'Участие' };
const STATUS: Record<string, string> = { CONFIRMED: 'подтверждён', BELOW_THRESHOLD: 'ниже порога', INSUFFICIENT_DATA: 'недостаточно данных' };

function fontPath(file: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'assets/fonts', file),
    path.resolve(process.cwd(), 'apps/api/assets/fonts', file),
    path.resolve(__dirname, '../../../../assets/fonts', file),
    path.resolve(__dirname, '../../../assets/fonts', file),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Шрифт ${file} не найден (ожидается apps/api/assets/fonts)`);
  return found;
}

const money = (n: number) => n.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ');
const months = (m: number | null) => {
  if (m === null) return '—';
  const y = Math.floor(m / 12);
  const r = m % 12;
  return [y ? `${y} г.` : '', r ? `${r} мес.` : ''].filter(Boolean).join(' ') || 'меньше месяца';
};

/**
 * PDF-профиль строится из того же представления (CandidateProfileView), что и JSON API, поэтому правила
 * приватности не расходятся. В обезличенном режиме ни текст, ни метаданные, ни имя файла не содержат ФИО и контактов.
 */
@Injectable()
export class ProfilePdfService {
  constructor(private readonly clock: Clock) {}

  fileName(view: CandidateProfileView): string {
    return `candidate-${view.alias.toLowerCase()}${view.mode === 'EMPLOYER_REDACTED' ? '-redacted' : ''}.pdf`;
  }

  render(view: CandidateProfileView): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 56, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: `Профиль кандидата ${view.alias}`,
        Author: 'ФСП Таланты',
        Subject: view.mode === 'EMPLOYER_REDACTED' ? 'Обезличенная карточка кандидата' : 'Профиль кандидата',
        Creator: 'ФСП Таланты (MVP)',
        Producer: 'ФСП Таланты',
        Keywords: view.specialization?.title ?? '',
      },
    });
    doc.registerFont('Regular', fontPath('JetBrainsMono-Regular.ttf'));
    doc.registerFont('Medium', fontPath('JetBrainsMono-Medium.ttf'));
    doc.registerFont('Bold', fontPath('JetBrainsMono-Bold.ttf'));
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const ensureSpace = (needed: number) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };
    const heading = (text: string, color = BRAND) => {
      ensureSpace(48);
      doc.moveDown(0.8);
      doc.font('Bold').fontSize(12).fillColor(color).text(text, left, doc.y, { width });
      const y = doc.y + 3;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.7).strokeColor(LINE).stroke();
      doc.y = y + 7;
    };
    const row = (label: string, value: string) => {
      ensureSpace(20);
      const y = doc.y;
      doc.font('Regular').fontSize(9).fillColor(MUTED).text(label, left, y, { width: 150 });
      doc.font('Regular').fontSize(9.5).fillColor(INK).text(value || '—', left + 160, y, { width: width - 160 });
      doc.y = Math.max(doc.y, y) + 3;
    };
    const paragraph = (text: string, size = 9.5, color = INK) => {
      ensureSpace(18);
      doc.font('Regular').fontSize(size).fillColor(color).text(text, left, doc.y, { width, lineGap: 2 });
      doc.moveDown(0.3);
    };
    const bar = (label: string, score: number) => {
      ensureSpace(26);
      const y = doc.y;
      doc.font('Regular').fontSize(9).fillColor(INK).text(label, left, y, { width: width - 60 });
      doc.font('Bold').fontSize(9).fillColor(INK).text(String(score), left + width - 40, y, { width: 40, align: 'right' });
      const barY = Math.max(doc.y, y + 12) + 2;
      doc.roundedRect(left, barY, width, 5, 2.5).fill('#F1EFFF');
      doc.roundedRect(left, barY, Math.max(2, (width * Math.min(100, score)) / 100), 5, 2.5).fill(BRAND);
      doc.y = barY + 11;
    };

    // ── Шапка ──
    doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
    doc.font('Bold').fontSize(10).fillColor(BRAND).text('ФСП ТАЛАНТЫ', left, 26, { width: width / 2 });
    doc
      .font('Regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        view.mode === 'EMPLOYER_REDACTED' ? 'Обезличенная карточка кандидата' : view.mode === 'EMPLOYER_GRANTED' ? 'Профиль с доступом к контактам' : 'Профиль кандидата (владелец)',
        left + width / 2,
        28,
        { width: width / 2, align: 'right' },
      );
    doc.y = 56;
    doc.font('Bold').fontSize(20).fillColor(INK).text(view.displayName, left, doc.y, { width });
    doc.font('Medium').fontSize(11).fillColor(MUTED).text(view.specialization?.title ?? 'Специализация не выбрана', { width });
    doc.moveDown(0.4);
    if (view.qualification) {
      doc
        .font('Bold')
        .fontSize(11)
        .fillColor(SUCCESS)
        .text(`Грейд по результатам тестирования: ${view.qualification.gradeTitle} · общий балл ${view.qualification.overallScore}/100`, { width });
    } else {
      doc.font('Bold').fontSize(11).fillColor('#B54708').text('Грейд по результатам тестирования не подтверждён', { width });
    }

    // ── Подтверждено тестом ──
    heading('Подтверждено тестом', SUCCESS);
    if (view.qualification) {
      for (const g of view.qualification.groupScores) bar(g.title, g.score);
      const verified = view.qualification.skillEvidence.filter((s) => s.status === 'CONFIRMED');
      paragraph(`Навыки, подтверждённые заданиями: ${verified.map((s) => s.title).join(', ') || 'нет навыков с достаточным покрытием'}`);
      paragraph(`Подтверждено: ${view.qualification.confirmedAt.slice(0, 10)}`, 8.5, MUTED);
      const integrity = view.qualification.integrity;
      if (integrity) {
        // Та же сводка, что в карточке: нейтральные формулировки, информация (не доказательство), на грейд не влияет.
        const text = integrity.signals.length ? integrity.signals.map((signal) => signal.text).join('; ') : 'отметок нет';
        paragraph(`Сигналы при прохождении теста (информация, на баллы и грейд не влияют): ${text}`, 8.5, MUTED);
      }
    } else {
      paragraph('Подтверждённой квалификации по активной специализации нет.', 9.5, MUTED);
    }
    if (view.otherCategories.length) {
      paragraph(`Другие подтверждённые категории: ${view.otherCategories.map((c) => `${c.specializationTitle} · ${c.gradeTitle} (${c.overallScore}/100)`).join('; ')}`, 9.5);
    }

    // ── Указано кандидатом ──
    heading('Указано кандидатом (не проверено тестом)', MUTED);
    row('Заявленный грейд', view.declaredGrade?.title ?? '—');
    row('Опыт', months(view.experienceMonths));
    row('Роли', view.teamRoles.map((r) => r.title).join(', '));
    row('Soft skills', view.softSkills.map((r) => r.title).join(', '));
    row('Отрасли', view.industries.map((r) => r.title).join(', '));
    const selfSkills = view.skills.filter((s) => s.source === 'SELF_REPORTED');
    row('Стек', selfSkills.map((s) => `${s.title}${s.months ? ` (${months(s.months)})` : ''}`).join(', '));

    // ── Что не подтверждено ──
    const gaps = view.qualification?.skillEvidence.filter((s) => s.status !== 'CONFIRMED') ?? [];
    if (gaps.length) {
      heading('Что пока не подтверждено', '#B54708');
      for (const s of gaps) paragraph(`• ${s.title}: ${STATUS[s.status]} (кейсов: ${s.cases}, результат ${s.score})`);
    }

    // ── Условия ──
    heading('Условия');
    row('Город', view.city ?? '—');
    row('Формат работы', view.workFormats.map((f) => WORK_FORMATS[f] ?? f).join(', '));
    const s = view.salaryExpectation;
    row(
      'Зарплатные ожидания',
      s ? `${s.from ? `от ${money(s.from)} ` : ''}${s.to ? `до ${money(s.to)} ` : ''}₽ в месяц до вычета налогов` : 'не указаны',
    );

    // ── ФСП ──
    heading('Достижения ФСП');
    if (view.fsp.achievements.length) {
      if (view.fsp.demoNotice) paragraph(view.fsp.demoNotice, 8.5, '#B54708');
      for (const a of view.fsp.achievements) {
        const base = `• ${OUTCOMES[a.outcome]}${a.place ? ` (${a.place} место)` : ''} · ${disciplineTitle(a.discipline)} · ${eventLevelTitle(a.eventLevel)} · ${a.year ?? 'год не указан'}`;
        paragraph(a.eventTitle ? `${base}\n  ${a.eventTitle}` : base);
      }
    } else {
      paragraph(view.fsp.linked ? 'ФСП ID привязан, достижений нет.' : 'Достижения ФСП не привязаны.', 9.5, MUTED);
    }

    // ── Персональные данные (только владелец и компания с доступом) ──
    if (view.personal) {
      heading(view.mode === 'OWNER' ? 'Личные данные' : 'Данные, раскрытые кандидатом');
      row('ФИО', view.personal.fullName ?? '—');
      for (const c of view.contacts ?? []) row(CHANNELS[c.channel] ?? c.channel, c.value);
      row('Ссылки', view.personal.externalLinks.join('\n'));
      if (view.personal.experienceDescription) {
        ensureSpace(30);
        doc.moveDown(0.3);
        paragraph(view.personal.experienceDescription);
      }
    }

    // ── Колонтитул на каждой странице ──
    const generated = this.clock.now().toISOString().replace('T', ' ').slice(0, 16);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Колонтитул ниже нижнего поля: обнуляем поле, чтобы pdfkit не переносил текст на новую страницу.
      doc.page.margins.bottom = 0;
      const bottom = doc.page.height - 34;
      doc.font('Regular').fontSize(7).fillColor(MUTED);
      doc.text(
        `Сформировано ${generated} UTC платформой «ФСП Таланты». Демонстрационные данные. Стр. ${i + 1} из ${range.count}`,
        left,
        bottom,
        { width, align: 'center', lineBreak: false },
      );
    }
    doc.end();
    return done;
  }
}
