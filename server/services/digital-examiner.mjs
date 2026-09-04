/**
 * Digital Examiner: generates test questions, assignments and exams grounded in the Uganda syllabus
 * and International GCSE standards, then banks, assembles and publishes them.
 *
 * Reached through POST /api/functions/digital-examiner. The role gate sits ahead of the action
 * table, as in fees.mjs, so no handler runs without passing it; unlike fees this is open to teachers
 * as well as administrators, because generating a class test is ordinary teaching work.
 *
 * Generation is deliberately a two-stage agent run rather than a single prompt:
 *
 *   1. retrieve — the blueprint's topics are searched against the curriculum corpus first, so the
 *      model writes from the syllabus in front of it rather than from memory, and every question
 *      carries the citations it was grounded in;
 *   2. submit  — the model returns questions by *calling* a `submit_questions` tool whose schema is
 *      the question array. That is the provider-neutral way to get structured JSON: Anthropic,
 *      OpenAI-compatible and Gemini all support tool schemas, whereas each has a different (or
 *      absent) native JSON mode.
 */
import { randomUUID } from 'node:crypto';

import { withTransaction } from '../db/connection.mjs';
import { buildToolRegistry } from '../agent/tools.mjs';
import { createAgentContext, runAgent } from '../agent/loop.mjs';
import { resolveModelSelection } from './llm-models.mjs';
import { retrieveCurriculum, toStoredCitations } from '../rag/retriever.mjs';
import {
  extractQuestions,
  extractQuestionsFromJsonBlocks,
  markdownToQuestions,
  questionsToMarkdown,
} from './question-parse.mjs';
import {
  ASSESSMENT_TYPES,
  BLOOM_LEVELS,
  DIFFICULTY_LEVELS,
  describeFramework,
  resolveFramework,
  yearLabelFor,
} from './curriculum-frameworks.mjs';
import { requireRole, resolveActor } from '../auth/actor.mjs';

const TEACHING_ROLES = ['admin', 'teacher'];

// A single generation request is capped so one careless click cannot spend a school's whole budget.
const MAX_QUESTIONS_PER_RUN = Number(process.env.EXAMINER_MAX_QUESTIONS || 40);

const trimmed = (value) => String(value ?? '').trim();

const asInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const jsonOrDefault = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const BLUEPRINT_COLUMNS = `
  id, name, curriculum, subject_id, subject_name, grade_level, academic_year, term, paper_label,
  assessment_type, duration_minutes, total_marks, topic_weights, difficulty_mix, bloom_mix,
  question_type_mix, sections, created_by, created_at, updated_at
`;

const QUESTION_COLUMNS = `
  id, blueprint_id, curriculum, subject_id, subject_name, grade_level, topic, subtopic,
  question_type, difficulty, bloom_level, command_word, stem, options, correct_answer,
  marking_scheme, marks, expected_time_minutes, assessment_objective, source_references,
  status, review_notes, generated_by, created_by, created_at, updated_at
`;

const PAPER_COLUMNS = `
  id, blueprint_id, exam_id, title, curriculum, subject_id, subject_name, grade_level,
  academic_year, term, assessment_type, duration_minutes, total_marks, instructions,
  question_ids, sections, status, published_at, created_by, created_at, updated_at
`;

/* ------------------------------------------------------------------------ blueprints -------- */

const listBlueprints = async ({ database, body }) => {
  const conditions = [];
  const values = [];

  if (body.subjectId) {
    values.push(trimmed(body.subjectId));
    conditions.push(`subject_id = $${values.length}`);
  }
  if (body.gradeLevel != null && body.gradeLevel !== '') {
    values.push(Number(body.gradeLevel));
    conditions.push(`grade_level = $${values.length}`);
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await database.query(
    `SELECT ${BLUEPRINT_COLUMNS} FROM exam_blueprints${clause} ORDER BY updated_at DESC LIMIT 100`,
    values,
  );

  return { blueprints: rows };
};

/**
 * Fills in whatever the teacher did not specify from the curriculum framework, so a blueprint
 * created with nothing but a subject and a grade is still a usable, examiner-shaped paper.
 */
const withFrameworkDefaults = (body) => {
  const framework = resolveFramework({
    curriculum: body.curriculum,
    gradeLevel: body.gradeLevel,
  });
  const paper = framework.paperStructures[0] || {};

  return {
    framework,
    curriculum: framework.id,
    durationMinutes: asInteger(body.durationMinutes, paper.durationMinutes || 90),
    totalMarks: asInteger(body.totalMarks, paper.totalMarks || framework.marksConventions.defaultTotal || 100),
    sections: jsonOrDefault(body.sections, paper.sections || []),
    paperLabel: trimmed(body.paperLabel) || paper.label || 'Paper 1',
  };
};

const saveBlueprint = async ({ database, body, actor }) => {
  const name = trimmed(body.name);
  if (!name) return { error: 'A blueprint name is required' };

  const assessmentType = trimmed(body.assessmentType) || 'exam';
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    return { error: `Unsupported assessment type: ${assessmentType}` };
  }

  const defaults = withFrameworkDefaults(body);
  const id = trimmed(body.id);

  const values = [
    name,
    defaults.curriculum,
    trimmed(body.subjectId) || null,
    trimmed(body.subjectName),
    body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel),
    trimmed(body.academicYear),
    trimmed(body.term),
    defaults.paperLabel,
    assessmentType,
    defaults.durationMinutes,
    defaults.totalMarks,
    JSON.stringify(jsonOrDefault(body.topicWeights, [])),
    JSON.stringify(jsonOrDefault(body.difficultyMix, {})),
    JSON.stringify(jsonOrDefault(body.bloomMix, {})),
    JSON.stringify(jsonOrDefault(body.questionTypeMix, {})),
    JSON.stringify(defaults.sections),
  ];

  if (id) {
    const { rows } = await database.query(
      `
        UPDATE exam_blueprints SET
          name = $1, curriculum = $2, subject_id = $3, subject_name = $4, grade_level = $5,
          academic_year = $6, term = $7, paper_label = $8, assessment_type = $9,
          duration_minutes = $10, total_marks = $11, topic_weights = $12, difficulty_mix = $13,
          bloom_mix = $14, question_type_mix = $15, sections = $16, updated_at = NOW()
        WHERE id = $17
        RETURNING ${BLUEPRINT_COLUMNS}
      `,
      [...values, id],
    );
    if (!rows[0]) return { error: 'Blueprint not found' };
    return { blueprint: rows[0] };
  }

  const { rows } = await database.query(
    `
      INSERT INTO exam_blueprints (
        id, name, curriculum, subject_id, subject_name, grade_level, academic_year, term,
        paper_label, assessment_type, duration_minutes, total_marks, topic_weights,
        difficulty_mix, bloom_mix, question_type_mix, sections, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING ${BLUEPRINT_COLUMNS}
    `,
    [randomUUID(), ...values, actor.email || actor.name],
  );

  return { blueprint: rows[0] };
};

