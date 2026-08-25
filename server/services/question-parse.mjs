/**
 * Reading questions out of whatever a model produced, and writing them back as editable Markdown.
 *
 * Both directions live here so they cannot drift: the Markdown the teacher edits is generated from
 * the same field set that parsing puts back, and the round trip is what makes "edit the text, save
 * to the bank" safe.
 *
 * The guiding rule for parsing is **recognise a question by its shape, not by its wrapper**. Models
 * nest the payload differently every time — under `arguments`, under `questions`, as a bare array,
 * as a single object, and often labelled with the topic rather than the tool name. Matching on the
 * wrapper is what caused a perfectly good question to be reported as "nothing readable".
 */

const trimmed = (value) => String(value ?? '').trim();

const asNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// The names models actually use for the question text. `description` is included because that is
// where a model that has forgotten the field name most often puts it.
const STEM_KEYS = ['stem', 'question', 'text', 'prompt', 'description'];

/**
 * Does this object look like a question?
 *
 * A stem under any of its usual names settles it. Failing that, the other marks of a question are
 * counted: a mark scheme beside a set of options, or a difficulty beside a command word, is a
 * question whatever it forgot to call its text. Two such signals are enough — one alone matches
 * things that are not questions, such as a single `{ marks, point }` row of a mark scheme.
 */
const looksLikeQuestion = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  if (STEM_KEYS.some((key) => trimmed(value[key]))) return true;

  const signals = [
    trimmed(value.questionType ?? value.question_type ?? value.type),
    trimmed(value.correctAnswer ?? value.correct_answer ?? value.answer),
    Array.isArray(value.options) && value.options.length > 0 ? 'options' : '',
    Array.isArray(value.markingScheme ?? value.marking_scheme ?? value.scheme ?? value.rubric)
      ? 'scheme'
      : '',
    trimmed(value.difficulty),
    trimmed(value.bloomLevel ?? value.bloom_level),
    trimmed(value.commandWord ?? value.command_word),
    trimmed(value.assessmentObjective ?? value.assessment_objective),
  ].filter(Boolean);

  return signals.length >= 2;
};

const QUESTION_TYPES = ['mcq', 'short_answer', 'structured', 'essay', 'practical', 'data_response', 'project'];

const normaliseType = (value, optionCount) => {
  const type = trimmed(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (QUESTION_TYPES.includes(type)) return type;
  if (type === 'multiple_choice' || type === 'multiple_choice_question') return 'mcq';
  // An unlabelled question with choices is a multiple-choice question whatever it called itself.
  return optionCount >= 2 ? 'mcq' : 'short_answer';
};

/** Normalises one question object onto the field names the rest of the app uses. */
const normaliseQuestion = (raw) => {
  const options = Array.isArray(raw.options)
    ? raw.options.map((option) => (typeof option === 'string' ? option : trimmed(option?.text ?? option?.label))).filter(Boolean)
    : [];

  const schemeSource = raw.markingScheme ?? raw.marking_scheme ?? raw.scheme ?? raw.rubric;
  const markingScheme = Array.isArray(schemeSource)
    ? schemeSource
        .map((entry) => {
          if (typeof entry === 'string') return { point: trimmed(entry), marks: 1 };
          return {
            point: trimmed(entry?.point ?? entry?.description ?? entry?.criterion),
            marks: asNumber(entry?.marks ?? entry?.mark, 1),
          };
        })
        .filter((entry) => entry.point)
    : [];

  // Fall back to the mark scheme's total when the model gave no explicit mark allocation.
  const schemeTotal = markingScheme.reduce((total, entry) => total + entry.marks, 0);

  return {
    id: trimmed(raw.id) || undefined,
    // Last resort, when the model labelled nothing as the question text: the first mark-scheme point
    // is usually the instruction restated ("Describe the key components of…"). Its own words, and a
    // stem the teacher can edit, rather than a question dropped for want of a field name.
    stem: STEM_KEYS.map((key) => trimmed(raw[key])).find(Boolean) || trimmed(markingScheme[0]?.point),
    topic: trimmed(raw.topic),
    subtopic: trimmed(raw.subtopic),
    questionType: normaliseType(raw.questionType ?? raw.question_type ?? raw.type, options.length),
    difficulty: trimmed(raw.difficulty).toLowerCase() || 'moderate',
    bloomLevel: trimmed(raw.bloomLevel ?? raw.bloom ?? raw.bloom_level).toLowerCase(),
    commandWord: trimmed(raw.commandWord ?? raw.command_word),
    options,
    correctAnswer: trimmed(raw.correctAnswer ?? raw.answer ?? raw.correct_answer),
    markingScheme,
    marks: asNumber(raw.marks ?? raw.mark ?? raw.totalMarks, null) ?? (schemeTotal || 1),
    expectedTimeMinutes: asNumber(raw.expectedTimeMinutes ?? raw.expected_time_minutes, 2),
    assessmentObjective: trimmed(raw.assessmentObjective ?? raw.assessment_objective ?? raw.ao),
    reviewNotes: trimmed(raw.reviewNotes ?? raw.review_notes ?? raw.note),
    citationIndexes: Array.isArray(raw.citationIndexes) ? raw.citationIndexes : [],
  };
};

// A payload nested more deeply than this is not a question list, and walking on risks pulling in
// unrelated objects that happen to have a `text` field.
const MAX_DEPTH = 6;

/**
 * Collects every question-shaped object anywhere in a parsed JSON value.
 *
 * Handles, without needing to know which it is: a bare array, `{questions: [...]}`,
 * `{name: "<anything>", arguments: {...}}`, `{arguments: {questions: [...]}}`, and a single bare
 * question object.
 */
// Where a model puts a tool call's payload.
const WRAPPER_KEYS = ['arguments', 'input', 'parameters', 'params', 'function'];

export const extractQuestions = (value, depth = 0, inherited = {}) => {
  if (!value || depth > MAX_DEPTH) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractQuestions(entry, depth + 1, inherited));
  }

  if (typeof value !== 'object') return [];

  // Scalars sitting beside a payload belong to it: a wrapper that carries the question text in
  // `description` while the fields live under `arguments` is a shape real models produce, and
  // reading the two halves separately loses the stem.
  const scalars = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry == null || typeof entry !== 'object'),
  );
  const carried = { ...inherited, ...scalars };

  // Descend through a tool-call wrapper before considering the wrapper itself, so the object with
  // the options and the mark scheme wins over the envelope around it.
  const wrapped = WRAPPER_KEYS.map((key) => value[key]).filter((entry) => entry && typeof entry === 'object');
  if (wrapped.length > 0) {
    return wrapped.flatMap((entry) => extractQuestions(entry, depth + 1, carried));
  }

  // Checked before recursing: a question can itself hold arrays (options, markingScheme) whose
  // entries must not be mistaken for questions in their own right.
  const merged = { ...inherited, ...value };
  if (looksLikeQuestion(merged)) return [normaliseQuestion(merged)];

  return Object.values(value).flatMap((entry) => extractQuestions(entry, depth + 1, carried));
};

