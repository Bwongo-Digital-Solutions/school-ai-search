import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'SchoolBot Academy';
const SCHOOL_TAGLINE = process.env.SCHOOL_TAGLINE || '';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;

const INK = rgb(0.12, 0.13, 0.18);
const MUTED = rgb(0.45, 0.47, 0.53);
const RULE = rgb(0.82, 0.84, 0.88);
const BRAND = rgb(0.31, 0.27, 0.9);
const ZEBRA = rgb(0.97, 0.97, 0.99);

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

const drawHeader = (page, fonts, { title, schoolName, subtitle }) => {
  const { regular, bold } = fonts;
  let y = A4_HEIGHT - MARGIN;

  page.drawRectangle({ x: 0, y: y - 6, width: A4_WIDTH, height: 6, color: BRAND });

  page.drawText(truncate(schoolName || SCHOOL_NAME, 46), {
    x: MARGIN,
    y: y - 34,
    size: 17,
    font: bold,
    color: INK,
  });
  if (SCHOOL_TAGLINE) {
    page.drawText(truncate(SCHOOL_TAGLINE, 70), { x: MARGIN, y: y - 50, size: 9, font: regular, color: MUTED });
  }

  const titleWidth = bold.widthOfTextAtSize(title, 15);
  page.drawText(title, { x: A4_WIDTH - MARGIN - titleWidth, y: y - 34, size: 15, font: bold, color: BRAND });
  if (subtitle) {
    const subtitleWidth = regular.widthOfTextAtSize(subtitle, 9);
    page.drawText(subtitle, {
      x: A4_WIDTH - MARGIN - subtitleWidth,
      y: y - 50,
      size: 9,
      font: regular,
      color: MUTED,
    });
  }

  y -= 66;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 1, color: RULE });
  return y - 26;
};

const drawFields = (page, fonts, y, fields) => {
  const { regular, bold } = fonts;
  const columnWidth = (A4_WIDTH - MARGIN * 2) / 2;

  fields.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN + column * columnWidth;
    const rowY = y - row * 32;

    page.drawText(label.toUpperCase(), { x, y: rowY, size: 7.5, font: regular, color: MUTED });
    page.drawText(truncate(value, 40), { x, y: rowY - 13, size: 10.5, font: bold, color: INK });
  });

  return y - Math.ceil(fields.length / 2) * 32 - 12;
};

/** A receipt for one payment, listing which invoices the money was applied to. */
export const buildFeeReceiptPdf = async ({ school, student, payment, receipt, allocations = [] }) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const currency = receipt.currency || payment.currency || 'UGX';

  let y = drawHeader(page, fonts, {
    title: 'FEES RECEIPT',
    schoolName: school,
    subtitle: receipt.receipt_number,
  });

  y = drawFields(page, fonts, y, [
    ['Received from', student.full_name],
    ['Student number', student.student_number],
    ['Class', `Grade ${student.grade_level} ${student.class_section}`],
    ['Date', isoDate(receipt.issued_at || payment.paid_at)],
    ['Payment method', payment.payment_method || '—'],
    ['Reference', payment.reference || '—'],
    ['Received by', payment.received_by || '—'],
    ['Receipt number', receipt.receipt_number],
  ]);

  // The amount is the point of the document, so it gets the only filled panel on the page.
  page.drawRectangle({
    x: MARGIN,
    y: y - 46,
    width: A4_WIDTH - MARGIN * 2,
    height: 46,
    color: ZEBRA,
    borderColor: RULE,
    borderWidth: 1,
  });
  page.drawText('AMOUNT RECEIVED', { x: MARGIN + 14, y: y - 18, size: 8, font: fonts.regular, color: MUTED });
  const amountText = money(receipt.amount ?? payment.amount, currency);
  page.drawText(amountText, { x: MARGIN + 14, y: y - 38, size: 18, font: fonts.bold, color: INK });
  y -= 74;

  if (allocations.length > 0) {
    page.drawText('APPLIED TO', { x: MARGIN, y, size: 8, font: fonts.regular, color: MUTED });
    y -= 18;

    const columns = [MARGIN, MARGIN + 200, MARGIN + 330, A4_WIDTH - MARGIN];
    page.drawText('Invoice', { x: columns[0], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Applied', { x: columns[1], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Balance after', { x: columns[2], y, size: 9, font: fonts.bold, color: MUTED });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 16;

    for (const allocation of allocations) {
      page.drawText(truncate(allocation.invoice_number, 28), { x: columns[0], y, size: 10, font: fonts.regular, color: INK });
      page.drawText(money(allocation.applied, currency), { x: columns[1], y, size: 10, font: fonts.regular, color: INK });
      page.drawText(money(allocation.balance_due, currency), { x: columns[2], y, size: 10, font: fonts.regular, color: INK });
      y -= 18;
    }
  }

  page.drawText('This receipt is computer generated and is valid without a signature.', {
    x: MARGIN,
    y: MARGIN,
    size: 8,
    font: fonts.regular,
    color: MUTED,
  });

  return pdf.save();
};