const deleteBlueprint = async ({ database, body }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A blueprint id is required' };

  // Questions and papers reference the blueprint with ON DELETE SET NULL, so the bank survives.
  await database.query('DELETE FROM exam_blueprints WHERE id = $1', [id]);
  return { deleted: { id } };
};

/* ------------------------------------------------------------------------ generation -------- */

const SUBMIT_TOOL_NAME = 'submit_questions';

/**
 * The tool the model must call to return its questions. Its schema *is* the output contract — which
 * is why generation works identically across Anthropic, OpenAI-compatible and Gemini providers
 * without three different JSON-mode implementations.
 */
const createSubmitTool = (collected) => ({
  name: SUBMIT_TOOL_NAME,
  description:
    'Submit the finished questions. Call this exactly once, when every question is written and ' +
    'each one is grounded in a retrieved syllabus passage.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'The generated questions, in the order they should appear on the paper.',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Syllabus topic this question assesses.' },
            subtopic: { type: 'string' },
            questionType: {
              type: 'string',
              description: 'One of the framework\'s permitted question types, e.g. mcq, short_answer, structured, essay.',
            },
            difficulty: { type: 'string', enum: DIFFICULTY_LEVELS },
            bloomLevel: { type: 'string', enum: BLOOM_LEVELS },
            commandWord: { type: 'string', description: 'The examiner command word the stem opens with.' },
            stem: { type: 'string', description: 'The question as a learner reads it.' },
            options: {
              type: 'array',
              description: 'Answer options for multiple choice. Omit for every other question type.',
              items: { type: 'string' },
            },
            correctAnswer: { type: 'string', description: 'The expected answer, or the correct option for multiple choice.' },
            markingScheme: {
              type: 'array',
              description: 'Mark-by-mark award points, so the question can be marked consistently.',
              items: {
                type: 'object',
                properties: {
                  point: { type: 'string' },
                  marks: { type: 'number' },
                },
                required: ['point', 'marks'],
              },
            },
            marks: { type: 'number' },
            expectedTimeMinutes: { type: 'number' },
            assessmentObjective: { type: 'string', description: 'Assessment objective code, e.g. AO1 or KU.' },
            citationIndexes: {
              type: 'array',
              description: 'The [n] citation numbers of the syllabus passages this question is grounded in.',
              items: { type: 'number' },
            },
          },
          required: ['topic', 'questionType', 'stem', 'correctAnswer', 'marks'],
        },
      },
    },
    required: ['questions'],
  },
  handler: async ({ questions }) => {
    collected.push(...(Array.isArray(questions) ? questions : []));
    return `Received ${collected.length} questions.`;
  },
});

/**
 * Reads questions out of a model's prose reply.
 *
 * The submit tool is the intended path, but a model that ignored it has still written the
 * questions — smaller local models do this constantly, answering "Sure! Below are five questions:"
 * followed by exactly what was asked for. Discarding that and showing an error wastes the work and
 * the tokens, so this recovers what it can.
 *
 * Tries JSON first (a model that emitted the tool payload as a fenced block), then falls back to
 * numbered prose. Anything recovered is flagged so the teacher knows to read it more carefully.
 */
