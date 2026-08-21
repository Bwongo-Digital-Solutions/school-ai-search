/**
 * Renders an assembled paper as two PDFs: the question paper a learner sits, and the marking scheme
 * a colleague marks from.
 *
 * Both are produced by the same builder from the same data, so they cannot drift apart — question 4
 * on the paper is always question 4 in the scheme. Branding comes from loadSchoolSettings(), like
 * every other document in server/reports/.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const PAGE_WIDTH = 595.28; // A4 portrait, in points.
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 52;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export const INK = rgb(0.14, 0.14, 0.18);
export const MUTED = rgb(0.4, 0.44, 0.5);
const DEFAULT_THEME = rgb(0.16, 0.27, 0.58);

export const parseHexColor = (value, fallback = DEFAULT_THEME) => {
  const hex = String(value || '').trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
};

/**
 * Wraps to a measured width rather than a character count, because a question stem mixes prose with
 * symbols and formulae that a fixed column estimate would either overflow or waste space on.
 */
export const wrapToWidth = (text, font, size, maxWidth) => {
  const paragraphs = String(text ?? '').split(/\n/);
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
};

// pdf-lib's standard fonts are WinAnsi-encoded and throw on characters outside it. Model output
// routinely contains typographic dashes, curly quotes and arrows, so fold them to safe equivalents
// rather than letting one character abort a whole download.
export const toWinAnsi = (text) =>
  String(text ?? '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[→⇒]/g, '->')
    .replace(/[   ]/g, ' ')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E\n]/g, '');

/**
 * A cursor that lays text down the page and starts a new one when it runs out of room, so callers
 * never track y-coordinates or page breaks themselves.
 */
export const createWriter = (pdfDoc, fonts, theme) => {
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureRoom = (needed) => {
    if (y - needed >= MARGIN) return;
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  return {
    get page() {
      return page;
    },
    get y() {
      return y;
    },
    gap(amount) {
      y -= amount;
    },
    // Exposed for multi-column layouts, which must reserve a whole row's height before drawing any
    // of its columns — otherwise a page break mid-row splits the columns across two pages.
    ensureRoom,
    /**
     * Wraps text to a given width without drawing it, so a caller can size a row from the tallest
     * of several columns.
     */
    measure(value, { size = 10.5, font = fonts.regular, width = CONTENT_WIDTH } = {}) {
      return wrapToWidth(toWinAnsi(value), font, size, width);
    },
    text(value, { size = 10.5, font = fonts.regular, color = INK, indent = 0, lineGap = 3 } = {}) {
      const width = CONTENT_WIDTH - indent;
      const lines = wrapToWidth(toWinAnsi(value), font, size, width);

      for (const line of lines) {
        ensureRoom(size + lineGap);
        page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color });
        y -= size + lineGap;
      }
    },
    rule({ color = rgb(0.86, 0.88, 0.92), thickness = 0.75, gapBefore = 6, gapAfter = 8 } = {}) {
      y -= gapBefore;
      ensureRoom(thickness + gapAfter);
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_WIDTH - MARGIN, y },
        thickness,
        color,
      });
      y -= gapAfter;
    },
    banner(label) {
      ensureRoom(26);
      page.drawRectangle({
        x: MARGIN,
        y: y - 20,
        width: CONTENT_WIDTH,
        height: 20,
        color: theme,
      });
      page.drawText(toWinAnsi(label), {
        x: MARGIN + 8,
        y: y - 14.5,
        size: 10,
        font: fonts.bold,
        color: rgb(1, 1, 1),
      });
      y -= 30;
    },
    // Right-aligned, used for the mark allocation beside a question.
    rightText(value, baselineY, { size = 9.5, font = fonts.bold, color = MUTED } = {}) {
      const safe = toWinAnsi(value);
      page.drawText(safe, {
        x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(safe, size),
        y: baselineY,
        size,
        font,
        color,
      });
    },
  };
};

const drawHeader = (writer, fonts, { school, paper, documentLabel }) => {
  writer.text(school.school_name || 'School', { size: 16, font: fonts.bold });
  if (school.address) writer.text(school.address, { size: 9, color: MUTED });
  writer.gap(6);

  writer.text(paper.title, { size: 13, font: fonts.bold });
  writer.text(documentLabel, { size: 10, font: fonts.bold, color: MUTED });
  writer.gap(4);

  const facts = [
    paper.subject_name ? `Subject: ${paper.subject_name}` : null,
    paper.grade_level != null ? `Class: Grade ${paper.grade_level}` : null,
    paper.academic_year ? `Year: ${paper.academic_year}` : null,
    paper.term ? `Term: ${paper.term}` : null,
    paper.duration_minutes ? `Duration: ${paper.duration_minutes} minutes` : null,
    `Total marks: ${paper.total_marks}`,
  ].filter(Boolean);

  writer.text(facts.join('   |   '), { size: 9.5, color: MUTED });
  writer.rule();
};

const optionLabel = (index) => String.fromCharCode(65 + index);

