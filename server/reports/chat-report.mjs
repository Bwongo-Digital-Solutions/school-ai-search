/**
 * Renders a saved AI conversation as a branded, printable PDF.
 *
 * The assistant answers in Markdown — headings, bullet lists and, very often, tables of students —
 * so this does a small amount of real Markdown rendering rather than dumping the raw text. A table
 * of GPAs printed as pipes and dashes would be unreadable on paper, which is the whole point of the
 * report.
 *
 * Reuses the page writer from exam-paper.mjs so every document in the app lays out identically.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { CONTENT_WIDTH, INK, MARGIN, MUTED, createWriter, parseHexColor, toWinAnsi } from './exam-paper.mjs';

const ROLE_LABELS = { user: 'Question', assistant: 'SchoolBot AI' };

/** Strips inline emphasis so `**bold**` and `` `code` `` do not print as literal punctuation. */
const stripInline = (text) =>
  String(text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(?!\s)(.+?)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

const splitTableRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => stripInline(cell.trim()));

const isTableDivider = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

/**
 * Parses Markdown into the handful of block types worth rendering: headings, bullets, tables and
 * paragraphs. Anything unrecognised falls through as a paragraph, so no content is ever dropped.
 */
const parseBlocks = (markdown) => {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: stripInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: stripInline(heading[2]) });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: stripInline(bullet[1]) });
      continue;
    }

    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: `${numbered[1]}. ${stripInline(numbered[2])}`, numbered: true });
      continue;
    }

    // A pipe row followed by a divider starts a table; consume rows until they stop.
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      const rows = [];
      index += 1; // skip the divider
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        index += 1;
        rows.push(splitTableRow(lines[index]));
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
};

/**
 * Draws a table with columns sized to their widest cell, capped so one long column cannot squeeze
 * the rest off the page. Cells are truncated rather than wrapped: these are scan-and-compare tables
 * (names, grades, percentages), and ragged row heights would make them harder to read, not easier.
 */
const drawTable = (writer, fonts, theme, block) => {
  const columnCount = block.header.length;
  if (columnCount === 0) return;

  const allRows = [block.header, ...block.rows];
  const rawWidths = block.header.map((_, column) =>
    Math.max(...allRows.map((row) => (row[column] || '').length)),
  );
  const totalRaw = rawWidths.reduce((sum, width) => sum + width, 0) || 1;
  const widths = rawWidths.map((width) => Math.max((width / totalRaw) * CONTENT_WIDTH, 40));

  const size = 8.5;
  const rowHeight = 14;

  const drawRow = (cells, { bold = false, color = INK } = {}) => {
    writer.ensureRoom(rowHeight);
    const top = writer.y;
    let x = MARGIN;

    cells.forEach((cell, column) => {
      const width = widths[column] ?? 60;
      const font = bold ? fonts.bold : fonts.regular;
      let text = toWinAnsi(cell ?? '');

      // Trim to fit the column rather than letting neighbours overlap.
      while (text.length > 1 && font.widthOfTextAtSize(text, size) > width - 6) {
        text = text.slice(0, -1);
      }

      writer.page.drawText(text, { x, y: top - size - 2, size, font, color });
      x += width;
    });

    writer.gap(rowHeight);
  };

  writer.gap(4);
  drawRow(block.header, { bold: true, color: theme });
  writer.rule({ color: rgb(0.86, 0.88, 0.92), gapBefore: 0, gapAfter: 2 });
  for (const row of block.rows) {
    drawRow(row);
  }
  writer.gap(4);
};

const formatTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const buildChatReportPdf = async ({ school, themeColor, conversation, messages }) => {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const theme = parseHexColor(themeColor);
  const writer = createWriter(pdfDoc, fonts, theme);

  writer.text(school.school_name || 'School', { size: 16, font: fonts.bold });
  if (school.address) writer.text(school.address, { size: 9, color: MUTED });
  writer.gap(6);

  writer.text(conversation.title || 'AI Assistant Report', { size: 13, font: fonts.bold });
  writer.text('AI ASSISTANT REPORT', { size: 10, font: fonts.bold, color: MUTED });
  writer.gap(4);

  const facts = [
    `Messages: ${messages.length}`,
    conversation.created_at ? `Started: ${formatTimestamp(conversation.created_at)}` : null,
    `Generated: ${formatTimestamp(new Date())}`,
  ].filter(Boolean);
  writer.text(facts.join('   |   '), { size: 9.5, color: MUTED });
  writer.rule();

  for (const message of messages) {
    const isUser = message.role === 'user';
    writer.gap(6);

    // A left rule and a role label make the two voices scannable without colour, which matters on
    // the black-and-white printer a school actually has.
    writer.ensureRoom(20);
    const labelY = writer.y - 10;
    writer.page.drawText(toWinAnsi(ROLE_LABELS[message.role] || message.role), {
      x: MARGIN,
      y: labelY,
      size: 9,
      font: fonts.bold,
      color: isUser ? MUTED : theme,
    });
    const stamp = formatTimestamp(message.created_at);
    if (stamp) {
      writer.rightText(stamp, labelY, { size: 8, font: fonts.regular, color: MUTED });
    }
    writer.gap(16);

    for (const block of parseBlocks(message.content)) {
      if (block.type === 'heading') {
        writer.gap(3);
        writer.text(block.text, { size: block.level <= 2 ? 11 : 10, font: fonts.bold, indent: 10 });
      } else if (block.type === 'bullet') {
        writer.text(`${block.numbered ? '' : '- '}${block.text}`, { size: 10, indent: 18, lineGap: 2 });
      } else if (block.type === 'table') {
        drawTable(writer, fonts, theme, block);
      } else {
        writer.text(block.text, { size: 10, indent: 10 });
      }
    }

    // What the assistant actually consulted — the same sources the chat shows on screen, so a
    // printed answer can be checked against the syllabus rather than taken on trust.
    const citations = Array.isArray(message.metadata?.citations) ? message.metadata.citations : [];
    if (citations.length > 0) {
      writer.gap(3);
      writer.text('Sources', { size: 8.5, font: fonts.bold, indent: 10, color: MUTED });
      for (const citation of citations) {
        writer.text(
          `[${citation.citationIndex}] ${citation.title}${citation.heading ? ` — ${citation.heading}` : ''}`,
          { size: 8.5, font: fonts.italic, indent: 18, lineGap: 1, color: MUTED },
        );
      }
    }

    const steps = Array.isArray(message.metadata?.steps) ? message.metadata.steps : [];
    if (steps.length > 0) {
      writer.text(`Tools used: ${steps.map((step) => step.tool).join(', ')}`, {
        size: 8.5,
        font: fonts.italic,
        indent: 10,
        color: MUTED,
      });
    }

    if (message.metadata?.modelName) {
      writer.text(`Model: ${message.metadata.modelName}`, {
        size: 8,
        font: fonts.italic,
        indent: 10,
        color: MUTED,
      });
    }

    writer.rule({ gapBefore: 6, gapAfter: 4 });
  }

  writer.gap(8);
  writer.text(
    'Generated by SchoolBot AI. Answers are drawn from school records and the curriculum library; ' +
      'check anything consequential against the source before acting on it.',
    { size: 8, font: fonts.italic, color: MUTED },
  );

  return Buffer.from(await pdfDoc.save());
};
