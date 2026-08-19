import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { gradeScore, resolveGradingScheme } from './grading-config.mjs';

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'eSchool';
const SCHOOL_TAGLINE = process.env.SCHOOL_TAGLINE || 'Academic Excellence and Character';
const SCHOOL_ADDRESS = process.env.SCHOOL_ADDRESS || '';

const DEFAULT_THEME = rgb(0.16, 0.27, 0.58);
const INK = rgb(0.16, 0.16, 0.2);
const MUTED = rgb(0.35, 0.39, 0.45);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Mixes a colour toward white by `amount` (0 = unchanged, 1 = white), for tinted backgrounds.
const tint = (color, amount) =>
  rgb(
    color.red + (1 - color.red) * amount,
    color.green + (1 - color.green) * amount,
    color.blue + (1 - color.blue) * amount,
  );

// Accepts '#RRGGBB' or '#RGB' (with or without the hash); falls back to the house colour when the
// value is missing or malformed, so a bad theme input never breaks the download.
const parseHexColor = (value, fallback = DEFAULT_THEME) => {
  const hex = String(value || '').trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
};

// Embeds a base64 data URL (PNG or JPEG). Returns null for anything missing or undecodable, so an
// unreadable upload is simply skipped rather than aborting the whole report card.
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

// Scales an embedded image to fit a box while preserving aspect ratio, returning the draw rect.
const fitInside = (image, boxX, boxY, boxWidth, boxHeight) => {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    width,
    height,
    x: boxX + (boxWidth - width) / 2,
    y: boxY + (boxHeight - height) / 2,
  };
};

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
const valueOrDefault = (value, fallback) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const wrapText = (text, maxCharacters = 92) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > maxCharacters && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
};

export const buildReportCardPdf = async ({
  student,
  term = 'Term 1',
  academicYear,
  gradingCountry,
  academicLevel,
  reportTitle,
  schoolName,
  schoolTagline,
  schoolAddress,
  themeColor,
  schoolLogo,
  studentPhoto,
  teacherName,
  headTeacherName,
  teacherComment,
  reportNotes,
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
  const generalComment = valueOrDefault(teacherComment, buildGeneralComment(student, averageScore));
  const overallGrade = gradeScore(Math.round(averageScore), gradingScheme).grade;
  const resolvedSchoolName = valueOrDefault(schoolName, SCHOOL_NAME);
  const resolvedSchoolTagline = valueOrDefault(schoolTagline, SCHOOL_TAGLINE);
  const resolvedSchoolAddress = valueOrDefault(schoolAddress, SCHOOL_ADDRESS);
  const resolvedReportTitle = valueOrDefault(reportTitle, 'Student Report Card');
  const resolvedReportNotes = valueOrDefault(reportNotes, student.notes || 'No additional notes recorded for this student.');
  const resolvedTeacherName = valueOrDefault(teacherName, 'Class Teacher');
  const resolvedHeadTeacherName = valueOrDefault(headTeacherName, 'Head of School');

  const theme = parseHexColor(themeColor);
  const themeSoft = tint(theme, 0.9);
  const themeBorder = tint(theme, 0.55);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logoImage = await embedImageFromDataUrl(pdfDoc, schoolLogo);
  const photoImage = await embedImageFromDataUrl(pdfDoc, studentPhoto);

  let y = 800;

  const drawText = (text, options = {}) => {
    page.drawText(text, {
      x: options.x ?? 50,
      y: options.y ?? y,
      size: options.size ?? 11,
      font: options.bold ? boldFont : regularFont,
      color: options.color ?? INK,
    });
  };

  // Trims text with an ellipsis so it never runs past `maxWidth` — used to keep the school name
  // from colliding with the photo frame on the right.
  const fitText = (text, font, size, maxWidth) => {
    let value = String(text ?? '');
    if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
    while (value.length > 1 && font.widthOfTextAtSize(`${value}…`, size) > maxWidth) {
      value = value.slice(0, -1);
    }
    return `${value}…`;
  };

  // Border box: x 35–560, y 35–805. Every header element is kept inside these bounds.
  page.drawRectangle({ x: 35, y: 35, width: 525, height: 770, borderColor: themeBorder, borderWidth: 1 });

  // Passport photo, top-right, fully inside the border. Drawn first so the name can measure
  // against its left edge.
  const PHOTO = { x: 486, y: 716, w: 64, h: 78 };
  if (photoImage) {
    page.drawRectangle({ x: PHOTO.x, y: PHOTO.y, width: PHOTO.w, height: PHOTO.h, borderColor: themeBorder, borderWidth: 1, color: rgb(1, 1, 1) });
    page.drawImage(photoImage, fitInside(photoImage, PHOTO.x + 2, PHOTO.y + 2, PHOTO.w - 4, PHOTO.h - 4));
  }

  // Optional school logo, top-left; the header text shifts right to clear it.
  if (logoImage) {
    page.drawImage(logoImage, fitInside(logoImage, 48, 750, 42, 42));
  }
  const textX = logoImage ? 100 : 48;
  // School name may run up to the photo frame (or the right margin when there is no photo).
  const nameMaxWidth = (photoImage ? PHOTO.x - 12 : 545) - textX;

  y = 788;
  drawText(fitText(resolvedSchoolName, boldFont, 17, nameMaxWidth), { x: textX, y, size: 17, bold: true, color: theme });
  y -= 16;
  drawText(fitText(resolvedSchoolTagline, regularFont, 9.5, nameMaxWidth), { x: textX, y, size: 9.5, color: MUTED });
  if (resolvedSchoolAddress) {
    for (const line of wrapText(resolvedSchoolAddress, 60).slice(0, 2)) {
      y -= 12;
      drawText(fitText(line, regularFont, 8.5, nameMaxWidth), { x: textX, y, size: 8.5, color: MUTED });
    }
  }

  // Title sits below the header block but above the photo's lower edge on the left column.
  y = 726;
  drawText(resolvedReportTitle, { x: 48, y, size: 16, bold: true, color: theme });
  drawText(`${term}  •  Academic Year ${resolvedYear}`, { x: 48, y: y - 14, size: 9.5, color: MUTED });

  y = 700;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: themeBorder });

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
  drawText(`Grading Scheme: ${gradingScheme.label}`, { x: 50, y, size: 9, color: MUTED });

  y -= 28;
  page.drawRectangle({ x: 50, y: y - 20, width: 495, height: 24, color: themeSoft });
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
  drawText(`Overall Grade: ${overallGrade}`, { x: 315, y, size: 11, bold: true, color: theme });

  y -= 34;
  drawText('Teacher Comment', { x: 50, y, size: 12, bold: true, color: theme });
  y -= 18;
  for (const line of wrapText(generalComment)) {
    drawText(line, { x: 50, y, size: 10 });
    y -= 14;
  }

  y -= 20;
  drawText('Notes', { x: 50, y, size: 12, bold: true, color: theme });
  y -= 18;
  for (const line of wrapText(resolvedReportNotes)) {
    drawText(line, { x: 50, y, size: 10 });
    y -= 14;
  }

  y -= 42;
  page.drawLine({ start: { x: 60, y }, end: { x: 220, y }, thickness: 1, color: rgb(0.5, 0.53, 0.58) });
  page.drawLine({ start: { x: 320, y }, end: { x: 480, y }, thickness: 1, color: rgb(0.5, 0.53, 0.58) });
  drawText(resolvedTeacherName, { x: 88, y: y - 16, size: 10, color: MUTED });
  drawText(resolvedHeadTeacherName, { x: 345, y: y - 16, size: 10, color: MUTED });

  return pdfDoc.save();
};
