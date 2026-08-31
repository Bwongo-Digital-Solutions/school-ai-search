/**
 * Curriculum framework registry — the *structure* of an examination system, not its syllabus prose.
 *
 * A framework says how a paper is shaped for a given curriculum: which years it covers, what
 * question types and command words that examiner uses, which assessment objectives a question can
 * be tagged against, and how marks are conventionally distributed. The Lesson Planner and the
 * Digital Examiner read it to constrain generation; the actual syllabus content that grounds a
 * question comes from the RAG corpus in server/rag/, never from here.
 *
 * Deliberately shaped like server/reports/grading-config.mjs: presets in an array, an env override
 * (SCHOOL_CURRICULUM_FRAMEWORKS) for schools that follow something we do not ship, and a resolver
 * that degrades to a sane default rather than throwing. The two pair up — 'uganda-cbc' here lines
 * up with the 'uganda-cbc' grading scale there.
 */

const DEFAULT_CURRICULUM = 'cambridge-igcse';
const DEFAULT_LEVEL = 'secondary';

// Bloom levels are shared across every framework: they describe the cognitive demand of a question
// independently of who is examining it, and the Digital Examiner's bloom_mix is expressed in them.
export const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];

export const DIFFICULTY_LEVELS = ['easy', 'moderate', 'challenging'];

export const ASSESSMENT_TYPES = ['quiz', 'assignment', 'test', 'exam', 'mock'];

const createFramework = ({
  id,
  label,
  country,
  academicLevel,
  examBody,
  yearLabels,
  startGrade,
  questionTypes,
  commandWords,
  assessmentObjectives,
  paperStructures,
  marksConventions,
  gradingCountry,
  notes = '',
}) => ({
  id,
  label,
  country,
  academicLevel,
  examBody,
  yearLabels,
  // The numeric grade_level that yearLabels[0] corresponds to. It has to be declared per framework
  // rather than derived from the level: a UK "Year 10" *is* grade 10, while Uganda's S1 begins at
  // grade 8, so the same stored grade reads differently under each.
  startGrade,
  questionTypes,
  commandWords,
  assessmentObjectives,
  paperStructures,
  marksConventions,
  // Which grading-config.mjs country key report cards should use for this curriculum, so a school
  // that teaches the CBC syllabus also marks on the CBC scale without configuring it twice.
  gradingCountry: gradingCountry || country,
  notes,
});

