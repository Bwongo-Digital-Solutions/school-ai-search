/**
 * Lesson Planner: drafts lesson plans and schemes of work from the school's curriculum corpus.
 *
 * Reached through POST /api/functions/lesson-planner, gated to teaching staff ahead of the action
 * table like every other service here.
 *
 * Generation uses the same agent machinery as the Digital Examiner and for the same reason: the
 * model returns a plan by *calling* a tool whose schema is the plan, which is the one structured
 * output mechanism every provider family supports. Retrieval runs first, so a plan is written from
 * the syllabus in front of the model and carries the passages it came from.
 *
 * A generated plan is a first draft. It saves as 'draft', every field stays editable, and nothing
 * downstream treats it as authoritative until a teacher approves it.
 */
import { randomUUID } from 'node:crypto';

import { buildToolRegistry } from '../agent/tools.mjs';
import { createAgentContext, runAgent } from '../agent/loop.mjs';
import { resolveModelSelection } from './llm-models.mjs';
import { retrieveCurriculum, toStoredCitations } from '../rag/retriever.mjs';
import { describeFramework, resolveFramework, yearLabelFor } from './curriculum-frameworks.mjs';
import { requireRole, resolveActor } from '../auth/actor.mjs';

const TEACHING_ROLES = ['admin', 'teacher'];

// A term is at most ~14 weeks; anything beyond this is a mistake, and each entry costs generation.
const MAX_SCHEME_LESSONS = Number(process.env.PLANNER_MAX_SCHEME_LESSONS || 20);

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

const PLAN_COLUMNS = `
  id, teacher_id, subject_id, subject_name, class_id, curriculum, academic_year, term, grade_level,
  topic, subtopic, title, duration_minutes, lesson_date, period, competencies, learning_outcomes,
  materials, activities, assessment, differentiation, homework, refs, status, generated_by,
  created_by, created_at, updated_at
`;

/* -------------------------------------------------------------------------- listing ---------- */

const list = async ({ database, body }) => {
  const conditions = [];
  const values = [];

  for (const [column, value] of [
    ['subject_id', trimmed(body.subjectId)],
    ['class_id', trimmed(body.classId)],
    ['academic_year', trimmed(body.academicYear)],
    ['term', trimmed(body.term)],
    ['status', trimmed(body.status)],
    ['created_by', trimmed(body.createdBy)],
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
    `SELECT ${PLAN_COLUMNS} FROM lesson_plans${clause} ORDER BY updated_at DESC LIMIT ${asInteger(body.limit, 100)}`,
    values,
  );

  return { plans: rows };
};

const get = async ({ database, body }) => {
  const { rows } = await database.query(`SELECT ${PLAN_COLUMNS} FROM lesson_plans WHERE id = $1`, [trimmed(body.id)]);
  return rows[0] ? { plan: rows[0] } : { error: 'Lesson plan not found' };
};

/* ------------------------------------------------------------------------ generation --------- */

const SUBMIT_TOOL_NAME = 'submit_lesson_plan';

const createSubmitTool = (collected) => ({
  name: SUBMIT_TOOL_NAME,
  description:
    'Submit the finished lesson plan. Call this exactly once, when every section is written and ' +
    'grounded in a retrieved syllabus passage.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A specific lesson title, not just the topic name.' },
      learningOutcomes: {
        type: 'array',
        description: 'What a learner will be able to do by the end. Observable and assessable.',
        items: { type: 'string' },
      },
      competencies: {
        type: 'array',
        description: 'Syllabus competencies or generic skills this lesson develops.',
        items: { type: 'string' },
      },
      materials: {
        type: 'array',
        description: 'Teaching aids required. Prefer materials a school with few resources can obtain.',
        items: { type: 'string' },
      },
      activities: {
        type: 'array',
        description: 'The lesson stage by stage. Minutes must add up to the lesson duration.',
        items: {
          type: 'object',
            properties: {
            stage: { type: 'string', description: 'e.g. Introduction, Development, Practice, Conclusion.' },
            minutes: { type: 'number' },
            teacherActivity: { type: 'string' },
            learnerActivity: { type: 'string' },
          },
          required: ['stage', 'minutes', 'teacherActivity', 'learnerActivity'],
        },
      },
      assessment: {
        type: 'array',
        description: 'How learning is checked during and at the end of the lesson.',
        items: {
          type: 'object',
          properties: {
            method: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['method', 'description'],
        },
      },
      differentiation: {
        type: 'string',
        description: 'How the lesson supports slower learners and stretches faster ones.',
      },
      homework: { type: 'string' },
      citationIndexes: {
        type: 'array',
        description: 'The [n] citation numbers of the syllabus passages this plan is grounded in.',
        items: { type: 'number' },
      },
    },
    required: ['title', 'learningOutcomes', 'activities'],
  },
  handler: async (plan) => {
    collected.push(plan);
    return 'Lesson plan received.';
  },
});

