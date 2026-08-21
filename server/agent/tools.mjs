/**
 * The school tool registry — what the agent is allowed to do on a teacher's behalf.
 *
 * Shaped like the ACTIONS tables in services/fees.mjs and services/settings.mjs, with a JSON schema
 * attached so a model can call them. The same registry backs three surfaces: the chat window's
 * agent mode, the Digital Examiner's generation loop, and the outbound MCP server. Defining a tool
 * once means all three stay in step.
 *
 * Roles are enforced here, not in the prompt. buildToolRegistry() filters by the caller's role
 * before the definitions are ever serialised, so a model working for a teacher is never even told
 * that an admin-only tool exists — it cannot be talked into calling one.
 */
import { getPublicCurriculumFrameworks, resolveFramework, yearLabelFor } from '../services/curriculum-frameworks.mjs';
import { retrieveCurriculum } from '../rag/retriever.mjs';

const TEACHING_ROLES = ['admin', 'teacher'];

const asJson = (value) => JSON.stringify(value, null, 2);

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/* --------------------------------------------------------------------- student tools -------- */

const STUDENT_COLUMNS =
  'id, student_id, first_name, last_name, grade_level, class_section, status, gpa, attendance_rate, subjects, notes';

const searchStudents = {
  name: 'search_students',
  description:
    'Search enrolled students by name, student number, grade level, class section or subject. ' +
    'Returns matching student records. Use this instead of guessing which students exist.',
  roles: TEACHING_ROLES,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text name or student number fragment.' },
      gradeLevel: { type: 'integer', description: 'Restrict to one grade level.' },
      classSection: { type: 'string', description: 'Restrict to one class section, e.g. "A".' },
      subject: { type: 'string', description: 'Restrict to students taking this subject.' },
      limit: { type: 'integer', description: 'Maximum rows to return. Defaults to 25.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async ({ query, gradeLevel, classSection, subject, limit }, { database }) => {
    const conditions = [];
    const values = [];

    if (gradeLevel != null) {
      values.push(Number(gradeLevel));
      conditions.push(`grade_level = $${values.length}`);
    }
    if (classSection) {
      values.push(String(classSection).toUpperCase());
      conditions.push(`class_section = $${values.length}`);
    }
    if (query) {
      values.push(`%${String(query).toLowerCase()}%`);
      const placeholder = `$${values.length}`;
      conditions.push(
        `(LOWER(first_name) LIKE ${placeholder} OR LOWER(last_name) LIKE ${placeholder} ` +
          `OR LOWER(student_id) LIKE ${placeholder})`,
      );
    }

    const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await database.query(
      `SELECT ${STUDENT_COLUMNS} FROM students${clause} ORDER BY last_name LIMIT ${numberOr(limit, 25)}`,
      values,
    );

    // Subject lives in a JSONB array, so it is filtered in Node rather than contorting the SQL.
    const filtered = subject
      ? rows.filter((row) =>
          (Array.isArray(row.subjects) ? row.subjects : []).some(
            (entry) => String(entry).toLowerCase() === String(subject).toLowerCase(),
          ),
        )
      : rows;

    return asJson({ count: filtered.length, students: filtered });
  },
};

const getStudentProfile = {
  name: 'get_student_profile',
  description: 'Fetch one student record in full by student number (e.g. "STU-001") or database id.',
  roles: TEACHING_ROLES,
  input_schema: {
    type: 'object',
    properties: {
      studentId: { type: 'string', description: 'The student number or database id.' },
    },
    required: ['studentId'],
    additionalProperties: false,
  },
  handler: async ({ studentId }, { database }) => {
    const { rows } = await database.query(
      `SELECT ${STUDENT_COLUMNS} FROM students WHERE student_id = $1 OR id = $1 LIMIT 1`,
      [String(studentId)],
    );
    return rows[0] ? asJson(rows[0]) : `No student found with identifier "${studentId}".`;
  },
};

/* ------------------------------------------------------------------ performance tools ------- */