export const salvageQuestionsFromText = (text) => {
  const source = String(text || '');
  if (!source.trim()) return [];

  // JSON first, via the shared parser, which recognises a question by its shape rather than by the
  // wrapper it arrived in — `{name: "<topic>", arguments: {...}}` included, which is the shape that
  // used to be rejected outright.
  const fromJson = extractQuestionsFromJsonBlocks(source);
  if (fromJson.length > 0) return fromJson;

  // Numbered prose: "1. Describe ... [5 marks]" or "**Question 2:** ...", one block each.
  const blocks = source
    .split(/\n(?=\s*(?:\*\*)?(?:Question\s*)?\d+[.)：:])/i)
    .map((block) => block.trim())
    .filter(Boolean);

  const NUMBERED = /^\s*(?:\*\*)?(?:Question\s*)?\d+[.)：:]/i;

  const questions = [];
  for (const block of blocks) {
    // Skip the model's lead-in ("Sure! Below are five questions:"), which is everything before the
    // first numbered item and is not a question.
    if (!NUMBERED.test(block)) continue;

    const withoutNumber = block
      .replace(NUMBERED, '')
      .replace(/\*\*/g, '')
      .trim();
    if (!withoutNumber) continue;

    // A question and its answer, options and mark scheme sit on consecutive lines; a blank line
    // after them marks the model moving on ("Let me know if you want these adapted..."). Split
    // there so closing prose is not glued onto the last question's stem — it is kept as a note
    // rather than dropped.
    const [core, ...trailing] = withoutNumber.split(/\n\s*\n/);
    const cleaned = core.trim();
    const trailingNote = trailing.join('\n\n').trim();
    if (!cleaned) continue;

    const lines = cleaned.split(/\n/).map((line) => line.trim()).filter(Boolean);

    const isOption = (line) => /^[A-Ha-h][.)]\s+/.test(line);
    // "Answer: ...", "Solution -", "Expected answer:" — however the model chose to label it.
    const ANSWER = /^(?:answer|ans|solution|expected answer|correct answer)\s*[:\-—]\s*/i;
    // Bullet points under a question are almost always the mark allocation.
    const isBullet = (line) => /^[-*•]\s+/.test(line);

    const options = lines.filter(isOption).map((line) => line.replace(/^[A-Ha-h][.)]\s+/, '').trim());
    const answerLine = lines.find((line) => ANSWER.test(line));
    const bulletLines = lines.filter(isBullet);

    // "[5 marks]" or "(5 marks)" is the usual way a model annotates the allocation.
    const marksMatch = cleaned.match(/[[(]\s*(\d+)\s*marks?\s*[\])]/i);

    const stem = lines
      .filter((line) => !isOption(line) && !ANSWER.test(line) && !isBullet(line))
      .join(' ')
      .replace(/[[(]\s*\d+\s*marks?\s*[\])]/i, '')
      .trim();

    // Keep the block even when the stem is empty but something else survived, rather than dropping
    // content the model produced. Only a wholly empty block is skipped.
    if (!stem && options.length === 0 && !answerLine) continue;

    questions.push({
      stem: stem || cleaned,
      marks: marksMatch ? Number(marksMatch[1]) : 1,
      questionType: options.length >= 2 ? 'mcq' : 'short_answer',
      options,
      // Captured when the model wrote one. Previously these were blanked, which threw away an
      // answer and mark scheme that were sitting right there in the reply.
      correctAnswer: answerLine ? answerLine.replace(ANSWER, '').trim() : '',
      markingScheme: bulletLines.map((line) => {
        const point = line.replace(/^[-*•]\s+/, '').trim();
        const marks = point.match(/\((\d+)\)\s*$/);
        return {
          point: point.replace(/\s*\(\d+\)\s*$/, '').trim(),
          marks: marks ? Number(marks[1]) : 1,
        };
      }),
      // Kept so nothing the model wrote is lost; it surfaces as a review note on the question.
      reviewNotes: trailingNote,
      citationIndexes: [],
    });
  }

  return questions;
};

const describeMix = (label, mix) => {
  const entries = Object.entries(mix || {}).filter(([, value]) => Number(value) > 0);
  if (entries.length === 0) return null;
  return `${label}: ${entries.map(([key, value]) => `${key} ${value}`).join(', ')}`;
};

const buildGenerationPrompt = ({ framework, blueprint, gradeLevel, weakTopics }) =>
  [
    'You are the Digital Examiner for a school. You write examination questions that a subject',
    'teacher can use without editing, and a marking scheme precise enough for a colleague to mark',
    'from consistently.',
    '',
    describeFramework(framework, { gradeLevel }),
    '',
    'Paper being written:',
    `- Assessment type: ${blueprint.assessmentType}`,
    `- Subject: ${blueprint.subjectName || 'as specified by the teacher'}`,
    `- Year / class: ${yearLabelFor(framework, gradeLevel)}`,
    blueprint.totalMarks ? `- Total marks available: ${blueprint.totalMarks}` : null,
    blueprint.durationMinutes ? `- Duration: ${blueprint.durationMinutes} minutes` : null,
    describeMix('- Difficulty spread', blueprint.difficultyMix),
    describeMix('- Bloom level spread', blueprint.bloomMix),
    describeMix('- Question type spread', blueprint.questionTypeMix),
    weakTopics.length > 0
      ? `- Weight these topics more heavily, because this cohort scored lowest on them: ${weakTopics.join(', ')}`
      : null,
    '',
    'How to work:',
    '1. Call search_curriculum for each topic you are examining, before writing anything.',
    '2. Write every question from the passages you retrieved. If the syllabus does not cover',
    '   something, do not examine it — say so instead of inventing content.',
    '3. Open each stem with a command word from the list above, and make the marks add up to the',
    '   total available.',
    `4. Call ${SUBMIT_TOOL_NAME} exactly once with the finished set. Record, in citationIndexes,`,
    '   which retrieved passages each question came from.',
  ]
    .filter((line) => line !== null)
    .join('\n');

