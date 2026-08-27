/**
 * One document a parent can actually use: how the child is doing, whether they turn up,
 * what has been billed and what has been paid, and who the school would ring.
 *
 * The school's own report card, receipts and statements each answer one of those, which
 * means a parent asking "how is my child getting on?" receives three PDFs and no picture.
 * This is the picture. Every section is optional because the answer differs by who is
 * asking: a class teacher sending home end-of-term marks has no business attaching the
 * family's payment history.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'eSchool';
const SCHOOL_TAGLINE = process.env.SCHOOL_TAGLINE || '';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const BOTTOM = 64;

const INK = rgb(0.12, 0.13, 0.18);
const MUTED = rgb(0.45, 0.47, 0.53);
const RULE = rgb(0.82, 0.84, 0.88);
const BRAND = rgb(0.31, 0.27, 0.9);
const ZEBRA = rgb(0.97, 0.97, 0.99);
const GOOD = rgb(0.16, 0.55, 0.38);
const BAD = rgb(0.72, 0.24, 0.24);

/** Everything this report can carry, in the order it is laid out. */
export const REPORT_SECTIONS = ['performance', 'attendance', 'fees', 'payments', 'info'];

export const SECTION_LABELS = {
  performance: 'Academic performance',
  attendance: 'Attendance',
  fees: 'Fees',
  payments: 'Payment history',
  info: 'Student details',
};

// '#RGB' / '#RRGGBB' → rgb, falling back to the default brand so a bad theme value never fails.
const parseHexColor = (value, fallback = BRAND) => {
  const hex = String(value || '').trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return rgb(parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255);
};

// Embeds a base64 data URL (PNG or JPEG). Returns null for anything missing or undecodable, so a
// broken logo costs the report its crest rather than the whole document.
const embedImageFromDataUrl = async (pdfDoc, dataUrl) => {
  const match = /^data:(image\/(?:png|jpe?g));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || '').trim());
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    return match[1] === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch {
    return null;
  }
};

const truncate = (text, maxCharacters) => {
  const value = String(text ?? '');
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters - 1)}…` : value;
};

const money = (amount, currency) =>
  `${currency} ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;

const isoDate = (value) => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
};

/* A cursor that knows when it has run off the page. Every section draws through it, so a
   long payment history spills onto a second sheet instead of off the bottom of the first. */
const makeCanvas = (pdf, fonts, brand) => {
  const state = { page: null, y: 0 };

  const newPage = () => {
    state.page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    state.page.drawRectangle({ x: 0, y: A4_HEIGHT - 6, width: A4_WIDTH, height: 6, color: brand });
    state.y = A4_HEIGHT - MARGIN - 12;
    return state.page;
  };

  newPage();

  return {
    get page() {
      return state.page;
    },
    get y() {
      return state.y;
    },
    move(by) {
      state.y -= by;
    },
    /** Starts a new page when `needed` points would not fit above the footer. */
    ensure(needed) {
      if (state.y - needed < BOTTOM) newPage();
      return state.page;
    },
    text(value, { x = MARGIN, size = 10, font = fonts.regular, color = INK, dy = 0 } = {}) {
      state.page.drawText(String(value ?? ''), { x, y: state.y + dy, size, font, color });
    },
    rightText(value, { x = A4_WIDTH - MARGIN, size = 10, font = fonts.regular, color = INK, dy = 0 } = {}) {
      const width = font.widthOfTextAtSize(String(value ?? ''), size);
      state.page.drawText(String(value ?? ''), { x: x - width, y: state.y + dy, size, font, color });
    },
    rule({ dy = 0, color = RULE } = {}) {
      state.page.drawLine({
        start: { x: MARGIN, y: state.y + dy },
        end: { x: A4_WIDTH - MARGIN, y: state.y + dy },
        thickness: 1,
        color,
      });
    },
    band({ height, dy = 0, color = ZEBRA }) {
      state.page.drawRectangle({
        x: MARGIN,
        y: state.y + dy,
        width: A4_WIDTH - MARGIN * 2,
        height,
        color,
      });
    },
    pages() {
      return pdf.getPages();
    },
  };
};

const sectionHeading = (canvas, fonts, label, brand) => {
  canvas.ensure(46);
  canvas.move(18);
  canvas.text(label.toUpperCase(), { size: 9, font: fonts.bold, color: brand });
  canvas.move(8);
  canvas.rule();
  canvas.move(16);
};

/* Label above value, two to a row — the same field block the receipt and statement use, so
   the family sees one house style across everything the school sends. */
const drawFields = (canvas, fonts, fields) => {
  const columnWidth = (A4_WIDTH - MARGIN * 2) / 2;
  for (let index = 0; index < fields.length; index += 2) {
    canvas.ensure(34);
    const row = fields.slice(index, index + 2);
    row.forEach(([label, value], column) => {
      const x = MARGIN + column * columnWidth;
      canvas.text(String(label).toUpperCase(), { x, size: 7.5, color: MUTED });
      canvas.text(truncate(value, 40), { x, size: 10.5, font: fonts.bold, dy: -13 });
    });
    canvas.move(32);
  }
};