const buildPlannerPrompt = ({ framework, gradeLevel, subjectName, durationMinutes }) =>
  [
    'You are a lesson planning assistant for a school. You produce plans a teacher can walk into a',
    'classroom and deliver, using the resources a typical school actually has.',
    '',
    describeFramework(framework, { gradeLevel }),
    '',
    'Lesson being planned:',
    subjectName ? `- Subject: ${subjectName}` : null,
    gradeLevel != null ? `- Year / class: ${yearLabelFor(framework, gradeLevel)}` : null,
    `- Duration: ${durationMinutes} minutes`,
    '',
    'How to work:',
    '1. Call search_curriculum for the topic before writing anything.',
    '2. Write the plan from the passages you retrieved. If the syllabus does not cover something,',
    '   leave it out rather than inventing it.',
    '3. Write learning outcomes that are observable and assessable within the lesson.',
    `4. Make the activity minutes add up to ${durationMinutes}.`,
    `5. Call ${SUBMIT_TOOL_NAME} exactly once with the finished plan, recording which retrieved`,
    '   passages you used in citationIndexes.',
  ]
    .filter((line) => line !== null)
    .join('\n');

const insertPlan = async (database, { plan, meta, actor, generatedBy, references }) => {
  const { rows } = await database.query(
    `
      INSERT INTO lesson_plans (
        id, teacher_id, subject_id, subject_name, class_id, curriculum, academic_year, term,
        grade_level, topic, subtopic, title, duration_minutes, lesson_date, period,
        competencies, learning_outcomes, materials, activities, assessment, differentiation,
        homework, refs, status, generated_by, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, 'draft', $24, $25
      )
      RETURNING ${PLAN_COLUMNS}
    `,
    [
      randomUUID(),
      meta.teacherId,
      meta.subjectId,
      meta.subjectName,
      meta.classId,
      meta.curriculum,
      meta.academicYear,
      meta.term,
      meta.gradeLevel,
      meta.topic,
      meta.subtopic,
      trimmed(plan.title) || meta.topic || 'Untitled lesson',
      meta.durationMinutes,
      meta.lessonDate,
      meta.period,
      JSON.stringify(Array.isArray(plan.competencies) ? plan.competencies : []),
      JSON.stringify(Array.isArray(plan.learningOutcomes) ? plan.learningOutcomes : []),
      JSON.stringify(Array.isArray(plan.materials) ? plan.materials : []),
      JSON.stringify(Array.isArray(plan.activities) ? plan.activities : []),
      JSON.stringify(Array.isArray(plan.assessment) ? plan.assessment : []),
      trimmed(plan.differentiation),
      trimmed(plan.homework),
      JSON.stringify(references),
      JSON.stringify(generatedBy),
      actor.email || actor.name,
    ],
  );

  return rows[0];
};

/**
 * Resolves the shared scope of a generation request — framework, grade, subject, class — from the
 * request body, so `generate` and `scheme_of_work` interpret their inputs identically.
 */
