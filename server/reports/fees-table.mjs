/**
 * The printable version of a fees list.
 *
 * Every screen under Fees is a table of something — structures, a billing run, arrears, bursaries,
 * payment ratings — and each needed to leave the building on paper: a bursar takes the arrears list
 * into a meeting, a head signs off a billing run, a sponsor is sent the bursaries they fund.
 *
 * One renderer rather than one per screen. The five documents differ only in their title, their
 * columns and their totals row, and five copies of this page-breaking arithmetic would be five
 * places for the footer to drift out of step with the header. Callers hand over strings they have
 * already formatted, so this file knows nothing about money, terms or grades and cannot disagree
 * with the screen about how a number reads.
 *
 * Deliberately the same furniture as finance-report.mjs — the brand rule, the tiles, the zebra
 * striping, the footer — because these come out of the same drawer as that document and a school
 * printing both should not get two different letterheads.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { APP_VERSION } from '../version.mjs';
import { toWinAnsi } from './exam-paper.mjs';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const LANDSCAPE = [A4_HEIGHT, A4_WIDTH];
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
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
};

const isoDate = (value) => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
};

/**
 * Trim a cell to the width it has, in points rather than in characters.
 *
 * Counting characters is what puts "Nakiwuge Sser…" beside "Ali Ojok" with an inch of white space
 * after it: a proportional font gives those two the same character count and wildly different
 * widths. Measuring the actual string is the only way a column stays inside its own borders.
 */
const fitText = (text, font, size, maxWidth) => {
  const value = toWinAnsi(text ?? '');
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;

  const ellipsis = '...';
  const room = Math.max(0, maxWidth - font.widthOfTextAtSize(ellipsis, size));
  let cut = value;
  while (cut.length > 0 && font.widthOfTextAtSize(cut, size) > room) {
    cut = cut.slice(0, -1);
  }
  return cut ? `${cut}${ellipsis}` : '';
};

/**
 * A fees table as a PDF.
 *
 * @param {object}   options
 * @param {string}   options.school       The school's name, for the letterhead.
 * @param {string}   [options.tagline]
 * @param {string}   [options.themeColor] Hex; falls back to the default brand.
 * @param {string}   options.title        Printed at the top right, e.g. 'ARREARS'.
 * @param {string}   [options.subtitle]   Under the title — the filters this list was taken under.
 * @param {{label: string, value: string}[]} [options.tiles] Up to four headline figures.
 * @param {{label: string, width: number, align?: 'left'|'right'}[]} options.columns
 *        `width` is relative: the columns are scaled to fill the page between the margins.
 * @param {string[][]} options.rows       Cells, already formatted, in column order.
 * @param {string[]} [options.totalsRow]  Ruled off and set in bold under the last row.
 * @param {string}   [options.emptyText]  Shown in place of the table when there are no rows.
 * @param {string}   [options.note]       A line under the table: a caveat, a signature line.
 * @param {boolean}  [options.landscape]  For tables too wide to read down an A4 portrait page.
 */