/**
 * Finds the topics a cohort is weakest at, so remedial papers target them.
 * Best-effort: a school with no gradebook history yet simply gets an even spread.
 */
const findWeakTopics = async (database, { gradeLevel, subjectId }) => {
  try {
    const values = [];
    const conditions = [];

    if (gradeLevel != null) {
      values.push(Number(gradeLevel));
      conditions.push(`s.grade_level = $${values.length}`);
    }
    if (subjectId) {
      values.push(String(subjectId));
      conditions.push(`g.subject_id = $${values.length}`);
    }

    const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await database.query(
      `
        SELECT g.remarks AS topic, AVG(g.score / NULLIF(g.max_score, 0) * 100) AS average_percent
        FROM gradebook_entries g
        JOIN students s ON s.id = g.student_id
        ${clause}
        GROUP BY g.remarks
        ORDER BY average_percent ASC
        LIMIT 5
      `,
      values,
    );

    return rows
      .filter((row) => trimmed(row.topic) && Number(row.average_percent) < 60)
      .map((row) => trimmed(row.topic));
  } catch {
    return [];
  }
};

const generateQuestions = async ({ database, body, actor, httpClient }) => {
  const count = Math.min(asInteger(body.count, 10), MAX_QUESTIONS_PER_RUN);
  if (count < 1) return { error: 'Ask for at least one question' };

  const model = resolveModelSelection(body.modelId);
  if (model.provider === 'local_rules') {
    return {
      error:
        'Question generation needs a configured AI model. Pick one from the model menu — the ' +
        'Local Rules engine can only search student records.',
    };
  }

  // A stored blueprint is the normal path; an ad-hoc request supplies the same fields inline.
  let blueprint = null;
  if (trimmed(body.blueprintId)) {
    const { rows } = await database.query(
      `SELECT ${BLUEPRINT_COLUMNS} FROM exam_blueprints WHERE id = $1`,
      [trimmed(body.blueprintId)],
    );
    blueprint = rows[0] || null;
    if (!blueprint) return { error: 'Blueprint not found' };
  }

  const gradeLevel =
    body.gradeLevel != null && body.gradeLevel !== ''
      ? Number(body.gradeLevel)
      : blueprint?.grade_level ?? null;

  const subjectId = trimmed(body.subjectId) || blueprint?.subject_id || null;
  const subjectName = trimmed(body.subjectName) || blueprint?.subject_name || '';

  const framework = resolveFramework({
    curriculum: trimmed(body.curriculum) || blueprint?.curriculum,
    gradeLevel,
  });

  const topics = (Array.isArray(body.topics) ? body.topics : jsonOrDefault(body.topics, []))
    .map(trimmed)
    .filter(Boolean);

  const weakTopics = body.targetWeakTopics ? await findWeakTopics(database, { gradeLevel, subjectId }) : [];

  const spec = {
    assessmentType: trimmed(body.assessmentType) || blueprint?.assessment_type || 'test',
    subjectName,
    totalMarks: asInteger(body.totalMarks, blueprint?.total_marks ?? null),
    durationMinutes: asInteger(body.durationMinutes, blueprint?.duration_minutes ?? null),
    difficultyMix: jsonOrDefault(body.difficultyMix, blueprint?.difficulty_mix ?? {}),
    bloomMix: jsonOrDefault(body.bloomMix, blueprint?.bloom_mix ?? {}),
    questionTypeMix: jsonOrDefault(body.questionTypeMix, blueprint?.question_type_mix ?? {}),
  };

  const collected = [];
  const context = createAgentContext({
    database,
    httpClient,
    actor,
    requesterRole: actor.role,
  });

  // Retrieval is primed before the loop so even a model that ignores the instruction to search has
  // syllabus material in front of it, and so citation numbering starts from the blueprint's topics.
  if (topics.length > 0) {
    const primed = await retrieveCurriculum(database, {
      query: topics.join('; '),
      curriculum: framework.id,
      subject: subjectName,
      gradeLevel,
      limit: 6,
      httpClient,
    });
    context.citations.push(...primed);
  }

  const registry = buildToolRegistry({
    requesterRole: actor.role,
    extraTools: [createSubmitTool(collected)],
  });

  const userRequest = [
    `Write ${count} ${spec.assessmentType} questions`,
    subjectName ? `for ${subjectName}` : '',
    gradeLevel != null ? `at ${yearLabelFor(framework, gradeLevel)}` : '',
    topics.length > 0 ? `covering: ${topics.join(', ')}` : 'covering the core topics for this year',
    '.',
  ]
    .filter(Boolean)
    .join(' ');

  const result = await runAgent({
    model,
    system: buildGenerationPrompt({
      framework,
      blueprint: spec,
      gradeLevel,
      weakTopics,
    }),
    messages: [
      {
        role: 'user',
        content:
          context.citations.length > 0
            ? [
                userRequest,
                '',
                'Syllabus passages already retrieved for these topics:',
                context.citations
                  .map((citation) => `[${citation.citationIndex}] ${citation.title} — ${citation.heading}\n${citation.content}`)
                  .join('\n\n'),
              ].join('\n')
            : userRequest,
      },
    ],
    registry,
    context,
    terminalTool: SUBMIT_TOOL_NAME,
    httpClient,
  });

  // A model that wrote the questions out in prose instead of calling submit_questions has still
  // done the work — smaller local models do this constantly. Throwing it away and showing an error
  // is the wrong outcome, so recover what can be parsed and tell the teacher it needs a closer look.
  let recoveredFromProse = false;
  if (collected.length === 0 && result.message) {
    const salvaged = salvageQuestionsFromText(result.message);
    if (salvaged.length > 0) {
      collected.push(...salvaged);
      recoveredFromProse = true;
    }
  }

  if (collected.length === 0) {
    return {
      error: result.stoppedAtStepLimit
        ? 'The model ran out of steps before writing any questions. Try fewer questions or narrower topics.'
        : 'The model did not produce anything that could be read as questions. Its reply is below — ' +
          'try again, or pick a larger model: small local models often cannot follow a structured format.',
      // Returned so the UI can show what the model actually said, and let the teacher keep it,
      // rather than discarding the response inside an error dialog.
      rawReply: result.message || '',
      // The editor opens on this. Nothing here parsed as a question, so the model's own words are
      // the starting text: the teacher shapes them and saves, rather than losing the reply.
      markdown: result.message || '',
      steps: result.steps,
    };
  }

  const citationsByIndex = new Map(context.citations.map((citation) => [citation.citationIndex, citation]));
  const generatedBy = {
    modelId: model.id,
    provider: model.provider,
    model: model.model,
    steps: result.steps.length,
    usage: result.usage,
  };

  const saved = [];
  // Everything the model produced is kept. `count` is what was asked for, not a ceiling on what
  // comes back: if it wrote eight when asked for five, discarding three is throwing away work that
  // has already been paid for and that the teacher may well want.
  for (const question of collected) {
    const references = toStoredCitations(
      (question.citationIndexes || [])
        .map((index) => citationsByIndex.get(Number(index)))
        .filter(Boolean),
    );

    const { rows } = await database.query(
      `
        INSERT INTO exam_questions (
          id, blueprint_id, curriculum, subject_id, subject_name, grade_level, topic, subtopic,
          question_type, difficulty, bloom_level, command_word, stem, options, correct_answer,
          marking_scheme, marks, expected_time_minutes, assessment_objective, source_references,
          review_notes, status, generated_by, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, 'draft', $22, $23
        )
        RETURNING ${QUESTION_COLUMNS}
      `,
      [
        randomUUID(),
        blueprint?.id || null,
        framework.id,
        subjectId,
        subjectName,
        gradeLevel,
        trimmed(question.topic),
        trimmed(question.subtopic),
        trimmed(question.questionType) || 'short_answer',
        DIFFICULTY_LEVELS.includes(question.difficulty) ? question.difficulty : 'moderate',
        trimmed(question.bloomLevel) || 'understand',
        trimmed(question.commandWord),
        trimmed(question.stem),
        JSON.stringify(Array.isArray(question.options) ? question.options : []),
        trimmed(question.correctAnswer),
        JSON.stringify(Array.isArray(question.markingScheme) ? question.markingScheme : []),
        asInteger(question.marks, 1),
        asInteger(question.expectedTimeMinutes, 2),
        trimmed(question.assessmentObjective),
        JSON.stringify(references),
        // Anything the model wrote around the question, so it is visible rather than lost.
        trimmed(question.reviewNotes),
        JSON.stringify(generatedBy),
        actor.email || actor.name,
      ],
    );

    saved.push(rows[0]);
  }

  return {
    questions: saved,
    // The same questions as the Markdown the editor shows, rendered server-side so the editor and
    // the save path are reading and writing one format.
    markdown: questionsToMarkdown(extractQuestions(saved)),
    steps: result.steps,
    // Flagged so the UI can say these were read out of prose rather than returned structurally,
    // and therefore deserve a closer read before approval.
    recoveredFromProse,
    // Always returned, not only on recovery: the reply often carries notes, a rationale or extra
    // material around the questions, and dropping it loses context the teacher may want.
    rawReply: result.message || '',
    citations: toStoredCitations(context.citations),
    weakTopics,
    model: { id: model.id, label: model.label, provider: model.provider, model: model.model },
    usage: result.usage,
  };
};