const classPerformance = {
  name: 'class_performance',
  description:
    'Aggregate recorded exam scores for a grade level or class, broken down by subject, to find ' +
    'which topics or subjects a cohort is weakest in. Use before generating remedial questions.',
  roles: TEACHING_ROLES,
  input_schema: {
    type: 'object',
    properties: {
      gradeLevel: { type: 'integer', description: 'Grade level to aggregate.' },
      classSection: { type: 'string', description: 'Optional class section within the grade.' },
      subjectId: { type: 'string', description: 'Optional subject to restrict to.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async ({ gradeLevel, classSection, subjectId }, { database }) => {
    const conditions = [];
    const values = [];

    if (gradeLevel != null) {
      values.push(Number(gradeLevel));
      conditions.push(`s.grade_level = $${values.length}`);
    }
    if (classSection) {
      values.push(String(classSection).toUpperCase());
      conditions.push(`s.class_section = $${values.length}`);
    }
    if (subjectId) {
      values.push(String(subjectId));
      conditions.push(`g.subject_id = $${values.length}`);
    }

    const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await database.query(
      `
        SELECT c.name AS subject_name,
               g.subject_id,
               COUNT(*)::int AS entries,
               AVG(g.score / NULLIF(g.max_score, 0) * 100) AS average_percent,
               MIN(g.score / NULLIF(g.max_score, 0) * 100) AS lowest_percent
        FROM gradebook_entries g
        JOIN students s ON s.id = g.student_id
        LEFT JOIN subjects_catalog c ON c.id = g.subject_id
        ${clause}
        GROUP BY c.name, g.subject_id
        ORDER BY average_percent ASC
      `,
      values,
    );

    if (rows.length === 0) {
      return 'No gradebook entries recorded for that cohort yet, so no weak topics can be identified.';
    }

    return asJson({
      cohort: { gradeLevel, classSection, subjectId },
      // Weakest first — the caller's whole reason for asking.
      subjects: rows.map((row) => ({
        subject: row.subject_name || row.subject_id || 'Unassigned',
        entries: row.entries,
        averagePercent: row.average_percent == null ? null : Number(Number(row.average_percent).toFixed(1)),
        lowestPercent: row.lowest_percent == null ? null : Number(Number(row.lowest_percent).toFixed(1)),
      })),
    });
  },
};

/* ------------------------------------------------------------------ curriculum tools -------- */

const searchCurriculum = {
  name: 'search_curriculum',
  description:
    'Search the school curriculum library (bundled Uganda NCDC and Cambridge IGCSE topic outlines ' +
    'plus any syllabus documents teachers have uploaded). Returns numbered passages. Ground every ' +
    'syllabus claim in these passages and cite them as [1], [2] and so on.',
  roles: TEACHING_ROLES,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for, e.g. "photosynthesis limiting factors".' },
      curriculum: {
        type: 'string',
        description: 'Framework id, e.g. "uganda-cbc-lower-secondary" or "cambridge-igcse".',
      },
      subject: { type: 'string', description: 'Subject name, e.g. "Biology".' },
      gradeLevel: { type: 'integer', description: 'Grade level the material is for.' },
      limit: { type: 'integer', description: 'How many passages to return. Defaults to 8.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  handler: async ({ query, curriculum, subject, gradeLevel, limit }, context) => {
    const citations = await retrieveCurriculum(context.database, {
      query,
      curriculum,
      subject,
      gradeLevel,
      limit: numberOr(limit, 8),
      httpClient: context.httpClient,
    });

    if (citations.length === 0) {
      return 'No curriculum passages matched. Say so rather than inventing syllabus content.';
    }

    // Accumulated on the context so the caller can persist and render the same numbering the model
    // was shown, which is what makes a [2] in the answer resolve to the right source in the UI.
    context.citations.push(...citations);

    return citations
      .map((citation) =>
        [
          `[${citation.citationIndex}] ${citation.title}${citation.heading ? ` — ${citation.heading}` : ''}`,
          citation.content,
        ].join('\n'),
      )
      .join('\n\n');
  },
};

const listCurriculumFrameworks = {
  name: 'list_curriculum_frameworks',
  description:
    'List the examination frameworks this school supports, with their year labels, permitted ' +
    'question types, command words and assessment objectives.',
  roles: TEACHING_ROLES,
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  handler: async () =>
    asJson(
      getPublicCurriculumFrameworks().map((framework) => ({
        id: framework.id,
        label: framework.label,
        examBody: framework.examBody,
        yearLabels: framework.yearLabels,
        questionTypes: framework.questionTypes,
        assessmentObjectives: framework.assessmentObjectives,
      })),
    ),
};

const describeCurriculumYear = {
  name: 'describe_curriculum_year',
  description:
    'Resolve a numeric grade level into the year label a curriculum uses (grade 10 is "S3" under ' +
    'the Uganda framework and "Year 10" under IGCSE) and return that framework\'s conventions.',
  roles: TEACHING_ROLES,
  input_schema: {
    type: 'object',
    properties: {
      curriculum: { type: 'string', description: 'Framework id.' },
      gradeLevel: { type: 'integer', description: 'Numeric grade level as stored on the student record.' },
    },
    required: ['gradeLevel'],
    additionalProperties: false,
  },
  handler: async ({ curriculum, gradeLevel }) => {
    const framework = resolveFramework({ curriculum, gradeLevel });
    return asJson({
      framework: framework.id,
      label: framework.label,
      yearLabel: yearLabelFor(framework, gradeLevel),
      commandWords: framework.commandWords,
      questionTypes: framework.questionTypes,
      marksConventions: framework.marksConventions,
    });
  },
};

/* -------------------------------------------------------------------- timetable tool -------- */

const getTimetable = {
  name: 'get_timetable',
  description: 'Fetch the timetable for a class or teacher, to see how many periods a topic can span.',
  roles: TEACHING_ROLES,
  input_schema: {
    type: 'object',
    properties: {
      classId: { type: 'string', description: 'Class id to fetch the timetable for.' },
      teacherId: { type: 'string', description: 'Teacher id to fetch the timetable for.' },
      academicYear: { type: 'string' },
      term: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async ({ classId, teacherId, academicYear, term }, { database }) => {
    const conditions = [];
    const values = [];

    for (const [column, value] of [
      ['t.class_id', classId],
      ['t.teacher_id', teacherId],
      ['t.academic_year', academicYear],
      ['t.term', term],
    ]) {
      if (value) {
        values.push(String(value));
        conditions.push(`${column} = $${values.length}`);
      }
    }

    const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await database.query(
      `
        SELECT t.day_of_week, t.start_time, t.end_time, t.room,
               c.name AS subject_name, cl.grade_level, cl.section_name
        FROM timetables t
        LEFT JOIN subjects_catalog c ON c.id = t.subject_id
        LEFT JOIN classes cl ON cl.id = t.class_id
        ${clause}
        ORDER BY t.day_of_week, t.start_time
        LIMIT 100
      `,
      values,
    );

    return rows.length > 0 ? asJson(rows) : 'No timetable entries match that filter.';
  },
};

const BUILT_IN_TOOLS = [
  searchStudents,
  getStudentProfile,
  classPerformance,
  searchCurriculum,
  listCurriculumFrameworks,
  describeCurriculumYear,
  getTimetable,
];

export const listBuiltInTools = () => BUILT_IN_TOOLS;

/**
 * Assembles the tool set for one request.
 *
 * `extraTools` is where the Digital Examiner injects its `submit_questions` tool and where MCP
 * discovery injects remote tools. MCP tools carry no `roles`, so they are gated purely by the
 * caller having been allowed to select that server in the first place.
 */
export const buildToolRegistry = ({ requesterRole, extraTools = [], includeBuiltIns = true } = {}) => {
  const builtIns = includeBuiltIns
    ? BUILT_IN_TOOLS.filter((tool) => !tool.roles || tool.roles.includes(requesterRole))
    : [];

  const all = [...builtIns, ...extraTools];
  const byName = new Map(all.map((tool) => [tool.name, tool]));

  return {
    // What the model is shown — handlers and role metadata deliberately stripped.
    definitions: all.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
    get: (name) => byName.get(name) || null,
    names: [...byName.keys()],
  };
};
