import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'eSchool';

// Standard CR80 plastic card: 85.6mm x 54mm, in PDF points.
const MM = 2.834645669;
const CARD_WIDTH = 85.6 * MM;
const CARD_HEIGHT = 54 * MM;

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const A4_COLUMNS = 2;
const A4_ROWS = 5;

/**
 * What the QR encodes. A bare student number is the smallest, most robust payload and leaks
 * nothing if a card is lost, but a phone's built-in camera app can only display it as text.
 * Set ID_CARD_QR_BASE_URL to encode a URL instead, which phone cameras offer to open.
 * Either form is accepted by the in-app scanner.
 */
export const buildQrPayload = (student, baseUrl = process.env.ID_CARD_QR_BASE_URL) => {
  const code = String(student.student_id || '').trim();
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  return base ? `${base}/${encodeURIComponent(code)}` : code;
};

/**
 * Error correction Q survives the scuffing a pocket-carried plastic card picks up, and the
 * quiet-zone margin is what lets a phone camera lock on. Both matter more than pixel size here,
 * since the PNG is rescaled into the PDF anyway.
 */
export const buildQrPng = (payload) =>
  QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'Q',
    margin: 2,
    scale: 10,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });

const truncate = (text, maxCharacters) => {
  const value = String(text ?? '');
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters - 1)}…` : value;
};

const DEFAULT_THEME = rgb(0.16, 0.27, 0.58);

// Accepts '#RGB' / '#RRGGBB'; falls back to the house colour so a bad theme value never fails a print run.
const parseHexColor = (value, fallback = DEFAULT_THEME) => {
  const hex = String(value || '').trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return rgb(parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255);
};

// A corrupt photo/logo upload is skipped, never fatal.
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

const fitInside = (image, boxX, boxY, boxWidth, boxHeight) => {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, x: boxX + (boxWidth - width) / 2, y: boxY + (boxHeight - height) / 2 };
};

const drawCard = ({ page, x, y, student, qrImage, photoImage, logoImage, fonts, schoolName, theme }) => {
  const { regular, bold } = fonts;

  page.drawRectangle({
    x,
    y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.82, 0.84, 0.88),
    borderWidth: 1,
  });

  // Themed masthead band with an optional logo and the school name.
  page.drawRectangle({ x, y: y + CARD_HEIGHT - 20, width: CARD_WIDTH, height: 20, color: theme });
  let nameX = x + 10;
  if (logoImage) {
    page.drawImage(logoImage, fitInside(logoImage, x + 5, y + CARD_HEIGHT - 18, 16, 16));
    nameX = x + 25;
  }
  page.drawText(truncate(schoolName, logoImage ? 30 : 34), {
    x: nameX,
    y: y + CARD_HEIGHT - 14,
    size: 9,
    font: bold,
    color: rgb(1, 1, 1),
  });

  // Passport photo, top-left under the band. A missing photo leaves a neutral placeholder box.
  const photoW = 44;
  const photoH = 54;
  const photoX = x + 10;
  const photoY = y + CARD_HEIGHT - 22 - photoH;
  page.drawRectangle({
    x: photoX,
    y: photoY,
    width: photoW,
    height: photoH,
    color: rgb(0.95, 0.96, 0.98),
    borderColor: rgb(0.82, 0.84, 0.88),
    borderWidth: 0.75,
  });
  if (photoImage) {
    page.drawImage(photoImage, fitInside(photoImage, photoX + 1.5, photoY + 1.5, photoW - 3, photoH - 3));
  } else {
    page.drawText('PHOTO', { x: photoX + 9, y: photoY + photoH / 2 - 3, size: 6, font: regular, color: rgb(0.6, 0.63, 0.69) });
  }

  // Identity text to the right of the photo.
  const textX = photoX + photoW + 8;
  let textY = y + CARD_HEIGHT - 34;
  page.drawText('STUDENT', { x: textX, y: textY, size: 6, font: bold, color: rgb(0.45, 0.49, 0.56) });
  textY -= 14;
  page.drawText(truncate(`${student.first_name} ${student.last_name}`, 16), {
    x: textX,
    y: textY,
    size: 11,
    font: bold,
    color: rgb(0.12, 0.14, 0.2),
  });
  textY -= 15;
  page.drawText(truncate(student.student_id, 18), { x: textX, y: textY, size: 9, font: regular, color: rgb(0.22, 0.25, 0.32) });
  textY -= 13;
  page.drawText(`Grade ${student.grade_level} ${student.class_section || ''}`.trim(), {
    x: textX,
    y: textY,
    size: 8.5,
    font: regular,
    color: rgb(0.45, 0.49, 0.56),
  });

  // QR bottom-right with a white quiet-zone backing.
  const qrSize = 58;
  const qrX = x + CARD_WIDTH - qrSize - 10;
  const qrY = y + 10;
  page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: rgb(1, 1, 1) });
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  page.drawText('Scan for fees status', { x: qrX - 2, y: y + 3, size: 5.5, font: regular, color: rgb(0.55, 0.58, 0.64) });
};

/**
 * layout 'card' gives one CR80 page per student for a card printer.
 * layout 'a4' tiles ten cards per A4 sheet for printing and cutting.
 */
export const buildIdCardPdf = async ({ students, layout = 'card', schoolName, qrBaseUrl, themeColor, logo }) => {
  const roster = Array.isArray(students) ? students : [students];
  if (roster.length === 0) {
    throw new Error('No students supplied for ID card generation');
  }

  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const resolvedSchoolName = schoolName || SCHOOL_NAME;
  const theme = parseHexColor(themeColor);
  const logoImage = await embedImageFromDataUrl(pdfDoc, logo);

  const qrImages = await Promise.all(
    roster.map(async (student) => pdfDoc.embedPng(await buildQrPng(buildQrPayload(student, qrBaseUrl)))),
  );
  const photoImages = await Promise.all(roster.map((student) => embedImageFromDataUrl(pdfDoc, student.photo_url)));

  if (layout === 'a4') {
    const perSheet = A4_COLUMNS * A4_ROWS;
    const marginX = (A4_WIDTH - A4_COLUMNS * CARD_WIDTH) / (A4_COLUMNS + 1);
    const marginY = (A4_HEIGHT - A4_ROWS * CARD_HEIGHT) / (A4_ROWS + 1);

    for (let index = 0; index < roster.length; index += 1) {
      const slot = index % perSheet;
      const page = slot === 0 ? pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]) : pdfDoc.getPage(pdfDoc.getPageCount() - 1);
      const column = slot % A4_COLUMNS;
      const row = Math.floor(slot / A4_COLUMNS);

      drawCard({
        page,
        x: marginX + column * (CARD_WIDTH + marginX),
        y: A4_HEIGHT - (row + 1) * (CARD_HEIGHT + marginY),
        student: roster[index],
        qrImage: qrImages[index],
        photoImage: photoImages[index],
        logoImage,
        fonts,
        schoolName: resolvedSchoolName,
        theme,
      });
    }
  } else {
    for (let index = 0; index < roster.length; index += 1) {
      const page = pdfDoc.addPage([CARD_WIDTH, CARD_HEIGHT]);
      drawCard({
        page,
        x: 0,
        y: 0,
        student: roster[index],
        qrImage: qrImages[index],
        photoImage: photoImages[index],
        logoImage,
        fonts,
        schoolName: resolvedSchoolName,
        theme,
      });
    }
  }

  return pdfDoc.save();
};