const drawTable = (canvas, fonts, { columns, rows, emptyNote }) => {
  if (!rows.length) {
    canvas.ensure(20);
    canvas.text(emptyNote, { size: 9.5, color: MUTED });
    canvas.move(18);
    return;
  }

  const drawHeadRow = () => {
    canvas.ensure(24);
    columns.forEach((column) => {
      const x = MARGIN + column.x;
      if (column.align === 'right') canvas.rightText(column.label.toUpperCase(), { x: MARGIN + column.x, size: 7.5, color: MUTED });
      else canvas.text(column.label.toUpperCase(), { x, size: 7.5, color: MUTED });
    });
    canvas.move(6);
    canvas.rule();
    canvas.move(14);
  };

  drawHeadRow();

  rows.forEach((row, index) => {
    const before = canvas.y;
    canvas.ensure(18);
    // A page break mid-table needs its own heading, or the second sheet is a wall of numbers.
    if (canvas.y > before) drawHeadRow();

    if (index % 2 === 1) canvas.band({ height: 16, dy: -4 });
    columns.forEach((column) => {
      const value = row[column.key];
      const colour = column.colour ? column.colour(row) : INK;
      if (column.align === 'right') {
        canvas.rightText(value, { x: MARGIN + column.x, size: 9.5, font: column.strong ? fonts.bold : fonts.regular, color: colour });
      } else {
        canvas.text(truncate(value, column.max || 30), {
          x: MARGIN + column.x,
          size: 9.5,
          font: column.strong ? fonts.bold : fonts.regular,
          color: colour,
        });
      }
    });
    canvas.move(17);
  });
  canvas.move(4);
};

/**
 * The whole report. `sections` decides what is included and in what order — anything not
 * listed is simply absent, and a section with no data says so rather than being omitted
 * silently, because a blank space and "no payments recorded" mean different things to a
 * parent.
 */