const PRESET_FRAMEWORKS = [
  createFramework({
    id: 'uganda-cbc-lower-secondary',
    label: 'Uganda Lower Secondary (NCDC Competency-Based, UCE)',
    country: 'uganda',
    gradingCountry: 'uganda-cbc',
    academicLevel: 'secondary',
    examBody: 'UNEB / NCDC',
    yearLabels: ['S1', 'S2', 'S3', 'S4'],
    startGrade: 8,
    questionTypes: ['mcq', 'short_answer', 'structured', 'essay', 'practical', 'project'],
    commandWords: [
      'state', 'identify', 'describe', 'explain', 'outline', 'compare', 'analyse',
      'evaluate', 'suggest', 'justify', 'design', 'investigate', 'demonstrate',
    ],
    assessmentObjectives: [
      { code: 'KU', label: 'Knowledge and Understanding', weight: 0.3 },
      { code: 'AS', label: 'Application of Skills', weight: 0.4 },
      { code: 'GS', label: 'Generic Skills and Values', weight: 0.3 },
    ],
    paperStructures: [
      {
        label: 'Paper 1',
        durationMinutes: 150,
        totalMarks: 100,
        sections: [
          { label: 'Section A', instructions: 'Answer all questions.', questionCount: 10, marksEach: 4 },
          { label: 'Section B', instructions: 'Answer any three questions.', questionCount: 5, chooseN: 3, marksEach: 20 },
        ],
      },
    ],
    marksConventions: {
      defaultTotal: 100,
      mcqMarks: 1,
      shortAnswerMarks: 4,
      structuredMarks: 10,
      essayMarks: 20,
    },
    notes:
      'Competency-based: questions should sit in a real-world scenario and assess a learning ' +
      'outcome, not recall alone. The Activity of Integration is the signature task type.',
  }),
  createFramework({
    id: 'uganda-uace',
    label: 'Uganda Advanced Level (UACE)',
    country: 'uganda',
    academicLevel: 'secondary',
    examBody: 'UNEB',
    yearLabels: ['S5', 'S6'],
    startGrade: 12,
    questionTypes: ['structured', 'essay', 'practical', 'data_response'],
    commandWords: [
      'define', 'describe', 'explain', 'discuss', 'account for', 'compare and contrast',
      'evaluate', 'assess', 'derive', 'prove', 'calculate', 'sketch',
    ],
    assessmentObjectives: [
      { code: 'AO1', label: 'Knowledge and Understanding', weight: 0.3 },
      { code: 'AO2', label: 'Application and Analysis', weight: 0.45 },
      { code: 'AO3', label: 'Synthesis and Evaluation', weight: 0.25 },
    ],
    paperStructures: [
      {
        label: 'Paper 1',
        durationMinutes: 180,
        totalMarks: 100,
        sections: [
          { label: 'Section A', instructions: 'Answer all questions.', questionCount: 4, marksEach: 10 },
          { label: 'Section B', instructions: 'Answer any three questions.', questionCount: 6, chooseN: 3, marksEach: 20 },
        ],
      },
    ],
    marksConventions: {
      defaultTotal: 100,
      structuredMarks: 10,
      essayMarks: 20,
      dataResponseMarks: 15,
    },
  }),
  createFramework({
    id: 'uganda-primary',
    label: 'Uganda Primary (NCDC, PLE)',
    country: 'uganda',
    academicLevel: 'primary',
    examBody: 'UNEB',
    yearLabels: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
    startGrade: 1,
    questionTypes: ['mcq', 'short_answer', 'fill_in_the_blank', 'structured'],
    commandWords: ['name', 'list', 'state', 'write', 'draw', 'calculate', 'complete', 'match', 'explain'],
    assessmentObjectives: [
      { code: 'KU', label: 'Knowledge and Understanding', weight: 0.5 },
      { code: 'AS', label: 'Application of Skills', weight: 0.5 },
    ],
    paperStructures: [
      {
        label: 'Paper 1',
        durationMinutes: 135,
        totalMarks: 100,
        sections: [
          { label: 'Section A', instructions: 'Answer all questions.', questionCount: 40, marksEach: 1 },
          { label: 'Section B', instructions: 'Answer all questions.', questionCount: 12, marksEach: 5 },
        ],
      },
    ],
    marksConventions: {
      defaultTotal: 100,
      mcqMarks: 1,
      shortAnswerMarks: 2,
      structuredMarks: 5,
    },
  }),
  createFramework({
    id: 'cambridge-igcse',
    label: 'Cambridge IGCSE (International GCSE)',
    country: 'international',
    gradingCountry: 'international',
    academicLevel: 'secondary',
    examBody: 'Cambridge Assessment International Education',
    yearLabels: ['Year 9', 'Year 10', 'Year 11'],
    startGrade: 9,
    questionTypes: ['mcq', 'short_answer', 'structured', 'essay', 'practical', 'data_response'],
    commandWords: [
      'state', 'define', 'describe', 'explain', 'calculate', 'determine', 'suggest',
      'compare', 'analyse', 'evaluate', 'justify', 'discuss', 'predict', 'sketch', 'identify',
    ],
    assessmentObjectives: [
      { code: 'AO1', label: 'Knowledge with Understanding', weight: 0.5 },
      { code: 'AO2', label: 'Handling Information and Problem Solving', weight: 0.3 },
      { code: 'AO3', label: 'Experimental Skills and Investigations', weight: 0.2 },
    ],
    paperStructures: [
      {
        label: 'Paper 1 (Multiple Choice)',
        durationMinutes: 45,
        totalMarks: 40,
        sections: [{ label: 'Section A', instructions: 'Answer all questions.', questionCount: 40, marksEach: 1 }],
      },
      {
        label: 'Paper 2 (Theory)',
        durationMinutes: 75,
        totalMarks: 80,
        sections: [{ label: 'Section A', instructions: 'Answer all questions.', questionCount: 8, marksEach: 10 }],
      },
    ],
    marksConventions: {
      defaultTotal: 80,
      mcqMarks: 1,
      shortAnswerMarks: 3,
      structuredMarks: 10,
      essayMarks: 15,
    },
    notes:
      'Command words carry fixed meanings and drive the mark scheme; a question tagged "explain" ' +
      'must be markable point-by-point. Grades run 9-1 or A*-G depending on the series.',
  }),
  createFramework({
    id: 'edexcel-international-gcse',
    label: 'Pearson Edexcel International GCSE',
    country: 'international',
    gradingCountry: 'international',
    academicLevel: 'secondary',
    examBody: 'Pearson Edexcel',
    yearLabels: ['Year 9', 'Year 10', 'Year 11'],
    startGrade: 9,
    questionTypes: ['mcq', 'short_answer', 'structured', 'essay', 'data_response'],
    commandWords: [
      'state', 'give', 'describe', 'explain', 'calculate', 'deduce', 'compare',
      'analyse', 'evaluate', 'assess', 'justify', 'comment on', 'draw',
    ],
    assessmentObjectives: [
      { code: 'AO1', label: 'Demonstrate Knowledge and Understanding', weight: 0.45 },
      { code: 'AO2', label: 'Apply Knowledge and Understanding', weight: 0.35 },
      { code: 'AO3', label: 'Analyse and Evaluate Evidence', weight: 0.2 },
    ],
    paperStructures: [
      {
        label: 'Paper 1',
        durationMinutes: 120,
        totalMarks: 100,
        sections: [{ label: 'Section A', instructions: 'Answer all questions.', questionCount: 10, marksEach: 10 }],
      },
    ],
    marksConventions: {
      defaultTotal: 100,
      mcqMarks: 1,
      shortAnswerMarks: 3,
      structuredMarks: 10,
      essayMarks: 15,
    },
  }),
];

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

