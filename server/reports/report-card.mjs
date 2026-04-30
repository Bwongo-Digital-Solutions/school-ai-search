import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { gradeScore, resolveGradingScheme } from './grading-config.mjs';

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'SchoolBot Academy';
const SCHOOL_TAGLINE = process.env.SCHOOL_TAGLINE || 'Academic Excellence and Character';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hashText = (input) => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildSubjectResults = (student, term, academicYear, gradingScheme) => {
  const baseScore = Math.round(student.gpa * 25);
  const attendanceAdjustment =
    student.attendance_rate >= 95 ? 4 : student.attendance_rate >= 90 ? 2 : student.attendance_rate >= 85 ? 0 : -4;

  return student.subjects.map((subject, index) => {
    const variance = (hashText(`${student.id}:${subject}:${term}:${academicYear}:${index}`) % 19) - 9;
    const score = clamp(baseScore + attendanceAdjustment + variance, 45, 99);
    const result = gradeScore(score, gradingScheme);

    return {
      subject,
      score,
      grade: result.grade,
      remark: result.remark,
    };
  });
};

const buildGeneralComment = (student, averageScore) => {
  if (student.gpa >= 3.7 && student.attendance_rate >= 95) {
    return 'Outstanding academic performance with excellent consistency and classroom discipline.';
  }
  if (averageScore >= 80) {
    return 'Strong overall performance. Keep building momentum across all subjects.';
  }
  if (averageScore >= 70) {
    return 'Solid progress this term. More revision and steady attendance will improve results further.';
  }
  return 'Needs closer academic support and follow-through on assignments next term.';
};

const formatAcademicYear = (value) => value || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;

export const buildReportCardPdf = async ({
  student,
  term = 'Term 1',
  academicYear,
  gradingCountry,
  academicLevel,
}) => {
  const resolvedYear = formatAcademicYear(academicYear);
  const gradingScheme = resolveGradingScheme({
    country: gradingCountry,
    academicLevel,
    gradeLevel: student.grade_level,
  });
  const subjectResults = buildSubjectResults(student, term, resolvedYear, gradingScheme);
  const averageScore =
    subjectResults.reduce((total, result) => total + result.score, 0) / Math.max(subjectResults.length, 1);
  const generalComment = buildGeneralComment(student, averageScore);
  const overallGrade = gradeScore(Math.round(averageScore), gradingScheme).grade;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;

  const drawText = (text, options = {}) => {
    page.drawText(text, {
      x: options.x ?? 50,
      y: options.y ?? y,
      size: options.size ?? 11,
      font: options.bold ? boldFont : regularFont,
      color: options.color ?? rgb(0.16, 0.16, 0.2),
    });
  };

  page.drawRectangle({
    x: 35,
    y: 35,
    width: 525,
    height: 770,
    borderColor: rgb(0.82, 0.84, 0.88),
    borderWidth: 1,
  });

  drawText(SCHOOL_NAME, { x: 50, y, size: 22, bold: true, color: rgb(0.16, 0.27, 0.58) });
  y -= 22;
  drawText(SCHOOL_TAGLINE, { x: 50, y, size: 10, color: rgb(0.35, 0.39, 0.45) });
  y -= 26;
  drawText('Student Report Card', { x: 50, y, size: 18, bold: true });
  drawText(`${term}  •  Academic Year ${resolvedYear}`, { x: 360, y, size: 10, color: rgb(0.35, 0.39, 0.45) });

  y -= 24;
  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.91),
  });

  y -= 26;
  drawText(`Student: ${student.first_name} ${student.last_name}`, { x: 50, y, size: 12, bold: true });
  drawText(`Student ID: ${student.student_id}`, { x: 315, y, size: 11 });
  y -= 20;
  drawText(`Grade / Section: ${student.grade_level}-${student.class_section}`, { x: 50, y });
  drawText(`Status: ${student.status}`, { x: 315, y });
  y -= 18;
  drawText(`Attendance: ${Number(student.attendance_rate).toFixed(1)}%`, { x: 50, y });
  drawText(`GPA: ${Number(student.gpa).toFixed(2)}`, { x: 315, y });
  y -= 18;
  drawText(`Parent / Guardian: ${student.parent_name || 'Not provided'}`, { x: 50, y });
  y -= 18;
  drawText(`Grading Scheme: ${gradingScheme.label}`, { x: 50, y, size: 9, color: rgb(0.35, 0.39, 0.45) });

  y -= 28;
  page.drawRectangle({
    x: 50,
    y: y - 20,
    width: 495,
    height: 24,
    color: rgb(0.94, 0.96, 1),
  });
  drawText('Subject', { x: 60, y: y - 12, size: 10, bold: true });
  drawText('Score', { x: 315, y: y - 12, size: 10, bold: true });
  drawText('Grade', { x: 390, y: y - 12, size: 10, bold: true });
  drawText('Remark', { x: 455, y: y - 12, size: 10, bold: true });

  y -= 36;

  for (const result of subjectResults) {
    page.drawLine({
      start: { x: 50, y: y - 6 },
      end: { x: 545, y: y - 6 },
      thickness: 0.5,
      color: rgb(0.9, 0.92, 0.95),
    });
    drawText(result.subject, { x: 60, y, size: 10 });
    drawText(String(result.score), { x: 320, y, size: 10 });
    drawText(result.grade, { x: 395, y, size: 10, bold: true });
    drawText(result.remark, { x: 455, y, size: 10 });
    y -= 24;
  }

  y -= 8;
  drawText(`Average Score: ${averageScore.toFixed(1)}`, { x: 50, y, size: 11, bold: true });
  drawText(`Overall Grade: ${overallGrade}`, { x: 315, y, size: 11, bold: true });

  y -= 34;
  drawText('Teacher Comment', { x: 50, y, size: 12, bold: true });
  y -= 18;
  drawText(generalComment, { x: 50, y, size: 10 });

  y -= 38;
  drawText('Notes', { x: 50, y, size: 12, bold: true });
  y -= 18;
  drawText(student.notes || 'No additional notes recorded for this student.', { x: 50, y, size: 10 });

  y -= 60;
  page.drawLine({
    start: { x: 60, y },
    end: { x: 220, y },
    thickness: 1,
    color: rgb(0.5, 0.53, 0.58),
  });
  page.drawLine({
    start: { x: 320, y },
    end: { x: 480, y },
    thickness: 1,
    color: rgb(0.5, 0.53, 0.58),
  });
  drawText('Class Teacher', { x: 100, y: y - 16, size: 10, color: rgb(0.35, 0.39, 0.45) });
  drawText('Head of School', { x: 360, y: y - 16, size: 10, color: rgb(0.35, 0.39, 0.45) });

  return pdfDoc.save();
};