/**
 * Reads every complete JSON value out of a string, in order.
 *
 * Models routinely emit several objects back to back inside one fenced block, separated by nothing
 * but a blank line. Taking the span from the first brace to the last is not valid JSON, so the whole
 * reply used to be discarded; scanning for balanced values reads each of them instead. A value cut
 * off mid-object at the end is skipped, and whatever came before it is kept.
 */
const jsonValuesIn = (text) => {
  const values = [];
  let index = 0;

  while (index < text.length) {
    const offset = text.slice(index).search(/[[{]/);
    if (offset === -1) break;

    const from = index + offset;
    const open = text[from];
    const close = open === '{' ? '}' : ']';

    let depth = 0;
    let inString = false;
    let end = -1;

    for (let position = from; position < text.length; position += 1) {
      const character = text[position];

      if (inString) {
        if (character === '\\') position += 1;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') inString = true;
      else if (character === open) depth += 1;
      else if (character === close) {
        depth -= 1;
        if (depth === 0) {
          end = position;
          break;
        }
      }
    }

    // Unbalanced from here on: the reply was cut off. Keep what was read before it.
    if (end === -1) break;

    const slice = text.slice(from, end + 1);
    try {
      values.push(JSON.parse(slice));
    } catch {
      // Trailing commas are the usual reason a model's JSON will not parse. Worth one retry.
      try {
        values.push(JSON.parse(slice.replace(/,(\s*[}\]])/g, '$1')));
      } catch {
        // Genuinely malformed; the next value may still be readable.
      }
    }

    index = end + 1;
  }

  return values;
};

/**
 * Pulls questions out of fenced JSON blocks in a model's reply.
 * Returns [] when there is no JSON to read, leaving the prose reader to try instead.
 */
export const extractQuestionsFromJsonBlocks = (text) => {
  const source = String(text || '');
  if (!source.trim()) return [];

  const readAll = (text) => jsonValuesIn(text).flatMap((value) => extractQuestions(value));

  // Every fenced block is read, not just the first: a model that writes one block per question has
  // still written every question.
  const blocks = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]);
  const fenced = blocks.flatMap(readAll);
  if (fenced.length > 0) return fenced;

  // Nothing fenced parsed — an unfenced reply may still be JSON, and a block the model never closed
  // is not matched by the fence pattern at all.
  return readAll(source);
};

/* ------------------------------------------------------------------ markdown round trip ------ */

const OPTION_LETTER = (index) => String.fromCharCode(65 + index);

/**
 * The trailing HTML comment carries the fields that have no natural place in prose.
 *
 * `id` is the important one: it is what lets a save update the same row rather than inserting a
 * duplicate. It is invisible in the rendered preview and survives ordinary editing; delete it and
 * the question is treated as new, which is a reasonable way to fork one.
 */
const metaComment = (question) => {
  const parts = [
    question.id ? `id:${question.id}` : null,
    question.topic ? `topic:${question.topic}` : null,
    question.subtopic ? `subtopic:${question.subtopic}` : null,
    `type:${question.questionType}`,
    `difficulty:${question.difficulty}`,
    question.bloomLevel ? `bloom:${question.bloomLevel}` : null,
    question.assessmentObjective ? `ao:${question.assessmentObjective}` : null,
  ].filter(Boolean);

  return `<!-- ${parts.join(' | ')} -->`;
};

