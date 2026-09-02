/**
 * Turning a mark sheet into rows a teacher can check.
 *
 * Three ways in — a spreadsheet, a document, or a photograph — and one way out: a list of
 * `{ name, score, confidence }` proposals. Nothing here writes a mark. The caller matches the names
 * against a real class and the teacher confirms before anything reaches the gradebook, because a
 * misread digit is a wrong academic record that nobody goes back and checks.
 *
 * Parsing and reading are deliberately separate. A spreadsheet has columns and needs no model at
 * all; a photograph has no structure and needs nothing but. Sending a tidy xlsx to a model would be
 * slower, cost money and be less accurate than reading the cells, so it does not.
 *
 * The model is never asked to identify a student. It reads what is written; matching that to a
 * person is done against the class roster by the caller, where a wrong guess can be shown to
 * somebody rather than silently stored.
 */

const MAX_ROWS = 400;

/** Cell text, whatever exceljs decided the cell was. */
const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    // Formulas carry their computed result; rich text arrives as runs.
    if ('result' in value) return String(value.result ?? '').trim();
    if ('richText' in value) return (value.richText || []).map((run) => run.text).join('').trim();
    if ('text' in value) return String(value.text ?? '').trim();
    return '';
  }
  return String(value).trim();
};

/**
 * A score, or null.
 *
 * Accepts `72`, `72.5`, `72/100` and `72%`, because all four turn up on real sheets. Anything else
 * — "abs", "-", a comment — is not a number and must not be invented into one; the row comes back
 * without a score and the teacher fills it in.
 */
export const parseScore = (text) => {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (fraction) {
    const over = Number(fraction[2]);
    if (!over) return null;
    return { score: Number(fraction[1]), maxScore: over };
  }

  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
  if (percent) return { score: Number(percent[1]), maxScore: 100 };

  const plain = /^(\d+(?:\.\d+)?)$/.exec(raw);
  if (plain) return { score: Number(plain[1]), maxScore: null };

  return null;
};

/* The words a mark sheet uses for its own furniture rather than for a person. */
const HEADING_WORDS = new Set([
  'name', 'names', 'student', 'students', 'pupil', 'pupils', 'candidate', 'candidates',
  'no', 'no.', 'sn', 's/n', 'num', 'number', 'index', 'roll',
  'total', 'totals', 'average', 'averages', 'mean', 'sum', 'overall', 'aggregate',
  'subject', 'subjects', 'class', 'stream', 'section', 'grade', 'term', 'year',
  'mark', 'marks', 'score', 'scores', 'result', 'results', 'comment', 'comments', 'remark', 'remarks',
  'full', 'first', 'last', 'surname', 'other',
]);

/**
 * Does this look like a person's name rather than a heading or a summary line?
 *
 * A value made entirely of the words above is furniture: "Student Name", "Total Marks", "S/N".
 * A real name contains at least one word that is not — which is why this tests every token rather
 * than the whole string, since "Student Name" is not equal to "name" and used to sail through as a
 * pupil called Student Name.
 */
const looksLikeName = (text) => {
  const value = String(text || '').trim();
  if (value.length < 3 || value.length > 80) return false;
  if (!/[A-Za-z]{2,}/.test(value)) return false;

  const words = value.toLowerCase().split(/[\s./_-]+/).filter(Boolean);
  return words.some((word) => !HEADING_WORDS.has(word));
};

/**
 * Rows out of a grid.
 *
 * Works by finding, per row, the leftmost cell that reads as a name and the first cell after it
 * that reads as a score. That handles a numbered first column, a blank spacer, and a sheet with
 * several mark columns where the first is the one wanted — without asking anybody to describe
 * their layout first.
 */
/**
 * A row of column titles rather than a person.
 *
 * Judged over the whole row, because judging cells alone is not enough: in
 * `S/N | Student Name | Biology | Comment` the subject is not heading vocabulary and reads as a
 * perfectly good name, so the header row arrived as a pupil called Biology. A row that names no
 * score and uses the sheet's own vocabulary is describing the sheet.
 */
const looksLikeHeadingRow = (cells) =>
  !cells.some((cell) => parseScore(cell))
  && cells.some((cell) => {
    const words = String(cell || '').toLowerCase().split(/[\s./_-]+/).filter(Boolean);
    return words.length > 0 && words.every((word) => HEADING_WORDS.has(word));
  });

