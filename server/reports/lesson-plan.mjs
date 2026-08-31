/**
 * Renders a lesson plan as a printable PDF a teacher can carry into the classroom.
 *
 * Reuses the page writer and text-safety helpers from exam-paper.mjs so both teaching documents lay
 * out identically and neither can drift from the other's typography.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import {
  CONTENT_WIDTH,
  INK,
  MARGIN,
  MUTED,
  PAGE_WIDTH,
  createWriter,
  parseHexColor,
  toWinAnsi,
} from './exam-paper.mjs';

const asArray = (value) => (Array.isArray(value) ? value : []);

const formatDate = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
};

/**
 * The stage-by-stage table — the part a teacher actually reads while teaching, so it gets a real
 * three-column layout rather than running prose.
 */
const drawActivities = (writer, fonts, theme, activities) => {
  if (activities.length === 0) return;

  writer.gap(4);
  writer.banner('LESSON SEQUENCE');

  const stageWidth = 96;
  const columnGap = 10;
  const halfWidth = (CONTENT_WIDTH - stageWidth - columnGap * 2) / 2;

  // Header row.
  const headerBaseline = writer.y - 9;
  writer.page.drawText('STAGE', { x: MARGIN, y: headerBaseline, size: 8, font: fonts.bold, color: MUTED });
  writer.page.drawText('TEACHER DOES', {
    x: MARGIN + stageWidth + columnGap,
    y: headerBaseline,
    size: 8,
    font: fonts.bold,
    color: MUTED,
  });
  writer.page.drawText('LEARNERS DO', {
    x: MARGIN + stageWidth + columnGap * 2 + halfWidth,
    y: headerBaseline,
    size: 8,
    font: fonts.bold,
    color: MUTED,
  });
  writer.gap(14);
  writer.rule({ gapBefore: 0, gapAfter: 6 });

  for (const activity of activities) {
    // The row's height is set by whichever column wraps to the most lines, so the three stay
    // aligned instead of the writer's single cursor interleaving them.
    const stageLines = writer.measure(
      [activity.stage, activity.minutes != null ? `${activity.minutes} min` : ''].filter(Boolean).join('\n'),
      { size: 9.5, font: fonts.bold, width: stageWidth },
    );
    const teacherLines = writer.measure(activity.teacherActivity || activity.teacher_activity, {
      size: 9.5,
      width: halfWidth,
    });
    const learnerLines = writer.measure(activity.learnerActivity || activity.learner_activity, {
      size: 9.5,
      width: halfWidth,
    });

    const rowHeight = Math.max(stageLines.length, teacherLines.length, learnerLines.length) * 12.5 + 6;
    writer.ensureRoom(rowHeight);

    const top = writer.y;
    const drawColumn = (lines, x, font) => {
      lines.forEach((line, index) => {
        writer.page.drawText(line, {
          x,
          y: top - 9.5 - index * 12.5,
          size: 9.5,
          font: font || fonts.regular,
          color: INK,
        });
      });
    };

    drawColumn(stageLines, MARGIN, fonts.bold);
    drawColumn(teacherLines, MARGIN + stageWidth + columnGap);
    drawColumn(learnerLines, MARGIN + stageWidth + columnGap * 2 + halfWidth);

    writer.gap(rowHeight);
    writer.rule({ color: rgb(0.93, 0.94, 0.96), gapBefore: 0, gapAfter: 5 });
  }
};

const drawBulletList = (writer, fonts, label, items) => {
  const values = asArray(items).filter(Boolean);
  if (values.length === 0) return;

  writer.gap(4);
  writer.text(label, { size: 9.5, font: fonts.bold, color: MUTED });
  writer.gap(2);
  for (const item of values) {
    writer.text(`•  ${typeof item === 'string' ? item : item.description || JSON.stringify(item)}`, {
      size: 10,
      indent: 8,
      lineGap: 2,
    });
  }
};

export const buildLessonPlanPdf = async ({ school, themeColor, plan }) => {
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

  writer.text(plan.title, { size: 13, font: fonts.bold });
  writer.text('LESSON PLAN', { size: 10, font: fonts.bold, color: MUTED });
  writer.gap(4);

  const facts = [
    plan.subject_name ? `Subject: ${plan.subject_name}` : null,
    plan.grade_level != null ? `Class: Grade ${plan.grade_level}` : null,
    plan.topic ? `Topic: ${plan.topic}` : null,
    plan.academic_year ? `Year: ${plan.academic_year}` : null,
    plan.term ? `Term: ${plan.term}` : null,
    formatDate(plan.lesson_date) ? `Date: ${formatDate(plan.lesson_date)}` : null,
    plan.period ? `Period: ${plan.period}` : null,
    `Duration: ${plan.duration_minutes} minutes`,
  ].filter(Boolean);

  writer.text(facts.join('   |   '), { size: 9.5, color: MUTED });
  writer.rule();

  drawBulletList(writer, fonts, 'LEARNING OUTCOMES', plan.learning_outcomes);
  drawBulletList(writer, fonts, 'COMPETENCIES DEVELOPED', plan.competencies);
  drawBulletList(writer, fonts, 'TEACHING AIDS AND MATERIALS', plan.materials);

  drawActivities(writer, fonts, theme, asArray(plan.activities));

  const assessment = asArray(plan.assessment);
  if (assessment.length > 0) {
    writer.gap(4);
    writer.text('ASSESSMENT', { size: 9.5, font: fonts.bold, color: MUTED });
    writer.gap(2);
    for (const entry of assessment) {
      writer.text(`•  ${entry.method}: ${entry.description}`, { size: 10, indent: 8, lineGap: 2 });
    }
  }

  if (plan.differentiation) {
    writer.gap(4);
    writer.text('DIFFERENTIATION', { size: 9.5, font: fonts.bold, color: MUTED });
    writer.gap(2);
    writer.text(plan.differentiation, { size: 10 });
  }

  if (plan.homework) {
    writer.gap(4);
    writer.text('HOMEWORK', { size: 9.5, font: fonts.bold, color: MUTED });
    writer.gap(2);
    writer.text(plan.homework, { size: 10 });
  }

  // The syllabus passages the draft came from, so a head of department can check the plan against
  // the curriculum rather than taking it on trust.
  const references = asArray(plan.refs);
  if (references.length > 0) {
    writer.rule();
    writer.text('SYLLABUS REFERENCES', { size: 9, font: fonts.bold, color: MUTED });
    writer.gap(2);
    for (const reference of references) {
      writer.text(`•  ${reference.title}${reference.heading ? ` — ${reference.heading}` : ''}`, {
        size: 8.5,
        font: fonts.italic,
        indent: 8,
        lineGap: 2,
        color: MUTED,
      });
    }
  }

  writer.gap(18);
  writer.rule({ gapBefore: 0, gapAfter: 6 });
  writer.text("Teacher's signature: ______________________        Date: ______________", {
    size: 9,
    color: MUTED,
  });

  return Buffer.from(await pdfDoc.save());
};

// Re-exported so callers importing the lesson-plan module do not need to reach into exam-paper for
// the shared page constants.
export { PAGE_WIDTH, MARGIN, toWinAnsi };