const parseCustomFrameworks = () => {
  if (!process.env.SCHOOL_CURRICULUM_FRAMEWORKS) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env.SCHOOL_CURRICULUM_FRAMEWORKS);
    const frameworks = Array.isArray(parsed) ? parsed : parsed.frameworks;
    if (!Array.isArray(frameworks)) {
      return [];
    }

    return frameworks
      .filter((framework) => framework?.id && framework?.label)
      .map((framework) =>
        createFramework({
          id: normalizeKey(framework.id),
          label: String(framework.label),
          country: normalizeKey(framework.country || 'international'),
          gradingCountry: framework.gradingCountry ? normalizeKey(framework.gradingCountry) : null,
          academicLevel: normalizeKey(framework.academicLevel || DEFAULT_LEVEL),
          examBody: String(framework.examBody || ''),
          yearLabels: Array.isArray(framework.yearLabels) ? framework.yearLabels.map(String) : [],
          startGrade: Number.isFinite(Number(framework.startGrade)) ? Number(framework.startGrade) : 1,
          questionTypes: Array.isArray(framework.questionTypes) ? framework.questionTypes.map(normalizeKey) : [],
          commandWords: Array.isArray(framework.commandWords) ? framework.commandWords.map(String) : [],
          assessmentObjectives: Array.isArray(framework.assessmentObjectives)
            ? framework.assessmentObjectives
            : [],
          paperStructures: Array.isArray(framework.paperStructures) ? framework.paperStructures : [],
          marksConventions: framework.marksConventions || {},
          notes: String(framework.notes || ''),
        }),
      );
  } catch (error) {
    console.warn(
      'Invalid SCHOOL_CURRICULUM_FRAMEWORKS JSON:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
};

export const getCurriculumFrameworks = () => [...PRESET_FRAMEWORKS, ...parseCustomFrameworks()];

/**
 * The catalogue the browser sees. Everything a framework holds is safe to publish — it is
 * examination structure, not credentials — so this returns the whole object rather than a subset,
 * letting the Blueprint form render command words and paper shapes without a second round trip.
 */
export const getPublicCurriculumFrameworks = () => getCurriculumFrameworks();

/**
 * Maps a numeric grade_level onto the year label a framework uses, so a student stored as
 * grade_level 9 reads as 'S3' under the Uganda CBC framework and 'Year 9' under IGCSE.
 *
 * Uganda secondary starts at S1 = grade 8, matching the primary P1-P7 = grades 1-7 convention that
 * inferAcademicLevel() in grading-config.mjs already assumes.
 */
export const yearLabelFor = (framework, gradeLevel) => {
  const grade = Number(gradeLevel);
  if (!framework || !Number.isFinite(grade) || framework.yearLabels.length === 0) {
    return String(gradeLevel ?? '');
  }

  const index = grade - Number(framework.startGrade ?? 1);
  // A grade outside the framework's range clamps to its nearest year rather than returning
  // undefined: a school teaching an S4 syllabus to a repeating S5 cohort still gets a usable label.
  const clamped = Math.min(Math.max(index, 0), framework.yearLabels.length - 1);
  return framework.yearLabels[clamped];
};

const inferAcademicLevel = (gradeLevel) => {
  const grade = Number(gradeLevel);
  if (!Number.isFinite(grade)) return DEFAULT_LEVEL;
  if (grade <= 0) return 'nursery';
  if (grade <= 7) return 'primary';
  return 'secondary';
};

/**
 * Resolves a framework by explicit id first, then by country plus level, then the house default.
 * Never returns null — the Examiner always needs something to constrain generation against.
 */
export const resolveFramework = ({ curriculum, academicLevel, gradeLevel } = {}) => {
  const frameworks = getCurriculumFrameworks();
  const requested = normalizeKey(curriculum || process.env.SCHOOL_CURRICULUM || '');

  const byId = frameworks.find((framework) => framework.id === requested);
  if (byId) return byId;

  const resolvedLevel = normalizeKey(academicLevel || inferAcademicLevel(gradeLevel));
  const byCountry = frameworks.find(
    (framework) => framework.country === requested && framework.academicLevel === resolvedLevel,
  );
  if (byCountry) return byCountry;

  return (
    frameworks.find((framework) => framework.id === DEFAULT_CURRICULUM) ||
    frameworks[0]
  );
};

/**
 * A compact prose description of the framework for a model's system prompt. Kept here rather than
 * in the prompt builders so the Lesson Planner and the Digital Examiner describe a curriculum in
 * exactly the same words.
 */
export const describeFramework = (framework, { gradeLevel } = {}) => {
  if (!framework) return '';

  const objectives = framework.assessmentObjectives
    .map((objective) => `${objective.code} ${objective.label} (~${Math.round(objective.weight * 100)}%)`)
    .join('; ');

  return [
    `Curriculum: ${framework.label}`,
    framework.examBody ? `Examining body: ${framework.examBody}` : null,
    gradeLevel != null ? `Year / class: ${yearLabelFor(framework, gradeLevel)}` : null,
    `Permitted question types: ${framework.questionTypes.join(', ')}`,
    `Command words to draw on: ${framework.commandWords.join(', ')}`,
    objectives ? `Assessment objectives: ${objectives}` : null,
    framework.notes ? `Examiner conventions: ${framework.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};