const resolveScope = (body) => {
  const gradeLevel = body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel);
  const framework = resolveFramework({ curriculum: trimmed(body.curriculum), gradeLevel });

  return {
    framework,
    gradeLevel,
    curriculum: framework.id,
    subjectId: trimmed(body.subjectId) || null,
    subjectName: trimmed(body.subjectName),
    classId: trimmed(body.classId) || null,
    teacherId: trimmed(body.teacherId) || null,
    academicYear: trimmed(body.academicYear),
    term: trimmed(body.term),
    durationMinutes: asInteger(body.durationMinutes, 40),
  };
};

const runPlanGeneration = async ({ database, httpClient, actor, model, scope, topic, subtopic }) => {
  const collected = [];
  const context = createAgentContext({ database, httpClient, actor, requesterRole: actor.role });

  const primed = await retrieveCurriculum(database, {
    query: [topic, subtopic].filter(Boolean).join(' '),
    curriculum: scope.curriculum,
    subject: scope.subjectName,
    gradeLevel: scope.gradeLevel,
    limit: 6,
    httpClient,
  });
  context.citations.push(...primed);

  const registry = buildToolRegistry({
    requesterRole: actor.role,
    extraTools: [createSubmitTool(collected)],
  });

  const request = [
    `Plan a ${scope.durationMinutes}-minute lesson on "${topic}"`,
    subtopic ? `(focusing on ${subtopic})` : '',
    scope.subjectName ? `for ${scope.subjectName}` : '',
    scope.gradeLevel != null ? `at ${yearLabelFor(scope.framework, scope.gradeLevel)}` : '',
    '.',
  ]
    .filter(Boolean)
    .join(' ');

  const result = await runAgent({
    model,
    system: buildPlannerPrompt({
      framework: scope.framework,
      gradeLevel: scope.gradeLevel,
      subjectName: scope.subjectName,
      durationMinutes: scope.durationMinutes,
    }),
    messages: [
      {
        role: 'user',
        content:
          context.citations.length > 0
            ? [
                request,
                '',
                'Syllabus passages already retrieved for this topic:',
                context.citations
                  .map((citation) => `[${citation.citationIndex}] ${citation.title} — ${citation.heading}\n${citation.content}`)
                  .join('\n\n'),
              ].join('\n')
            : request,
      },
    ],
    registry,
    context,
    terminalTool: SUBMIT_TOOL_NAME,
    httpClient,
  });

  return { plan: collected[0] || null, result, context };
};

const requireGenerationModel = (modelId) => {
  const model = resolveModelSelection(modelId);
  if (model.provider === 'local_rules') {
    return {
      error:
        'Lesson planning needs a configured AI model. Pick one from the model menu — the Local ' +
        'Rules engine can only search student records.',
    };
  }
  return { model };
};

const generate = async ({ database, body, actor, httpClient }) => {
  const topic = trimmed(body.topic);
  if (!topic) return { error: 'A lesson topic is required' };

  const resolved = requireGenerationModel(body.modelId);
  if (resolved.error) return resolved;

  const scope = resolveScope(body);
  const { plan, result, context } = await runPlanGeneration({
    database,
    httpClient,
    actor,
    model: resolved.model,
    scope,
    topic,
    subtopic: trimmed(body.subtopic),
  });

  if (!plan) {
    return {
      error: result.stoppedAtStepLimit
        ? 'The model ran out of steps before submitting a plan. Try a narrower topic.'
        : `The model finished without submitting a plan. It said: ${result.message || '(nothing)'}`,
      steps: result.steps,
    };
  }

  const citationsByIndex = new Map(context.citations.map((citation) => [citation.citationIndex, citation]));
  const references = toStoredCitations(
    (plan.citationIndexes || []).map((index) => citationsByIndex.get(Number(index))).filter(Boolean),
  );

  const saved = await insertPlan(database, {
    plan,
    meta: {
      ...scope,
      topic,
      subtopic: trimmed(body.subtopic),
      lessonDate: trimmed(body.lessonDate) || null,
      period: trimmed(body.period),
    },
    actor,
    generatedBy: {
      modelId: resolved.model.id,
      provider: resolved.model.provider,
      model: resolved.model.model,
      steps: result.steps.length,
      usage: result.usage,
    },
    references,
  });

  return {
    plan: saved,
    steps: result.steps,
    citations: toStoredCitations(context.citations),
    model: {
      id: resolved.model.id,
      label: resolved.model.label,
      provider: resolved.model.provider,
      model: resolved.model.model,
    },
    usage: result.usage,
  };
};