/** A full fee statement: every invoice and payment, with a running balance. */
export const buildFeeStatementPdf = async ({ school, student, entries = [], summary = {}, asOf }) => {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: null,
    bold: null,
  };
  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  fonts.regular = await pdf.embedFont(StandardFonts.Helvetica);
  fonts.bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const currency = summary.currency || 'UGX';

  let y = drawHeader(page, fonts, {
    title: 'FEE STATEMENT',
    schoolName: school,
    subtitle: `As at ${isoDate(asOf)}`,
  });

  y = drawFields(page, fonts, y, [
    ['Student', student.full_name],
    ['Student number', student.student_number],
    ['Class', `Grade ${student.grade_level} ${student.class_section}`],
    ['Statement date', isoDate(asOf)],
  ]);

  const columns = [MARGIN, MARGIN + 78, MARGIN + 190, MARGIN + 300, MARGIN + 390, MARGIN + 470];
  const drawTableHeader = () => {
    page.drawText('Date', { x: columns[0], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Reference', { x: columns[1], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Description', { x: columns[2], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Debit', { x: columns[3], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Credit', { x: columns[4], y, size: 9, font: fonts.bold, color: MUTED });
    page.drawText('Balance', { x: columns[5], y, size: 9, font: fonts.bold, color: MUTED });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 15;
  };

  drawTableHeader();

  for (const [index, entry] of entries.entries()) {
    // A long fee history spills onto as many pages as it needs rather than running off the page.
    if (y < MARGIN + 90) {
      page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
      y = drawHeader(page, fonts, {
        title: 'FEE STATEMENT',
        schoolName: school,
        subtitle: `${student.student_number} (continued)`,
      });
      drawTableHeader();
    }

    if (index % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: A4_WIDTH - MARGIN * 2, height: 16, color: ZEBRA });
    }

    page.drawText(isoDate(entry.date), { x: columns[0], y, size: 9, font: fonts.regular, color: INK });
    page.drawText(truncate(entry.reference || '—', 18), { x: columns[1], y, size: 9, font: fonts.regular, color: INK });
    page.drawText(truncate(entry.description || '', 18), { x: columns[2], y, size: 9, font: fonts.regular, color: INK });
    page.drawText(entry.debit ? money(entry.debit, currency) : '—', { x: columns[3], y, size: 9, font: fonts.regular, color: INK });
    page.drawText(entry.credit ? money(entry.credit, currency) : '—', { x: columns[4], y, size: 9, font: fonts.regular, color: INK });
    page.drawText(money(entry.balance, currency), { x: columns[5], y, size: 9, font: fonts.bold, color: INK });
    y -= 18;
  }

  if (entries.length === 0) {
    page.drawText('No fee activity has been recorded for this student.', {
      x: MARGIN,
      y,
      size: 10,
      font: fonts.regular,
      color: MUTED,
    });
    y -= 24;
  }

  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 1, color: RULE });
  y -= 24;

  for (const [label, value] of [
    ['Total invoiced', summary.total_invoiced],
    ['Bursaries applied', summary.total_discounted],
    ['Total paid', summary.total_paid],
    ['Balance due', summary.balance_due],
  ]) {
    if (value === undefined || value === null) continue;
    const isBalance = label === 'Balance due';
    const text = money(value, currency);
    const width = fonts.bold.widthOfTextAtSize(text, isBalance ? 13 : 10);
    page.drawText(label, { x: A4_WIDTH - MARGIN - 200, y, size: isBalance ? 11 : 10, font: isBalance ? fonts.bold : fonts.regular, color: isBalance ? INK : MUTED });
    page.drawText(text, { x: A4_WIDTH - MARGIN - width, y, size: isBalance ? 13 : 10, font: fonts.bold, color: isBalance ? BRAND : INK });
    y -= isBalance ? 24 : 18;
  }

  return pdf.save();
};