/* --------------------------------------------------------------------- question bank -------- */

const listQuestions = async ({ database, body }) => {
  const conditions = [];
  const values = [];

  for (const [column, value] of [
    ['blueprint_id', trimmed(body.blueprintId)],
    ['subject_id', trimmed(body.subjectId)],
    ['status', trimmed(body.status)],
    ['topic', trimmed(body.topic)],
    ['curriculum', trimmed(body.curriculum)],
  ]) {
    if (value) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }

  if (body.gradeLevel != null && body.gradeLevel !== '') {
    values.push(Number(body.gradeLevel));
    conditions.push(`grade_level = $${values.length}`);
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await database.query(
    `SELECT ${QUESTION_COLUMNS} FROM exam_questions${clause} ORDER BY created_at DESC LIMIT ${asInteger(body.limit, 200)}`,
    values,
  );

  return { questions: rows };
};

const saveQuestion = async ({ database, body, actor }) => {
  const id = trimmed(body.id);
  const stem = trimmed(body.stem);
  if (!stem) return { error: 'A question stem is required' };

  const values = [
    trimmed(body.topic),
    trimmed(body.subtopic),
    trimmed(body.questionType) || 'short_answer',
    DIFFICULTY_LEVELS.includes(body.difficulty) ? body.difficulty : 'moderate',
    trimmed(body.bloomLevel) || 'understand',
    trimmed(body.commandWord),
    stem,
    JSON.stringify(jsonOrDefault(body.options, [])),
    trimmed(body.correctAnswer),
    JSON.stringify(jsonOrDefault(body.markingScheme, [])),
    asInteger(body.marks, 1),
    asInteger(body.expectedTimeMinutes, 2),
    trimmed(body.assessmentObjective),
    trimmed(body.reviewNotes),
  ];

  if (id) {
    const { rows } = await database.query(
      `
        UPDATE exam_questions SET
          topic = $1, subtopic = $2, question_type = $3, difficulty = $4, bloom_level = $5,
          command_word = $6, stem = $7, options = $8, correct_answer = $9, marking_scheme = $10,
          marks = $11, expected_time_minutes = $12, assessment_objective = $13, review_notes = $14,
          updated_at = NOW()
        WHERE id = $15
        RETURNING ${QUESTION_COLUMNS}
      `,
      [...values, id],
    );
    if (!rows[0]) return { error: 'Question not found' };
    return { question: rows[0] };
  }

  const { rows } = await database.query(
    `
      INSERT INTO exam_questions (
        id, blueprint_id, curriculum, subject_id, subject_name, grade_level, topic, subtopic,
        question_type, difficulty, bloom_level, command_word, stem, options, correct_answer,
        marking_scheme, marks, expected_time_minutes, assessment_objective, review_notes,
        status, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, 'draft', $21
      )
      RETURNING ${QUESTION_COLUMNS}
    `,
    [
      randomUUID(),
      trimmed(body.blueprintId) || null,
      trimmed(body.curriculum),
      trimmed(body.subjectId) || null,
      trimmed(body.subjectName),
      body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel),
      ...values,
      actor.email || actor.name,
    ],
  );

  return { question: rows[0] };
};