/**
 * Generates a sequence of lessons across a term's topics.
 *
 * Runs one generation per topic rather than asking for the whole term at once: a single request for
 * twelve full plans overruns output limits and degrades every plan in it. Failures are collected
 * per topic, so ten good plans are not lost because the eleventh timed out.
 */
const schemeOfWork = async ({ database, body, actor, httpClient }) => {
  const topics = (Array.isArray(body.topics) ? body.topics : jsonOrDefault(body.topics, []))
    .map(trimmed)
    .filter(Boolean);

  if (topics.length === 0) return { error: 'List at least one topic for the scheme of work' };
  if (topics.length > MAX_SCHEME_LESSONS) {
    return { error: `A scheme of work is limited to ${MAX_SCHEME_LESSONS} lessons at a time` };
  }

  const resolved = requireGenerationModel(body.modelId);
  if (resolved.error) return resolved;

  const scope = resolveScope(body);
  const plans = [];
  const failures = [];

  for (const topic of topics) {
    try {
      const { plan, result, context } = await runPlanGeneration({
        database,
        httpClient,
        actor,
        model: resolved.model,
        scope,
        topic,
        subtopic: '',
      });

      if (!plan) {
        failures.push({ topic, reason: result.message || 'The model submitted no plan.' });
        continue;
      }

      const citationsByIndex = new Map(context.citations.map((citation) => [citation.citationIndex, citation]));
      plans.push(
        await insertPlan(database, {
          plan,
          meta: { ...scope, topic, subtopic: '', lessonDate: null, period: '' },
          actor,
          generatedBy: {
            modelId: resolved.model.id,
            provider: resolved.model.provider,
            model: resolved.model.model,
            steps: result.steps.length,
            usage: result.usage,
            schemeOfWork: true,
          },
          references: toStoredCitations(
            (plan.citationIndexes || []).map((index) => citationsByIndex.get(Number(index))).filter(Boolean),
          ),
        }),
      );
    } catch (error) {
      failures.push({ topic, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (plans.length === 0) {
    return { error: 'No lessons could be generated.', failures };
  }

  return { plans, failures };
};

/* --------------------------------------------------------------------------- editing --------- */

const save = async ({ database, body, actor }) => {
  const title = trimmed(body.title);
  if (!title) return { error: 'A lesson title is required' };

  const scope = resolveScope(body);
  const id = trimmed(body.id);

  const values = [
    scope.teacherId,
    scope.subjectId,
    scope.subjectName,
    scope.classId,
    scope.curriculum,
    scope.academicYear,
    scope.term,
    scope.gradeLevel,
    trimmed(body.topic),
    trimmed(body.subtopic),
    title,
    scope.durationMinutes,
    trimmed(body.lessonDate) || null,
    trimmed(body.period),
    JSON.stringify(jsonOrDefault(body.competencies, [])),
    JSON.stringify(jsonOrDefault(body.learningOutcomes, [])),
    JSON.stringify(jsonOrDefault(body.materials, [])),
    JSON.stringify(jsonOrDefault(body.activities, [])),
    JSON.stringify(jsonOrDefault(body.assessment, [])),
    trimmed(body.differentiation),
    trimmed(body.homework),
  ];

  if (id) {
    const { rows } = await database.query(
      `
        UPDATE lesson_plans SET
          teacher_id = $1, subject_id = $2, subject_name = $3, class_id = $4, curriculum = $5,
          academic_year = $6, term = $7, grade_level = $8, topic = $9, subtopic = $10, title = $11,
          duration_minutes = $12, lesson_date = $13, period = $14, competencies = $15,
          learning_outcomes = $16, materials = $17, activities = $18, assessment = $19,
          differentiation = $20, homework = $21, updated_at = NOW()
        WHERE id = $22
        RETURNING ${PLAN_COLUMNS}
      `,
      [...values, id],
    );
    if (!rows[0]) return { error: 'Lesson plan not found' };
    return { plan: rows[0] };
  }

  const { rows } = await database.query(
    `
      INSERT INTO lesson_plans (
        id, teacher_id, subject_id, subject_name, class_id, curriculum, academic_year, term,
        grade_level, topic, subtopic, title, duration_minutes, lesson_date, period, competencies,
        learning_outcomes, materials, activities, assessment, differentiation, homework, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23
      )
      RETURNING ${PLAN_COLUMNS}
    `,
    [randomUUID(), ...values, actor.email || actor.name],
  );

  return { plan: rows[0] };
};

const setStatus = async ({ database, body }) => {
  const id = trimmed(body.id);
  const status = trimmed(body.status);

  if (!id) return { error: 'A lesson plan id is required' };
  if (!['draft', 'approved', 'delivered'].includes(status)) {
    return { error: `Unsupported lesson plan status: ${status}` };
  }

  const { rows } = await database.query(
    `UPDATE lesson_plans SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING ${PLAN_COLUMNS}`,
    [status, id],
  );

  if (!rows[0]) return { error: 'Lesson plan not found' };
  return { plan: rows[0] };
};

const duplicate = async ({ database, body, actor }) => {
  const { rows } = await database.query(`SELECT ${PLAN_COLUMNS} FROM lesson_plans WHERE id = $1`, [trimmed(body.id)]);
  const source = rows[0];
  if (!source) return { error: 'Lesson plan not found' };

  // A duplicate always starts as a draft, whatever the original's status: it is about to be edited
  // for a different class or term, so carrying 'approved' across would be a lie.
  const { rows: created } = await database.query(
    `
      INSERT INTO lesson_plans (
        id, teacher_id, subject_id, subject_name, class_id, curriculum, academic_year, term,
        grade_level, topic, subtopic, title, duration_minutes, lesson_date, period, competencies,
        learning_outcomes, materials, activities, assessment, differentiation, homework, refs,
        status, generated_by, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, 'draft', $24, $25
      )
      RETURNING ${PLAN_COLUMNS}
    `,
    [
      randomUUID(),
      source.teacher_id,
      source.subject_id,
      source.subject_name,
      trimmed(body.classId) || source.class_id,
      source.curriculum,
      trimmed(body.academicYear) || source.academic_year,
      trimmed(body.term) || source.term,
      source.grade_level,
      source.topic,
      source.subtopic,
      `${source.title} (copy)`,
      source.duration_minutes,
      trimmed(body.lessonDate) || null,
      source.period,
      JSON.stringify(source.competencies),
      JSON.stringify(source.learning_outcomes),
      JSON.stringify(source.materials),
      JSON.stringify(source.activities),
      JSON.stringify(source.assessment),
      source.differentiation,
      source.homework,
      JSON.stringify(source.refs),
      JSON.stringify(source.generated_by),
      actor.email || actor.name,
    ],
  );

  return { plan: created[0] };
};

const remove = async ({ database, body }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A lesson plan id is required' };

  await database.query('DELETE FROM lesson_plans WHERE id = $1', [id]);
  return { deleted: { id } };
};

const ACTIONS = {
  list,
  get,
  generate,
  scheme_of_work: schemeOfWork,
  save,
  set_status: setStatus,
  duplicate,
  delete: remove,
};

export const LESSON_PLANNER_ACTIONS = Object.keys(ACTIONS);

export const handleLessonPlannerFunction = async (database, body = {}, httpClient = fetch, { actor: authenticated, tenantId } = {}) => {
  // The actor comes from the request's session when there was a request to authenticate, and from
  // the body only for an internal call that never had one. See resolveActor.
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, TEACHING_ROLES);
  if (refusal) return refusal;

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported lesson planner action: ${body.action}` };

  return handler({ database, body, actor, httpClient, tenantId });
};