export const buildParentReportPdf = async ({
  school,
  tagline,
  themeColor,
  schoolLogo,
  schoolAddress,
  contactPhone,
  contactEmail,
  student,
  sections = REPORT_SECTIONS,
  performance = null,
  attendance = null,
  fees = null,
  payments = null,
  info = null,
  generatedBy = '',
  generatedAt = new Date(),
}) => {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const brand = parseHexColor(themeColor);
  const wanted = REPORT_SECTIONS.filter((name) => sections.includes(name));

  const canvas = makeCanvas(pdf, fonts, brand);
  const logo = await embedImageFromDataUrl(pdf, schoolLogo);

  /* ── masthead ─────────────────────────────────────────────────── */
  const headerTextX = logo ? MARGIN + 52 : MARGIN;
  if (logo) {
    const size = 42;
    canvas.page.drawImage(logo, { x: MARGIN, y: canvas.y - size + 12, width: size, height: size });
  }
  canvas.text(truncate(school || SCHOOL_NAME, 42), { x: headerTextX, size: 17, font: fonts.bold });
  const resolvedTagline = tagline || SCHOOL_TAGLINE;
  if (resolvedTagline) canvas.text(truncate(resolvedTagline, 64), { x: headerTextX, size: 9, color: MUTED, dy: -15 });
  canvas.rightText('STUDENT REPORT', { size: 15, font: fonts.bold, color: brand });
  canvas.rightText(isoDate(generatedAt), { size: 9, color: MUTED, dy: -15 });

  canvas.move(34);
  canvas.rule();
  canvas.move(22);

  /* ── who this is about, always ────────────────────────────────── */
  drawFields(canvas, fonts, [
    ['Student', student.full_name],
    ['Student number', student.student_number || student.student_id],
    ['Class', `Grade ${student.grade_level ?? '—'} ${student.class_section || ''}`.trim()],
    ['Status', student.status || '—'],
  ]);

  /* ── performance ──────────────────────────────────────────────── */
  if (wanted.includes('performance')) {
    sectionHeading(canvas, fonts, SECTION_LABELS.performance, brand);
    const subjects = (performance && performance.subjects) || [];
    drawTable(canvas, fonts, {
      columns: [
        { key: 'subject', label: 'Subject', x: 0, max: 34 },
        { key: 'score', label: 'Score', x: 300, align: 'right' },
        { key: 'max', label: 'Out of', x: 370, align: 'right' },
        { key: 'grade', label: 'Grade', x: 430, align: 'right', strong: true },
        { key: 'remarks', label: 'Remark', x: 499, align: 'right', max: 16 },
      ],
      rows: subjects.map((row) => ({
        subject: row.subject || 'Subject',
        score: String(Math.round(Number(row.score) || 0)),
        max: String(Math.round(Number(row.max_score) || 100)),
        grade: row.grade || '—',
        remarks: row.remarks || '',
      })),
      emptyNote: 'No marks have been entered for this student yet.',
    });

    if (subjects.length) {
      canvas.ensure(26);
      canvas.text('Average', { size: 9.5, color: MUTED });
      canvas.rightText(`${performance.average.toFixed(1)}%`, { size: 12, font: fonts.bold, color: brand });
      canvas.move(20);
    }
  }

  /* ── attendance ───────────────────────────────────────────────── */
  if (wanted.includes('attendance')) {
    sectionHeading(canvas, fonts, SECTION_LABELS.attendance, brand);
    const counts = (attendance && attendance.counts) || {};
    const total = Number(attendance && attendance.total) || 0;

    if (!total) {
      canvas.ensure(20);
      canvas.text('No attendance has been recorded for this student yet.', { size: 9.5, color: MUTED });
      canvas.move(18);
    } else {
      const rate = Number(attendance.rate) || 0;
      canvas.ensure(30);
      canvas.text('Attendance rate', { size: 9.5, color: MUTED });
      canvas.rightText(`${rate.toFixed(0)}%`, { size: 14, font: fonts.bold, color: rate >= 80 ? GOOD : BAD });
      canvas.move(22);
      drawFields(canvas, fonts, [
        ['Days recorded', String(total)],
        ['Present', String(counts.present || 0)],
        ['Absent', String(counts.absent || 0)],
        ['Late', String(counts.late || 0)],
      ]);
    }
  }

  /* ── fees ─────────────────────────────────────────────────────── */
  if (wanted.includes('fees')) {
    sectionHeading(canvas, fonts, SECTION_LABELS.fees, brand);
    const currency = (fees && fees.currency) || 'UGX';
    const balance = Number(fees && fees.balance_due) || 0;

    canvas.ensure(30);
    canvas.text(balance > 0 ? 'Outstanding balance' : 'Balance', { size: 9.5, color: MUTED });
    canvas.rightText(money(balance, currency), { size: 14, font: fonts.bold, color: balance > 0 ? BAD : GOOD });
    canvas.move(22);

    drawFields(canvas, fonts, [
      ['Invoices', String((fees && fees.invoice_count) || 0)],
      ['Total billed', money((fees && fees.total_invoiced) || 0, currency)],
      ['Total paid', money((fees && fees.total_paid) || 0, currency)],
      ['Standing', balance > 0 ? 'Outstanding' : 'Cleared'],
    ]);
  }

  /* ── payment history ──────────────────────────────────────────── */
  if (wanted.includes('payments')) {
    sectionHeading(canvas, fonts, SECTION_LABELS.payments, brand);
    const currency = (payments && payments.currency) || 'UGX';
    const entries = (payments && payments.entries) || [];
    drawTable(canvas, fonts, {
      columns: [
        { key: 'date', label: 'Date', x: 0 },
        { key: 'method', label: 'Method', x: 80, max: 18 },
        { key: 'reference', label: 'Reference', x: 190, max: 18 },
        { key: 'receipt', label: 'Receipt', x: 300, max: 18 },
        { key: 'amount', label: 'Amount', x: 499, align: 'right', strong: true },
      ],
      rows: entries.map((row) => ({
        date: isoDate(row.paid_at),
        method: row.method || row.payment_method || '—',
        reference: row.reference || '—',
        receipt: row.receipt_number || '—',
        amount: money(row.amount, row.currency || currency),
      })),
      emptyNote: 'No payments have been recorded for this student yet.',
    });

    if (entries.length) {
      canvas.ensure(26);
      canvas.text('Total received', { size: 9.5, color: MUTED });
      canvas.rightText(money(payments.total_paid, currency), { size: 12, font: fonts.bold, color: brand });
      canvas.move(20);
    }
  }

  /* ── details and contacts ─────────────────────────────────────── */
  if (wanted.includes('info')) {
    sectionHeading(canvas, fonts, SECTION_LABELS.info, brand);
    drawFields(canvas, fonts, [
      ['Date of birth', isoDate(info && info.date_of_birth)],
      ['Gender', (info && info.gender) || '—'],
      ['Enrolled', isoDate(info && info.enrollment_date)],
      ['Blood group', (info && info.blood_group) || '—'],
      ['Parent / guardian', (info && info.parent_name) || '—'],
      ['Parent phone', (info && info.parent_phone) || '—'],
      ['Parent email', (info && info.parent_email) || '—'],
      ['Emergency contact', (info && info.emergency_contact_name) || '—'],
    ]);
  }

  /* ── footer on every sheet ────────────────────────────────────── */
  const footerParts = [school || SCHOOL_NAME, schoolAddress, contactPhone, contactEmail].filter(Boolean);
  const pages = canvas.pages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: BOTTOM - 12 },
      end: { x: A4_WIDTH - MARGIN, y: BOTTOM - 12 },
      thickness: 1,
      color: RULE,
    });
    page.drawText(truncate(footerParts.join(' · '), 84), {
      x: MARGIN,
      y: BOTTOM - 26,
      size: 7.5,
      font: fonts.regular,
      color: MUTED,
    });
    const stamp = `Page ${index + 1} of ${pages.length}${generatedBy ? ` · prepared by ${generatedBy}` : ''}`;
    const width = fonts.regular.widthOfTextAtSize(stamp, 7.5);
    page.drawText(stamp, { x: A4_WIDTH - MARGIN - width, y: BOTTOM - 26, size: 7.5, font: fonts.regular, color: MUTED });
  });

  return pdf.save();
};

export default { buildParentReportPdf, REPORT_SECTIONS, SECTION_LABELS };