// A teacher reviewing a freshly generated paper edits a dozen questions at once, so the editor saves
// them in one call rather than one request each.
const MAX_QUESTIONS_PER_SAVE = 200;

/** Turns a question shape into the ordered value list both the update and the insert below use. */
const questionContentValues = (question) => [
  trimmed(question.topic),
  trimmed(question.subtopic),
  trimmed(question.questionType) || 'short_answer',
  DIFFICULTY_LEVELS.includes(question.difficulty) ? question.difficulty : 'moderate',
  trimmed(question.bloomLevel) || 'understand',
  trimmed(question.commandWord),
  trimmed(question.stem),
  JSON.stringify(Array.isArray(question.options) ? question.options : []),
  trimmed(question.correctAnswer),
  JSON.stringify(Array.isArray(question.markingScheme) ? question.markingScheme : []),
  asInteger(question.marks, 1),
  asInteger(question.expectedTimeMinutes, 2),
  trimmed(question.assessmentObjective),
  trimmed(question.reviewNotes),
];

/**
 * Saves a whole edited draft in one call — what the Markdown editor posts when the teacher presses
 * Save.
 *
 * Takes either `markdown` (the edited text) or `questions` (an array), and parses both through the
 * shared reader, so the editor and the model recovery path agree on what counts as a question.
 *
 * A block that still carries its id updates that row; one without — a question the teacher typed, or
 * whose trailing marker they deleted — is inserted as a new draft. An id that no longer exists is
 * inserted rather than dropped, because a save should never lose the teacher's work.
 */
