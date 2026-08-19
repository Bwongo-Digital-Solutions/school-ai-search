import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { APP_VERSION } from '../version.mjs';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;

const INK = rgb(0.12, 0.13, 0.18);
const MUTED = rgb(0.45, 0.47, 0.53);
const RULE = rgb(0.82, 0.84, 0.88);
const DEFAULT_BRAND = rgb(0.31, 0.27, 0.9);
const ZEBRA = rgb(0.97, 0.97, 0.99);

const parseHexColor = (value, fallback = DEFAULT_BRAND) => {
  const hex = String(value || '').trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return rgb(parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255);
};

const truncate = (text, maxCharacters) => {
  const value = String(text ?? '');
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters - 1)}…` : value;
};

const money = (amount, currency) => `${currency} ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;

const isoDate = (value) => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
};

const AGING_COLUMNS = [
  { key: 'current', label: 'Not due' },
  { key: 'days_1_30', label: '1–30d' },
  { key: 'days_31_60', label: '31–60d' },
  { key: 'days_61_90', label: '61–90d' },
  { key: 'days_90_plus', label: '90d+' },
];

/**
 * A one-page (or spilling) school-wide financial report: headline collection totals, the payment
 * standing distribution, and the arrears aging table. Branded from the school settings.
 */
export const buildFinanceReportPdf = async ({ school, tagline, themeColor, summary = {}, arrears = {}, asOf }) => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = parseHexColor(themeColor);
  const currency = summary?.totals?.currency || arrears?.currency || 'UGX';

  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - MARGIN;
  };

  // Header
  page.drawRectangle({ x: 0, y: y - 6, width: A4_WIDTH, height: 6, color: brand });
  page.drawText(truncate(school || 'eSchool', 46), { x: MARGIN, y: y - 34, size: 17, font: bold, color: INK });
  if (tagline) page.drawText(truncate(tagline, 70), { x: MARGIN, y: y - 50, size: 9, font: regular, color: MUTED });
  const title = 'FINANCIAL REPORT';
  page.drawText(title, { x: A4_WIDTH - MARGIN - bold.widthOfTextAtSize(title, 15), y: y - 34, size: 15, font: bold, color: brand });
  const sub = `As at ${isoDate(asOf || summary.asOf)}`;
  page.drawText(sub, { x: A4_WIDTH - MARGIN - regular.widthOfTextAtSize(sub, 9), y: y - 50, size: 9, font: regular, color: MUTED });
  y -= 66;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 1, color: RULE });
  y -= 28;

  // Headline totals as three tiles
  const totals = summary.totals || {};
  const tiles = [
    ['Total invoiced', money(totals.invoiced, currency)],
    ['Total collected', money(totals.collected, currency)],
    ['Outstanding', money(totals.outstanding, currency)],
  ];
  const tileW = (A4_WIDTH - MARGIN * 2 - 20) / 3;
  tiles.forEach(([label, value], index) => {
    const x = MARGIN + index * (tileW + 10);
    page.drawRectangle({ x, y: y - 44, width: tileW, height: 44, color: ZEBRA, borderColor: RULE, borderWidth: 1 });
    page.drawText(label.toUpperCase(), { x: x + 10, y: y - 16, size: 7.5, font: regular, color: MUTED });
    page.drawText(value, { x: x + 10, y: y - 34, size: 13, font: bold, color: INK });
  });
  y -= 68;

  // Payment standing distribution
  const standings = summary.standings || {};
  page.drawText('PAYMENT STANDING DISTRIBUTION', { x: MARGIN, y, size: 9, font: bold, color: MUTED });
  y -= 16;
  const standingOrder = [
    ['excellent', 'Excellent'], ['good', 'Good'], ['fair', 'Fair'],
    ['watch', 'Watch'], ['delinquent', 'Delinquent'], ['unrated', 'Unrated'],
  ];
  const colW = (A4_WIDTH - MARGIN * 2) / standingOrder.length;
  standingOrder.forEach(([key, label], index) => {
    const x = MARGIN + index * colW;
    page.drawText(label, { x, y, size: 8, font: regular, color: MUTED });
    page.drawText(String(standings[key] ?? 0), { x, y: y - 14, size: 13, font: bold, color: INK });
  });
  y -= 40;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
  y -= 22;

  // Arrears aging table
  page.drawText('ARREARS AGEING', { x: MARGIN, y, size: 9, font: bold, color: MUTED });
  y -= 18;
  const rows = arrears.rows || [];
  const nameX = MARGIN;
  const classX = MARGIN + 130;
  const bucketX = (index) => MARGIN + 190 + index * 50;
  const totalX = MARGIN + 190 + AGING_COLUMNS.length * 50;

  const drawTableHeader = () => {
    page.drawText('Student', { x: nameX, y, size: 8, font: bold, color: MUTED });
    page.drawText('Class', { x: classX, y, size: 8, font: bold, color: MUTED });
    AGING_COLUMNS.forEach((col, index) => page.drawText(col.label, { x: bucketX(index), y, size: 7.5, font: bold, color: MUTED }));
    page.drawText('Total', { x: totalX, y, size: 8, font: bold, color: MUTED });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 14;
  };
  drawTableHeader();

  if (rows.length === 0) {
    page.drawText('No outstanding balances.', { x: nameX, y, size: 9, font: regular, color: MUTED });
    y -= 16;
  }

  for (const [index, row] of rows.entries()) {
    if (y < MARGIN + 60) {
      newPage();
      page.drawText(`${truncate(school || 'eSchool', 40)} — Financial Report (continued)`, { x: MARGIN, y: y - 10, size: 9, font: bold, color: MUTED });
      y -= 34;
      drawTableHeader();
    }
    if (index % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - 4, width: A4_WIDTH - MARGIN * 2, height: 15, color: ZEBRA });
    page.drawText(truncate(row.full_name, 24), { x: nameX, y, size: 8.5, font: regular, color: INK });
    page.drawText(`G${row.grade_level} ${row.class_section || ''}`.trim(), { x: classX, y, size: 8.5, font: regular, color: MUTED });
    AGING_COLUMNS.forEach((col, colIndex) => {
      const amount = row[col.key] || 0;
      page.drawText(amount ? Math.round(amount).toLocaleString('en-US') : '—', { x: bucketX(colIndex), y, size: 7.5, font: regular, color: INK });
    });
    page.drawText(Math.round(row.total_outstanding || 0).toLocaleString('en-US'), { x: totalX, y, size: 8.5, font: bold, color: INK });
    y -= 15;
  }

  // Totals row
  const at = arrears.totals || {};
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
  y -= 14;
  page.drawText('Totals', { x: nameX, y, size: 8.5, font: bold, color: INK });
  AGING_COLUMNS.forEach((col, index) => page.drawText(Math.round(at[col.key] || 0).toLocaleString('en-US'), { x: bucketX(index), y, size: 7.5, font: bold, color: INK }));
  page.drawText(money(at.total, currency).replace(`${currency} `, ''), { x: totalX, y, size: 8.5, font: bold, color: brand });

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p) => {
    p.drawText(`Powered by e-School · v${APP_VERSION}`, { x: MARGIN, y: 30, size: 7.5, font: regular, color: MUTED });
    const stamp = `Generated ${isoDate(new Date())}`;
    p.drawText(stamp, { x: A4_WIDTH - MARGIN - regular.widthOfTextAtSize(stamp, 7.5), y: 30, size: 7.5, font: regular, color: MUTED });
  });

  return pdf.save();
};