const buildQuestionPaper = async ({ school, themeColor, paper, questions }) => {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const theme = parseHexColor(themeColor);
  const writer = createWriter(pdfDoc, fonts, theme);

  drawHeader(writer, fonts, { school, paper, documentLabel: 'QUESTION PAPER' });

  if (paper.instructions) {
    writer.text('INSTRUCTIONS TO CANDIDATES', { size: 9.5, font: fonts.bold });
    writer.gap(2);
    writer.text(paper.instructions, { size: 10 });
    writer.rule();
  }

  // Questions carry their section label from assembly; group consecutively so a section heading is
  // printed once rather than above every question.
  let currentSection = null;

  questions.forEach((question, index) => {
    const section = question.section_label || null;
    if (section && section !== currentSection) {
      writer.gap(4);
      writer.banner(section);
      currentSection = section;
    }

    writer.gap(4);
    const numberLabel = `${index + 1}.`;
    const baseline = writer.y - 11;

    writer.page.drawText(numberLabel, {
      x: MARGIN,
      y: baseline,
      size: 11,
      font: fonts.bold,
      color: theme,
    });
    writer.rightText(`[${question.marks}]`, baseline);

    writer.text(question.stem, { size: 10.5, indent: 24 });

    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length > 0) {
      writer.gap(2);
      options.forEach((option, position) => {
        writer.text(`${optionLabel(position)}.  ${option}`, { size: 10, indent: 38, lineGap: 2 });
      });
    }

    // Leave writing room proportional to the marks, so a 20-mark essay is not given three lines.
    if (options.length === 0) {
      writer.gap(Math.min(14 + Number(question.marks || 1) * 8, 90));
    } else {
      writer.gap(6);
    }
  });

  writer.gap(10);
  writer.text('END OF PAPER', { size: 10, font: fonts.bold, color: MUTED });

  return Buffer.from(await pdfDoc.save());
};

const buildMarkingScheme = async ({ school, themeColor, paper, questions }) => {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const theme = parseHexColor(themeColor);
  const writer = createWriter(pdfDoc, fonts, theme);

  drawHeader(writer, fonts, { school, paper, documentLabel: 'MARKING SCHEME — CONFIDENTIAL' });

  questions.forEach((question, index) => {
    writer.gap(4);
    const baseline = writer.y - 11;

    writer.page.drawText(`${index + 1}.`, {
      x: MARGIN,
      y: baseline,
      size: 11,
      font: fonts.bold,
      color: theme,
    });
    writer.rightText(`[${question.marks}]`, baseline);

    writer.text(question.stem, { size: 10, indent: 24, color: MUTED });
    writer.gap(3);

    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length > 0) {
      const correctIndex = options.findIndex(
        (option) => String(option).trim() === String(question.correct_answer).trim(),
      );
      // The stored answer may be the option text or its letter; print whichever we can resolve.
      const answer =
        correctIndex >= 0 ? `${optionLabel(correctIndex)}. ${options[correctIndex]}` : question.correct_answer;
      writer.text(`Answer: ${answer}`, { size: 10.5, font: fonts.bold, indent: 24 });
    } else if (question.correct_answer) {
      writer.text(`Expected answer: ${question.correct_answer}`, { size: 10.5, indent: 24 });
    }

    const scheme = Array.isArray(question.marking_scheme) ? question.marking_scheme : [];
    if (scheme.length > 0) {
      writer.gap(3);
      writer.text('Award marks for:', { size: 9.5, font: fonts.bold, indent: 24, color: MUTED });
      for (const entry of scheme) {
        writer.text(`- ${entry.point}  (${entry.marks})`, { size: 10, indent: 34, lineGap: 2 });
      }
    }

    const tags = [
      question.topic ? `Topic: ${question.topic}` : null,
      question.assessment_objective ? `AO: ${question.assessment_objective}` : null,
      question.bloom_level ? `Bloom: ${question.bloom_level}` : null,
      question.difficulty ? `Difficulty: ${question.difficulty}` : null,
    ].filter(Boolean);

    if (tags.length > 0) {
      writer.gap(2);
      writer.text(tags.join('   |   '), { size: 8.5, font: fonts.italic, indent: 24, color: MUTED });
    }

    // The syllabus passages the question was generated from — this is what makes a generated paper
    // auditable rather than something a head of department has to take on trust.
    const references = Array.isArray(question.source_references) ? question.source_references : [];
    if (references.length > 0) {
      writer.text(
        `Source: ${references.map((reference) => `${reference.title}${reference.heading ? ` — ${reference.heading}` : ''}`).join('; ')}`,
        { size: 8.5, font: fonts.italic, indent: 24, color: MUTED },
      );
    }

    writer.rule({ gapBefore: 6, gapAfter: 6 });
  });

  return Buffer.from(await pdfDoc.save());
};

export const buildExamPaperPdf = async ({ school, themeColor, paper, questions, markingScheme = false }) => {
  const params = { school, themeColor, paper, questions };
  return markingScheme ? buildMarkingScheme(params) : buildQuestionPaper(params);
};