const saveQuestions = async ({ database, body, actor }) => {
  const parsed =
    Array.isArray(body.questions) && body.questions.length > 0
      ? extractQuestions(body.questions)
      : markdownToQuestions(body.markdown);

  const questions = parsed.filter((question) => trimmed(question.stem));
  if (questions.length === 0) {
    return { error: 'Nothing in the editor could be read as a question. Each one needs a number and a stem.' };
  }
  if (questions.length > MAX_QUESTIONS_PER_SAVE) {
    return { error: `That is ${questions.length} questions; save at most ${MAX_QUESTIONS_PER_SAVE} at a time.` };
  }

  const saved = [];
  let created = 0;
  let updated = 0;

  for (const question of questions) {
    const values = questionContentValues(question);
    const id = trimmed(question.id);

    if (id) {
      const { rows } = await database.query(
        `
          UPDATE exam_questions SET
            topic = $1, subtopic = $2, question_type = $3, difficulty = $4, bloom_level = $5,
            command_word = $6, stem = $7, options = $8, correct_answer = $9, marking_scheme = $10,
            marks = $11, expected_time_minutes = $12, assessment_objective = $13, review_notes = $14,
            updated_at = NOW()
          WHERE id = $15
          RETURNING ${QUESTION_COLUMNS}
        `,
        [...values, id],
      );

      if (rows[0]) {
        saved.push(rows[0]);
        updated += 1;
        continue;
      }
      // Fall through: the row is gone, so keep the edit as a new question.
    }

    const { rows } = await database.query(
      `
        INSERT INTO exam_questions (
          id, blueprint_id, curriculum, subject_id, subject_name, grade_level, topic, subtopic,
          question_type, difficulty, bloom_level, command_word, stem, options, correct_answer,
          marking_scheme, marks, expected_time_minutes, assessment_objective, review_notes,
          status, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, 'draft', $21
        )
        RETURNING ${QUESTION_COLUMNS}
      `,
      [
        randomUUID(),
        trimmed(body.blueprintId) || null,
        trimmed(body.curriculum),
        trimmed(body.subjectId) || null,
        trimmed(body.subjectName),
        body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel),
        ...values,
        actor.email || actor.name,
      ],
    );

    saved.push(rows[0]);
    created += 1;
  }

  // The saved rows re-rendered as Markdown: every question now carries an id, so the editor can
  // adopt this text and a second Save updates the same rows instead of inserting duplicates.
  return {
    questions: saved,
    markdown: questionsToMarkdown(extractQuestions(saved)),
    saved: saved.length,
    created,
    updated,
  };
};

const setQuestionStatus = async ({ database, body }) => {
  const id = trimmed(body.id);
  const status = trimmed(body.status);

  if (!id) return { error: 'A question id is required' };
  if (!['draft', 'approved', 'retired'].includes(status)) {
    return { error: `Unsupported question status: ${status}` };
  }

  const { rows } = await database.query(
    `UPDATE exam_questions SET status = $1, review_notes = $2, updated_at = NOW() WHERE id = $3 RETURNING ${QUESTION_COLUMNS}`,
    [status, trimmed(body.reviewNotes), id],
  );

  if (!rows[0]) return { error: 'Question not found' };
  return { question: rows[0] };
};

const deleteQuestion = async ({ database, body }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A question id is required' };

  await database.query('DELETE FROM exam_questions WHERE id = $1', [id]);
  return { deleted: { id } };
};

/* -------------------------------------------------------------------------- papers ---------- */

const assemblePaper = async ({ database, body, actor }) => {
  const title = trimmed(body.title);
  if (!title) return { error: 'A paper title is required' };

  const questionIds = (Array.isArray(body.questionIds) ? body.questionIds : []).map(trimmed).filter(Boolean);
  if (questionIds.length === 0) return { error: 'Select at least one question for the paper' };

  const placeholders = questionIds.map((_, index) => `$${index + 1}`).join(', ');
  const { rows: questions } = await database.query(
    `SELECT id, marks, status FROM exam_questions WHERE id IN (${placeholders})`,
    questionIds,
  );

  if (questions.length !== questionIds.length) {
    return { error: 'One or more selected questions no longer exist' };
  }

  const retired = questions.filter((question) => question.status === 'retired');
  if (retired.length > 0) {
    return { error: `${retired.length} selected question(s) have been retired and cannot go on a paper` };
  }

  // Marks are summed from the questions themselves rather than trusted from the client, so the
  // printed total always matches what is actually on the paper.
  const totalMarks = questions.reduce((total, question) => total + Number(question.marks || 0), 0);
  const blueprintId = trimmed(body.blueprintId) || null;

  const { rows } = await database.query(
    `
      INSERT INTO generated_papers (
        id, blueprint_id, title, curriculum, subject_id, subject_name, grade_level,
        academic_year, term, assessment_type, duration_minutes, total_marks, instructions,
        question_ids, sections, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16)
      RETURNING ${PAPER_COLUMNS}
    `,
    [
      randomUUID(),
      blueprintId,
      title,
      trimmed(body.curriculum),
      trimmed(body.subjectId) || null,
      trimmed(body.subjectName),
      body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel),
      trimmed(body.academicYear),
      trimmed(body.term),
      trimmed(body.assessmentType) || 'exam',
      asInteger(body.durationMinutes, 90),
      totalMarks,
      trimmed(body.instructions),
      JSON.stringify(questionIds),
      JSON.stringify(jsonOrDefault(body.sections, [])),
      actor.email || actor.name,
    ],
  );

  return { paper: rows[0] };
};