const parseMetaComment = (block) => {
  const match = block.match(/<!--\s*([\s\S]*?)\s*-->/);
  if (!match) return {};

  const meta = {};
  for (const part of match[1].split('|')) {
    const [key, ...rest] = part.split(':');
    const value = rest.join(':').trim();
    if (key && value) meta[key.trim()] = value;
  }
  return meta;
};

/** Renders questions as the Markdown a teacher edits. */
export const questionsToMarkdown = (questions) =>
  (questions || [])
    .map((question, index) => {
      const lines = [
        `## ${index + 1}. ${question.stem}${question.marks ? `  [${question.marks} marks]` : ''}`,
        '',
      ];

      if (question.options?.length > 0) {
        lines.push(...question.options.map((option, position) => `- ${OPTION_LETTER(position)}. ${option}`), '');
      }

      if (question.correctAnswer) {
        lines.push(`**Answer:** ${question.correctAnswer}`, '');
      }

      if (question.markingScheme?.length > 0) {
        lines.push(
          '**Marking scheme:**',
          ...question.markingScheme.map((entry) => `- ${entry.point} (${entry.marks})`),
          '',
        );
      }

      if (question.reviewNotes) {
        lines.push(`> ${question.reviewNotes}`, '');
      }

      lines.push(metaComment(question), '');
      return lines.join('\n');
    })
    .join('\n');

const HEADING = /^\s*#{0,6}\s*(?:\*\*)?(?:Question\s*)?(\d+)[.)：:]\s*/i;

/**
 * Reads edited Markdown back into questions.
 *
 * Deliberately forgiving: a teacher rewriting a stem, deleting an option or adding a whole new
 * numbered question should all work. A block whose meta comment has gone is treated as new rather
 * than being dropped.
 */
export const markdownToQuestions = (markdown) => {
  const source = String(markdown || '');
  if (!source.trim()) return [];

  const blocks = source
    .split(/\n(?=\s*#{0,6}\s*(?:\*\*)?(?:Question\s*)?\d+[.)：:])/i)
    .map((block) => block.trim())
    .filter(Boolean);

  const questions = [];

  for (const block of blocks) {
    if (!HEADING.test(block)) continue;

    const meta = parseMetaComment(block);
    const body = block.replace(/<!--[\s\S]*?-->/g, '').replace(HEADING, '').replace(/\*\*/g, '').trim();
    if (!body) continue;

    const lines = body.split(/\n/).map((line) => line.trim()).filter(Boolean);

    const isOption = (line) => /^-?\s*[A-Ha-h][.)]\s+/.test(line);
    const ANSWER = /^(?:answer|ans|solution|expected answer|correct answer)\s*[:\-—]\s*/i;
    const isSchemeHeading = (line) => /^marking scheme\s*:?\s*$/i.test(line);
    const isBullet = (line) => /^[-*•]\s+/.test(line);
    const isNote = (line) => /^>\s+/.test(line);

    const optionLines = lines.filter(isOption);
    const answerLine = lines.find((line) => ANSWER.test(line));
    const noteLines = lines.filter(isNote);

    // Bullets after the "Marking scheme" heading are award points; bullets before it are options.
    const schemeStart = lines.findIndex(isSchemeHeading);
    const schemeLines =
      schemeStart === -1
        ? []
        : lines.slice(schemeStart + 1).filter((line) => isBullet(line) && !isOption(line));

    const marksMatch = body.match(/[[(]\s*(\d+)\s*marks?\s*[\])]/i);

    const stem = lines
      .filter(
        (line) =>
          !isOption(line) &&
          !ANSWER.test(line) &&
          !isSchemeHeading(line) &&
          !isNote(line) &&
          !schemeLines.includes(line),
      )
      .join(' ')
      .replace(/[[(]\s*\d+\s*marks?\s*[\])]/i, '')
      .trim();

    if (!stem && optionLines.length === 0 && !answerLine) continue;

    const options = optionLines.map((line) => line.replace(/^-?\s*[A-Ha-h][.)]\s+/, '').trim());

    questions.push(
      normaliseQuestion({
        id: meta.id,
        stem: stem || body,
        topic: meta.topic,
        subtopic: meta.subtopic,
        questionType: meta.type,
        difficulty: meta.difficulty,
        bloomLevel: meta.bloom,
        assessmentObjective: meta.ao,
        options,
        correctAnswer: answerLine ? answerLine.replace(ANSWER, '').trim() : '',
        markingScheme: schemeLines.map((line) => {
          const point = line.replace(/^[-*•]\s+/, '').trim();
          const marks = point.match(/\((\d+)\)\s*$/);
          return {
            point: point.replace(/\s*\(\d+\)\s*$/, '').trim(),
            marks: marks ? Number(marks[1]) : 1,
          };
        }),
        marks: marksMatch ? Number(marksMatch[1]) : undefined,
        reviewNotes: noteLines.map((line) => line.replace(/^>\s+/, '')).join(' '),
      }),
    );
  }

  return questions;
};