export const rowsFromGrid = (grid) => {
  const rows = [];

  for (const cells of grid) {
    if (rows.length >= MAX_ROWS) break;
    if (looksLikeHeadingRow(cells)) continue;

    const nameIndex = cells.findIndex(looksLikeName);
    if (nameIndex === -1) continue;

    let parsed = null;
    for (let i = nameIndex + 1; i < cells.length; i += 1) {
      parsed = parseScore(cells[i]);
      if (parsed) break;
    }

    rows.push({
      name: String(cells[nameIndex]).trim(),
      score: parsed ? parsed.score : null,
      maxScore: parsed ? parsed.maxScore : null,
      // A cell either held a number or it did not; there is nothing uncertain about reading one.
      confidence: parsed ? 'high' : 'none',
    });
  }

  return rows;
};

/** Every sheet in a workbook, as a grid of text. */
export const gridFromWorkbook = async (buffer) => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const grid = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const cells = [];
      // `values` is 1-based with a hole at 0, which is why this is not a plain map.
      const values = Array.isArray(row.values) ? row.values : [];
      for (let i = 1; i < values.length; i += 1) cells.push(cellText(values[i]));
      if (cells.some(Boolean)) grid.push(cells);
    });
  });
  return grid;
};

/** A delimited file. Handles quoted fields, because a name with a comma in it is normal. */
export const gridFromDelimited = (text) => {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  const delimiter = (lines[0] || '').includes('\t') ? '\t' : ',';

  return lines.map((line) => {
    const cells = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (quoted && line[i + 1] === '"') { current += '"'; i += 1; continue; }
        quoted = !quoted;
        continue;
      }
      if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; continue; }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  });
};

/**
 * Lines out of a Word file or a PDF, as a grid split on runs of whitespace.
 *
 * A mark sheet pasted into either is laid out with tabs or spaces rather than cells, so the
 * columns have to be recovered from the gaps. Two or more spaces is the separator: one space is
 * inside a name.
 */
export const gridFromText = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/\t|\s{2,}/).map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length > 0);

export const textFromDocx = async (buffer) => {
  const mammoth = await import('mammoth');
  const { value } = await (mammoth.default || mammoth).extractRawText({ buffer });
  return value || '';
};

export const textFromPdf = async (buffer) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Server-side: no worker, no fonts to render, nothing to fetch.
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    /* Rebuilt line by line off each item's y position: getTextContent returns pieces in reading
       order but with no line breaks, so a whole page would otherwise arrive as one line and every
       row would be lost. */
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      lines.set(y, [...(lines.get(y) || []), item.str]);
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    pages.push(ordered.map(([, parts]) => parts.join(' ')).join('\n'));
  }
  return pages.join('\n');
};

const MEDIA = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** What kind of file this is, from its name and what the client claimed. */
export const kindOf = ({ filename = '', mimeType = '' }) => {
  const name = String(filename).toLowerCase();
  const mime = String(mimeType).toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || mime === MEDIA.xlsx) return 'workbook';
  if (name.endsWith('.csv') || name.endsWith('.tsv') || mime.startsWith('text/csv')) return 'delimited';
  if (name.endsWith('.docx') || mime === MEDIA.docx) return 'document';
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/.test(name)) return 'image';
  if (name.endsWith('.txt') || mime.startsWith('text/')) return 'delimited';
  return 'unknown';
};

/**
 * Reads a file into proposed rows, using a model only where the file has no structure to read.
 *
 * `askModel` is injected rather than imported so the tests drive the parsing paths without a
 * provider configured, and the vision path without a network — the same seam the broker and the
 * backup service use.
 */
export const extractMarks = async ({ filename, mimeType, base64, askModel }) => {
  const kind = kindOf({ filename, mimeType });
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) return { error: 'That file arrived empty' };

  if (kind === 'image') {
    if (!askModel) return { error: 'Reading a photograph needs a vision-capable model, and none is configured' };
    try {
      const rows = await askModel({ mediaType: mimeType || 'image/jpeg', data: buffer.toString('base64') });
      return { kind, rows: rows.slice(0, MAX_ROWS), read_by: 'model' };
    } catch (error) {
      /* No model configured, no vision on the one chosen, or an unreadable reply. All of them are
         answers to give the teacher, not crashes: the photograph simply could not be read, and the
         marks can still be typed. */
      return { error: error instanceof Error ? error.message : 'That photograph could not be read' };
    }
  }

  try {
    if (kind === 'workbook') return { kind, rows: rowsFromGrid(await gridFromWorkbook(buffer)), read_by: 'cells' };
    if (kind === 'delimited') return { kind, rows: rowsFromGrid(gridFromDelimited(buffer.toString('utf8'))), read_by: 'cells' };
    if (kind === 'document') return { kind, rows: rowsFromGrid(gridFromText(await textFromDocx(buffer))), read_by: 'text' };

    if (kind === 'pdf') {
      const text = await textFromPdf(buffer);
      const rows = rowsFromGrid(gridFromText(text));
      /* A scanned PDF has pages but no text, so it is a photograph in a wrapper. Saying so is more
         use than returning nothing: the teacher can photograph the sheet instead. */
      if (rows.length === 0) {
        return {
          kind,
          rows: [],
          read_by: 'text',
          note: 'No text could be read from this PDF. If it is a scan, photograph the sheet instead.',
        };
      }
      return { kind, rows, read_by: 'text' };
    }
  } catch (error) {
    return { error: `That file could not be read: ${error instanceof Error ? error.message : error}` };
  }

  return { error: 'That file type cannot be read. Use a spreadsheet, a Word file, a PDF or a photograph.' };
};