const listPapers = async ({ database, body }) => {
  const conditions = [];
  const values = [];

  if (trimmed(body.status)) {
    values.push(trimmed(body.status));
    conditions.push(`status = $${values.length}`);
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await database.query(
    `SELECT ${PAPER_COLUMNS} FROM generated_papers${clause} ORDER BY created_at DESC LIMIT 100`,
    values,
  );

  return { papers: rows };
};

/**
 * Loads a paper with its questions resolved and ordered as stored.
 * Shared by the UI preview and both PDF routes, so all three render the same paper.
 */
export const loadPaper = async (database, paperId) => {
  const { rows } = await database.query(`SELECT ${PAPER_COLUMNS} FROM generated_papers WHERE id = $1`, [paperId]);
  const paper = rows[0];
  if (!paper) return null;

  const questionIds = jsonOrDefault(paper.question_ids, []);
  if (questionIds.length === 0) return { paper, questions: [] };

  const placeholders = questionIds.map((_, index) => `$${index + 1}`).join(', ');
  const { rows: questions } = await database.query(
    `SELECT ${QUESTION_COLUMNS} FROM exam_questions WHERE id IN (${placeholders})`,
    questionIds,
  );

  // SQL gives no ordering guarantee for an IN list; restore the teacher's chosen sequence.
  const byId = new Map(questions.map((question) => [question.id, question]));
  return { paper, questions: questionIds.map((id) => byId.get(id)).filter(Boolean) };
};

const getPaper = async ({ database, body }) => {
  const loaded = await loadPaper(database, trimmed(body.id));
  return loaded ? loaded : { error: 'Paper not found' };
};

/**
 * Publishes a paper into the school's real exam records.
 *
 * This is the full-integration step: an exams row (and an exam_schedules row when a date is given)
 * is written so timetabling, the gradebook and report cards see it like any other exam. Wrapped in
 * a transaction so a paper can never end up marked published while pointing at no exam.
 */
const publishPaper = async ({ database, body, actor }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A paper id is required' };

  const loaded = await loadPaper(database, id);
  if (!loaded) return { error: 'Paper not found' };
  if (loaded.paper.status === 'published') return { error: 'This paper has already been published' };
  if (loaded.questions.length === 0) return { error: 'A paper with no questions cannot be published' };

  const unapproved = loaded.questions.filter((question) => question.status !== 'approved');
  if (unapproved.length > 0) {
    return {
      error: `${unapproved.length} question(s) still need review. Approve every question before publishing.`,
    };
  }

  const paper = loaded.paper;
  const classId = trimmed(body.classId);
  const examDate = trimmed(body.examDate);

  // Validated before the transaction rather than left to the foreign key, so a stale class id from
  // the browser reads as a clear message instead of a raw constraint violation.
  if (classId) {
    const { rows } = await database.query('SELECT id FROM classes WHERE id = $1', [classId]);
    if (!rows[0]) return { error: `No class found with id "${classId}"` };
  }

  const result = await withTransaction(database, async (executor) => {
    const examId = randomUUID();

    await executor.query(
      `
        INSERT INTO exams (id, name, exam_type, academic_year, term, start_date, end_date, status)
        VALUES ($1, $2, $3, $4, $5, $6, $6, 'scheduled')
      `,
      [
        examId,
        paper.title,
        paper.assessment_type,
        paper.academic_year,
        paper.term,
        examDate || null,
      ],
    );

    // A schedule row needs a date and a class; without both the exam exists but is unscheduled,
    // which is a legitimate state (a teacher publishing a paper before the timetable is fixed).
    if (examDate && classId) {
      await executor.query(
        `
          INSERT INTO exam_schedules (id, exam_id, subject_id, class_id, exam_date, start_time, end_time, room)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          randomUUID(),
          examId,
          paper.subject_id,
          classId,
          examDate,
          trimmed(body.startTime) || '09:00',
          trimmed(body.endTime) || '11:00',
          trimmed(body.room),
        ],
      );
    }

    const { rows } = await executor.query(
      `
        UPDATE generated_papers
        SET status = 'published', exam_id = $1, published_at = NOW(), updated_at = NOW()
        WHERE id = $2
        RETURNING ${PAPER_COLUMNS}
      `,
      [examId, id],
    );

    return { paper: rows[0], examId };
  });

  await database.query(
    `
      INSERT INTO audit_logs (id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes)
      VALUES ($1, $2, $3, $4, 'exam_published', 'generated_paper', $5, $6, $7)
    `,
    [
      randomUUID(),
      actor.email,
      actor.name,
      actor.role,
      id,
      paper.title,
      JSON.stringify({ examId: result.examId, questionCount: loaded.questions.length, totalMarks: paper.total_marks }),
    ],
  );

  return { paper: result.paper, examId: result.examId };
};

const deletePaper = async ({ database, body }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A paper id is required' };

  await database.query('DELETE FROM generated_papers WHERE id = $1', [id]);
  return { deleted: { id } };
};

const ACTIONS = {
  list_blueprints: listBlueprints,
  save_blueprint: saveBlueprint,
  delete_blueprint: deleteBlueprint,
  generate_questions: generateQuestions,
  list_questions: listQuestions,
  save_question: saveQuestion,
  save_questions: saveQuestions,
  set_question_status: setQuestionStatus,
  delete_question: deleteQuestion,
  assemble_paper: assemblePaper,
  list_papers: listPapers,
  get_paper: getPaper,
  publish_paper: publishPaper,
  delete_paper: deletePaper,
};

export const EXAMINER_ACTIONS = Object.keys(ACTIONS);

export const handleDigitalExaminerFunction = async (database, body = {}, httpClient = fetch, { actor: authenticated, tenantId } = {}) => {
  // The actor comes from the request's session when there was a request to authenticate, and from
  // the body only for an internal call that never had one. See resolveActor.
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, TEACHING_ROLES);
  if (refusal) return refusal;

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported digital examiner action: ${body.action}` };

  return handler({ database, body, actor, httpClient, tenantId });
};