export const buildFeesTablePdf = async ({
  school,
  tagline,
  themeColor,
  title,
  subtitle = '',
  tiles = [],
  columns,
  rows,
  totalsRow = null,
  emptyText = 'Nothing to show.',
  note = '',
  landscape = false,
}) => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = parseHexColor(themeColor);

  const [pageWidth, pageHeight] = landscape ? LANDSCAPE : [A4_WIDTH, A4_HEIGHT];
  const contentWidth = pageWidth - MARGIN * 2;

  // Relative widths scaled to the page, so a caller says "this column is twice that one" and never
  // has to know how wide the paper is or whether it was turned on its side.
  const weight = columns.reduce((total, column) => total + (Number(column.width) || 1), 0);
  const widths = columns.map((column) => ((Number(column.width) || 1) / weight) * contentWidth);
  const offsets = widths.reduce((acc, width, index) => {
    acc.push(index === 0 ? MARGIN : acc[index - 1] + widths[index - 1]);
    return acc;
  }, []);

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - MARGIN;

  /* Right-aligned cells are measured from their column's right edge, less a gutter, so a column of
     money lines up on the last digit rather than on the first. */
  const drawCell = (text, index, size, font, color) => {
    const value = fitText(text, font, size, widths[index] - 8);
    const align = columns[index].align === 'right' ? 'right' : 'left';
    const x = align === 'right'
      ? offsets[index] + widths[index] - 6 - font.widthOfTextAtSize(value, size)
      : offsets[index];
    page.drawText(value, { x, y, size, font, color });
  };

  const drawTableHeader = () => {
    columns.forEach((column, index) => drawCell(column.label, index, 8, bold, MUTED));
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pageWidth - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 14;
  };

  // Letterhead
  page.drawRectangle({ x: 0, y: y - 6, width: pageWidth, height: 6, color: brand });
  page.drawText(fitText(school || 'eSchool', bold, 17, contentWidth * 0.55), {
    x: MARGIN, y: y - 34, size: 17, font: bold, color: INK,
  });
  if (tagline) {
    page.drawText(fitText(tagline, regular, 9, contentWidth * 0.55), {
      x: MARGIN, y: y - 50, size: 9, font: regular, color: MUTED,
    });
  }

  const heading = toWinAnsi(title).toUpperCase();
  page.drawText(heading, {
    x: pageWidth - MARGIN - bold.widthOfTextAtSize(heading, 15), y: y - 34, size: 15, font: bold, color: brand,
  });
  if (subtitle) {
    const sub = toWinAnsi(subtitle);
    page.drawText(sub, {
      x: pageWidth - MARGIN - regular.widthOfTextAtSize(sub, 9), y: y - 50, size: 9, font: regular, color: MUTED,
    });
  }
  y -= 66;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: pageWidth - MARGIN, y }, thickness: 1, color: RULE });
  y -= 28;

  // Headline figures, in the same tiles the financial report uses.
  if (tiles.length > 0) {
    const tileW = (contentWidth - (tiles.length - 1) * 10) / tiles.length;
    tiles.forEach((tile, index) => {
      const x = MARGIN + index * (tileW + 10);
      page.drawRectangle({ x, y: y - 44, width: tileW, height: 44, color: ZEBRA, borderColor: RULE, borderWidth: 1 });
      page.drawText(fitText(tile.label, regular, 7.5, tileW - 20).toUpperCase(), {
        x: x + 10, y: y - 16, size: 7.5, font: regular, color: MUTED,
      });
      page.drawText(fitText(tile.value, bold, 13, tileW - 20), {
        x: x + 10, y: y - 34, size: 13, font: bold, color: INK,
      });
    });
    y -= 68;
  }

  drawTableHeader();

  if (rows.length === 0) {
    page.drawText(toWinAnsi(emptyText), { x: MARGIN, y, size: 9, font: regular, color: MUTED });
    y -= 16;
  }

  const continued = `${toWinAnsi(school || 'eSchool')} - ${toWinAnsi(title)} (continued)`;
  for (const [index, row] of rows.entries()) {
    if (y < MARGIN + 60) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - MARGIN;
      page.drawText(fitText(continued, bold, 9, contentWidth), { x: MARGIN, y: y - 10, size: 9, font: bold, color: MUTED });
      y -= 34;
      drawTableHeader();
    }
    if (index % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: contentWidth, height: 15, color: ZEBRA });
    }
    row.forEach((cell, cellIndex) => {
      if (cellIndex < columns.length) drawCell(cell, cellIndex, 8.5, regular, INK);
    });
    y -= 15;
  }

  if (totalsRow) {
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pageWidth - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 14;
    totalsRow.forEach((cell, index) => {
      if (index < columns.length) drawCell(cell, index, 8.5, bold, index === 0 ? INK : brand);
    });
    y -= 16;
  }

  if (note) {
    y -= 8;
    page.drawText(fitText(note, regular, 8, contentWidth), { x: MARGIN, y, size: 8, font: regular, color: MUTED });
  }

  for (const p of pdf.getPages()) {
    p.drawText(`Powered by e-School · v${APP_VERSION}`.replace('·', '-'), {
      x: MARGIN, y: 30, size: 7.5, font: regular, color: MUTED,
    });
    const stamp = `Generated ${isoDate(new Date())}`;
    p.drawText(stamp, {
      x: pageWidth - MARGIN - regular.widthOfTextAtSize(stamp, 7.5), y: 30, size: 7.5, font: regular, color: MUTED,
    });
  }

  return pdf.save();
};