/* ── matching a written name to a student on the register ───────────────────────────────
 *
 * Done here, against the class the teacher chose, and never by the model. A model asked to return
 * a student id will invent a plausible one, and an invented id is a mark written onto the wrong
 * child's record with nothing to show it happened. So the model reads handwriting and this decides
 * who that is — and when it cannot decide, it says so and the teacher does.
 */

/** Comparable form of a name: case, punctuation and word order all discarded. */
export const normaliseName = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

/** Edit distance, capped — only used to separate a typo from a different person. */
const distance = (a, b) => {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
};

/**
 * Which student a written name refers to.
 *
 * Exact on the normalised form first, so "Nakato Aisha" and "Aisha Nakato" are the same person.
 * Then every surname-and-forename overlap, then near-misses by edit distance — but only when
 * exactly one candidate is close. Two students within a letter of the same name is precisely when
 * a computer should stop guessing, so it returns nothing and the row is shown as unmatched.
 */
export const matchStudent = (written, roster) => {
  const target = normaliseName(written);
  if (!target) return { student: null, reason: 'no name' };

  const exact = roster.filter((student) => normaliseName(student.full_name) === target);
  if (exact.length === 1) return { student: exact[0], reason: 'exact' };
  if (exact.length > 1) return { student: null, reason: 'more than one student has that name' };

  const targetWords = new Set(target.split(' '));
  const overlapping = roster
    .map((student) => {
      const words = normaliseName(student.full_name).split(' ');
      const shared = words.filter((word) => targetWords.has(word)).length;
      return { student, shared };
    })
    .filter((entry) => entry.shared >= 2);
  if (overlapping.length === 1) return { student: overlapping[0].student, reason: 'names match' };
  if (overlapping.length > 1) return { student: null, reason: 'several students share these names' };

  /* A single letter out per five is a plausible slip of a pen or a reading; beyond that it is
     somebody else's name. */
  const near = roster
    .map((student) => ({ student, gap: distance(target, normaliseName(student.full_name)) }))
    .filter((entry) => entry.gap > 0 && entry.gap <= Math.max(1, Math.floor(target.length / 5)))
    .sort((a, b) => a.gap - b.gap);

  if (near.length === 1) return { student: near[0].student, reason: 'close spelling' };
  /* More than one plausible spelling is refused outright, even when one is strictly closer. A
     register holding both Okello and Okelo makes "Okelllo" genuinely ambiguous, and picking the
     nearer by a single letter writes a mark onto a coin toss. The teacher can see both names. */
  if (near.length > 1) return { student: null, reason: 'more than one student is spelled like that' };

  return { student: null, reason: 'nobody on this register matches' };
};

/**
 * The proposal a teacher is shown: every read row, matched where it can be, flagged where it cannot.
 *
 * Students on the register that the sheet never mentioned are returned too, blank — a mark sheet
 * that quietly omits four children is the failure this catches.
 */
export const proposeMarks = ({ rows, roster }) => {
  const taken = new Set();
  const proposed = rows.map((row) => {
    const { student, reason } = matchStudent(row.name, roster);

    // One student cannot receive two marks from one sheet; the second is shown for a decision.
    const duplicate = student && taken.has(student.id);
    if (student && !duplicate) taken.add(student.id);

    return {
      read_name: row.name,
      student_id: duplicate ? null : (student ? student.id : null),
      student_number: duplicate ? null : (student ? student.student_id : null),
      matched_name: duplicate ? null : (student ? student.full_name : null),
      score: row.score,
      max_score: row.maxScore,
      confidence: row.confidence || 'high',
      match: duplicate ? 'duplicate' : (student ? reason : 'unmatched'),
      needs_review: Boolean(duplicate || !student || row.score === null || row.confidence === 'low'),
    };
  });

  const seen = new Set(proposed.map((row) => row.student_id).filter(Boolean));
  const missing = roster
    .filter((student) => !seen.has(student.id))
    .map((student) => ({
      read_name: '',
      student_id: student.id,
      student_number: student.student_id,
      matched_name: student.full_name,
      score: null,
      max_score: null,
      confidence: 'none',
      match: 'not on the sheet',
      needs_review: true,
    }));

  return { rows: [...proposed, ...missing] };
};
