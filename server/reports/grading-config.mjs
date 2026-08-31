/**
 * Grading schemes, and how a school's level chooses between them.
 *
 * An administrator sets the school's level once under Settings (pre-school through university) and
 * the grading system follows from it, so nobody picks a scale per report card:
 *
 *   pre-school / kindergarten  ->  developmental descriptors, no marks
 *   primary                    ->  PLE aggregate points and divisions
 *   secondary, S1-S4           ->  UCE aggregate points and divisions
 *   secondary, S5-S6           ->  UACE principal letter grades A-F and principal points
 *   technical                  ->  Distinction / Credit / Pass
 *   tertiary / university      ->  GPA
 *
 * One school level can therefore resolve to two different scales: a secondary school teaches both
 * O-Level and A-Level, so the student's own grade decides which of the two applies.
 *
 * Uganda's bands follow UNEB practice as documented at
 * https://www.scholaro.com/db/countries/Uganda/Grading-System. UNEB grades are awarded on subject
 * points and division bands rather than flat percentage cut-offs, so the percentage `min` values
 * below are indicative — the points, divisions and letters are the parts that matter, and any
 * school can override the whole table with SCHOOL_GRADING_SCHEMES.
 */

const DEFAULT_COUNTRY = 'international';
const DEFAULT_LEVEL = 'secondary';

/**
 * The school levels an administrator can choose. `value` is what is stored in school_settings.
 */
export const SCHOOL_LEVELS = [
  { value: 'pre_school', label: 'Pre-school' },
  { value: 'kindergarten', label: 'Kindergarten / Nursery' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary (O-Level and A-Level)' },
  { value: 'technical', label: 'Technical / Vocational' },
  { value: 'tertiary', label: 'Tertiary / University' },
];

export const SCHOOL_LEVEL_VALUES = SCHOOL_LEVELS.map((level) => level.value);

const createScheme = ({ country, academicLevel, label, scale, aggregate = null, notes = '' }) => ({
  country,
  academicLevel,
  label,
  // Sorted high-to-low so gradeScore can take the first band a score reaches.
  scale: [...scale].sort((a, b) => b.min - a.min),
  // How individual subject results roll up into one headline figure: an aggregate and division, a
  // principal-points total, or a GPA. Null for scales that have no such concept.
  aggregate,
  notes,
});

const PRESET_SCHEMES = [
  /* ------------------------------------------------------------------ early years ------------ */
  createScheme({
    country: 'international',
    academicLevel: 'pre-school',
    label: 'Pre-school Development Scale',
    scale: [
      { min: 85, grade: 'Exceeding', remark: 'Exceeding Expectations' },
      { min: 70, grade: 'Meeting', remark: 'Meeting Expectations' },
      { min: 55, grade: 'Approaching', remark: 'Approaching Expectations' },
      { min: 0, grade: 'Emerging', remark: 'Needs Guided Support' },
    ],
    notes: 'Early years are reported as development descriptors; no marks, aggregate or GPA is produced.',
  }),
  createScheme({
    country: 'international',
    academicLevel: 'kindergarten',
    label: 'Kindergarten / Nursery Development Scale',
    scale: [
      { min: 85, grade: 'Exceeding', remark: 'Exceeding Expectations' },
      { min: 70, grade: 'Meeting', remark: 'Meeting Expectations' },
      { min: 55, grade: 'Approaching', remark: 'Approaching Expectations' },
      { min: 0, grade: 'Emerging', remark: 'Needs Guided Support' },
    ],
  }),
  // Retained under its original key so databases and requests that already say 'nursery' keep working.
  createScheme({
    country: 'international',
    academicLevel: 'nursery',
    label: 'International Nursery Development Scale',
    scale: [
      { min: 85, grade: 'Exceeding', remark: 'Exceeding Expectations' },
      { min: 70, grade: 'Meeting', remark: 'Meeting Expectations' },
      { min: 55, grade: 'Approaching', remark: 'Approaching Expectations' },
      { min: 0, grade: 'Emerging', remark: 'Needs Guided Support' },
    ],
  }),
  createScheme({
    country: 'uganda',
    academicLevel: 'pre-school',
    label: 'Uganda Pre-school Development Scale',
    scale: [
      { min: 85, grade: 'Exceeding', remark: 'Exceeding Expectations' },
      { min: 70, grade: 'Meeting', remark: 'Meeting Expectations' },
      { min: 55, grade: 'Approaching', remark: 'Approaching Expectations' },
      { min: 0, grade: 'Emerging', remark: 'Needs Guided Support' },
    ],
  }),
  createScheme({
    country: 'uganda',
    academicLevel: 'kindergarten',
    label: 'Uganda Kindergarten / Nursery Development Scale',
    scale: [
      { min: 85, grade: 'Exceeding', remark: 'Exceeding Expectations' },
      { min: 70, grade: 'Meeting', remark: 'Meeting Expectations' },
      { min: 55, grade: 'Approaching', remark: 'Approaching Expectations' },
      { min: 0, grade: 'Emerging', remark: 'Needs Guided Support' },
    ],
  }),

  /* --------------------------------------------------------------------- primary ------------- */
  createScheme({
    country: 'international',
    academicLevel: 'primary',
    label: 'International Primary Scale',
    scale: [
      { min: 90, grade: 'A', remark: 'Excellent' },
      { min: 80, grade: 'B', remark: 'Very Good' },
      { min: 70, grade: 'C', remark: 'Good' },
      { min: 60, grade: 'D', remark: 'Fair' },
      { min: 0, grade: 'E', remark: 'Needs Support' },
    ],
  }),
  // PLE: four examinable subjects, each scored 1-9, summed into an aggregate of 4-36 where a lower
  // total is better. The division bands below are the ones UNEB publishes for the PLE aggregate.
  createScheme({
    country: 'uganda',
    academicLevel: 'primary',
    label: 'Uganda Primary Leaving Examination (PLE)',
    scale: [
      { min: 90, grade: 'D1', remark: 'Distinction', points: 1 },
      { min: 80, grade: 'D2', remark: 'Distinction', points: 2 },
      { min: 70, grade: 'C3', remark: 'Credit', points: 3 },
      { min: 60, grade: 'C4', remark: 'Credit', points: 4 },
      { min: 50, grade: 'C5', remark: 'Credit', points: 5 },
      { min: 45, grade: 'C6', remark: 'Credit', points: 6 },
      { min: 40, grade: 'P7', remark: 'Pass', points: 7 },
      { min: 35, grade: 'P8', remark: 'Pass', points: 8 },
      { min: 0, grade: 'F9', remark: 'Fail', points: 9 },
    ],
    aggregate: {
      kind: 'points-total',
      direction: 'lower-better',
      subjects: 4,
      label: 'Aggregate',
      bandLabel: 'Division',
      bands: [
        { max: 12, label: 'Division 1' },
        { max: 23, label: 'Division 2' },
        { max: 29, label: 'Division 3' },
        { max: 34, label: 'Division 4' },
        { max: Infinity, label: 'Ungraded (U)' },
      ],
    },
    notes: 'Aggregate is the sum of the four examinable subjects; a lower aggregate is better.',
  }),

  /* ---------------------------------------------------------- secondary: O-Level ------------- */
  createScheme({
    country: 'international',
    academicLevel: 'secondary',
    label: 'International Secondary Scale',
    scale: [
      { min: 90, grade: 'A', remark: 'Excellent' },
      { min: 80, grade: 'B', remark: 'Very Good' },
      { min: 70, grade: 'C', remark: 'Good' },
      { min: 60, grade: 'D', remark: 'Fair' },
      { min: 0, grade: 'F', remark: 'Needs Support' },
    ],
  }),
  // Retained: the classic UNEB O-Level table under its original 'secondary' key, so anything that
  // already asks for uganda/secondary keeps resolving exactly as before.
  createScheme({
    country: 'uganda',
    academicLevel: 'secondary',
    label: 'Uganda Secondary UNEB Scale',
    scale: [
      { min: 90, grade: 'D1', remark: 'Excellent', points: 1 },
      { min: 80, grade: 'D2', remark: 'Very Good', points: 2 },
      { min: 70, grade: 'C3', remark: 'Good', points: 3 },
      { min: 60, grade: 'C4', remark: 'Credit', points: 4 },
      { min: 50, grade: 'C5', remark: 'Credit', points: 5 },
      { min: 45, grade: 'C6', remark: 'Credit', points: 6 },
      { min: 40, grade: 'P7', remark: 'Pass', points: 7 },
      { min: 35, grade: 'P8', remark: 'Basic Pass', points: 8 },
      { min: 0, grade: 'F9', remark: 'Needs Support', points: 9 },
    ],
  }),
  // UCE (Senior 1-4): the numerical aggregate point system. Each subject scores 1-9, the best eight
  // are summed, and the total falls into a division. A lower aggregate is better.
  createScheme({
    country: 'uganda',
    academicLevel: 'secondary-o',
    label: 'Uganda O-Level (UCE) Aggregate Points',
    scale: [
      { min: 90, grade: 'D1', remark: 'Distinction', points: 1 },
      { min: 80, grade: 'D2', remark: 'Distinction', points: 2 },
      { min: 70, grade: 'C3', remark: 'Credit', points: 3 },
      { min: 60, grade: 'C4', remark: 'Credit', points: 4 },
      { min: 50, grade: 'C5', remark: 'Credit', points: 5 },
      { min: 45, grade: 'C6', remark: 'Credit', points: 6 },
      { min: 40, grade: 'P7', remark: 'Pass', points: 7 },
      { min: 35, grade: 'P8', remark: 'Pass', points: 8 },
      { min: 0, grade: 'F9', remark: 'Fail', points: 9 },
    ],
    aggregate: {
      kind: 'points-total',
      direction: 'lower-better',
      subjects: 8,
      label: 'Aggregate',
      bandLabel: 'Division',
      bands: [
        { max: 32, label: 'Division 1' },
        { max: 45, label: 'Division 2' },
        { max: 58, label: 'Division 3' },
        { max: 72, label: 'Division 4' },
        { max: Infinity, label: 'Division 9 (Ungraded)' },
      ],
    },
    notes:
      'Aggregate is the sum of the best eight subjects; a lower aggregate is better. UNEB also ' +
      'requires passes in particular subjects for the top divisions, which this table does not model.',
  }),

  /* ---------------------------------------------------------- secondary: A-Level ------------- */
  // UACE (Senior 5-6): principal subjects carry a letter grade A-F worth 6 points down to 0, and a
  // candidate's principal points are the sum across their principal subjects. Higher is better.
  createScheme({
    country: 'uganda',
    academicLevel: 'secondary-a',
    label: 'Uganda A-Level (UACE) Principal Grades',
    scale: [
      { min: 80, grade: 'A', remark: 'Excellent', points: 6 },
      { min: 70, grade: 'B', remark: 'Very Good', points: 5 },
      { min: 60, grade: 'C', remark: 'Good', points: 4 },
      { min: 50, grade: 'D', remark: 'Satisfactory', points: 3 },
      { min: 40, grade: 'E', remark: 'Pass', points: 2 },
      { min: 35, grade: 'O', remark: 'Subsidiary Pass', points: 1 },
      { min: 0, grade: 'F', remark: 'Fail', points: 0 },
    ],
    aggregate: {
      kind: 'points-total',
      direction: 'higher-better',
      subjects: 3,
      label: 'Principal points',
      maxPerSubject: 6,
    },
    notes:
      'Principal points are the sum across three principal subjects (A=6 down to F=0), so 18 is the ' +
      'maximum. O is a subsidiary pass.',
  }),

  /* ------------------------------------------------------------------- technical ------------- */
  createScheme({
    country: 'uganda',
    academicLevel: 'technical',
    label: 'Uganda Technical / Vocational (UBTEB)',
    scale: [
      { min: 80, grade: 'Distinction', remark: 'Distinction' },
      { min: 60, grade: 'Credit', remark: 'Credit' },
      { min: 50, grade: 'Pass', remark: 'Pass' },
      { min: 0, grade: 'Fail', remark: 'Fail' },
    ],
  }),
  createScheme({
    country: 'international',
    academicLevel: 'technical',
    label: 'International Technical / Vocational Scale',
    scale: [
      { min: 80, grade: 'Distinction', remark: 'Distinction' },
      { min: 65, grade: 'Merit', remark: 'Merit' },
      { min: 50, grade: 'Pass', remark: 'Pass' },
      { min: 0, grade: 'Fail', remark: 'Fail' },
    ],
  }),

  /* ------------------------------------------------------- tertiary / university ------------- */
  // Uganda universities grade on a five-point GPA; these bands follow the Makerere scale, which
  // most Ugandan institutions mirror.
  createScheme({
    country: 'uganda',
    academicLevel: 'tertiary',
    label: 'Uganda University GPA (5.0 scale)',
    scale: [
      { min: 80, grade: 'A', remark: 'Excellent', points: 5.0 },
      { min: 75, grade: 'B+', remark: 'Very Good', points: 4.5 },
      { min: 70, grade: 'B', remark: 'Good', points: 4.0 },
      { min: 65, grade: 'C+', remark: 'Fairly Good', points: 3.5 },
      { min: 60, grade: 'C', remark: 'Average', points: 3.0 },
      { min: 55, grade: 'D+', remark: 'Below Average', points: 2.5 },
      { min: 50, grade: 'D', remark: 'Marginal Pass', points: 2.0 },
      { min: 45, grade: 'E', remark: 'Marginal Fail', points: 1.5 },
      { min: 40, grade: 'E-', remark: 'Clear Fail', points: 1.0 },
      { min: 0, grade: 'F', remark: 'Fail', points: 0 },
    ],
    aggregate: {
      kind: 'gpa',
      label: 'GPA',
      scaleMax: 5,
      bandLabel: 'Class',
      bands: [
        { min: 4.4, label: 'First Class' },
        { min: 3.6, label: 'Second Class (Upper)' },
        { min: 2.8, label: 'Second Class (Lower)' },
        { min: 2.0, label: 'Pass' },
        { min: 0, label: 'Fail' },
      ],
    },
  }),
  createScheme({
    country: 'uganda',
    academicLevel: 'university',
    label: 'Uganda University GPA (5.0 scale)',
    scale: [
      { min: 80, grade: 'A', remark: 'Excellent', points: 5.0 },
      { min: 75, grade: 'B+', remark: 'Very Good', points: 4.5 },
      { min: 70, grade: 'B', remark: 'Good', points: 4.0 },
      { min: 65, grade: 'C+', remark: 'Fairly Good', points: 3.5 },
      { min: 60, grade: 'C', remark: 'Average', points: 3.0 },
      { min: 55, grade: 'D+', remark: 'Below Average', points: 2.5 },
      { min: 50, grade: 'D', remark: 'Marginal Pass', points: 2.0 },
      { min: 45, grade: 'E', remark: 'Marginal Fail', points: 1.5 },
      { min: 40, grade: 'E-', remark: 'Clear Fail', points: 1.0 },
      { min: 0, grade: 'F', remark: 'Fail', points: 0 },
    ],
    aggregate: {
      kind: 'gpa',
      label: 'GPA',
      scaleMax: 5,
      bandLabel: 'Class',
      bands: [
        { min: 4.4, label: 'First Class' },
        { min: 3.6, label: 'Second Class (Upper)' },
        { min: 2.8, label: 'Second Class (Lower)' },
        { min: 2.0, label: 'Pass' },
        { min: 0, label: 'Fail' },
      ],
    },
  }),
  // International and other non-Ugandan institutions report on the familiar four-point GPA.
  createScheme({
    country: 'international',
    academicLevel: 'tertiary',
    label: 'International Tertiary GPA (4.0 scale)',
    scale: [
      { min: 93, grade: 'A', remark: 'Excellent', points: 4.0 },
      { min: 90, grade: 'A-', remark: 'Excellent', points: 3.7 },
      { min: 87, grade: 'B+', remark: 'Very Good', points: 3.3 },
      { min: 83, grade: 'B', remark: 'Good', points: 3.0 },
      { min: 80, grade: 'B-', remark: 'Good', points: 2.7 },
      { min: 77, grade: 'C+', remark: 'Satisfactory', points: 2.3 },
      { min: 73, grade: 'C', remark: 'Satisfactory', points: 2.0 },
      { min: 70, grade: 'C-', remark: 'Pass', points: 1.7 },
      { min: 60, grade: 'D', remark: 'Minimum Pass', points: 1.0 },
      { min: 0, grade: 'F', remark: 'Fail', points: 0 },
    ],
    aggregate: {
      kind: 'gpa',
      label: 'GPA',
      scaleMax: 4,
      bandLabel: 'Standing',
      bands: [
        { min: 3.5, label: 'Distinction' },
        { min: 3.0, label: 'Merit' },
        { min: 2.0, label: 'Good Standing' },
        { min: 0, label: 'Below Standing' },
      ],
    },
  }),
  createScheme({
    country: 'international',
    academicLevel: 'university',
    label: 'International University GPA (4.0 scale)',
    scale: [
      { min: 93, grade: 'A', remark: 'Excellent', points: 4.0 },
      { min: 90, grade: 'A-', remark: 'Excellent', points: 3.7 },
      { min: 87, grade: 'B+', remark: 'Very Good', points: 3.3 },
      { min: 83, grade: 'B', remark: 'Good', points: 3.0 },
      { min: 80, grade: 'B-', remark: 'Good', points: 2.7 },
      { min: 77, grade: 'C+', remark: 'Satisfactory', points: 2.3 },
      { min: 73, grade: 'C', remark: 'Satisfactory', points: 2.0 },
      { min: 70, grade: 'C-', remark: 'Pass', points: 1.7 },
      { min: 60, grade: 'D', remark: 'Minimum Pass', points: 1.0 },
      { min: 0, grade: 'F', remark: 'Fail', points: 0 },
    ],
    aggregate: {
      kind: 'gpa',
      label: 'GPA',
      scaleMax: 4,
      bandLabel: 'Standing',
      bands: [
        { min: 3.5, label: 'Distinction' },
        { min: 3.0, label: 'Merit' },
        { min: 2.0, label: 'Good Standing' },
        { min: 0, label: 'Below Standing' },
      ],
    },
  }),

  /* ----------------------------------------------------------- competency-based -------------- */
  // Uganda's competency-based curriculum (new lower secondary, first UCE examined 2024) reports
  // each subject on an A-E achievement scale, with NCDC's competency descriptors
  // (Outstanding / Moderate / Basic) in the remark. This is a separate 'uganda-cbc' system so the
  // classic D1-F9 scale above stays available for schools that still use it. The exact SBA + final
  // weighting UNEB applies is not a flat percentage, so these band cut-offs are indicative and can
  // be overridden via SCHOOL_GRADING_SCHEMES.
  createScheme({
    country: 'uganda-cbc',
    academicLevel: 'secondary',
    label: 'Uganda Competency-Based (Lower Secondary, UCE)',
    scale: [
      { min: 80, grade: 'A', remark: 'Outstanding' },
      { min: 70, grade: 'B', remark: 'Moderate — Strong' },
      { min: 60, grade: 'C', remark: 'Moderate' },
      { min: 50, grade: 'D', remark: 'Basic' },
      { min: 0, grade: 'E', remark: 'Elementary — Needs Support' },
    ],
  }),
  createScheme({
    country: 'uganda-cbc',
    academicLevel: 'secondary-o',
    label: 'Uganda Competency-Based (Lower Secondary, UCE)',
    scale: [
      { min: 80, grade: 'A', remark: 'Outstanding' },
      { min: 70, grade: 'B', remark: 'Moderate — Strong' },
      { min: 60, grade: 'C', remark: 'Moderate' },
      { min: 50, grade: 'D', remark: 'Basic' },
      { min: 0, grade: 'E', remark: 'Elementary — Needs Support' },
    ],
  }),
  createScheme({
    country: 'uganda-cbc',
    academicLevel: 'primary',
    label: 'Uganda Competency-Based (Primary)',
    scale: [
      { min: 80, grade: 'A', remark: 'Outstanding' },
      { min: 70, grade: 'B', remark: 'Moderate — Strong' },
      { min: 60, grade: 'C', remark: 'Moderate' },
      { min: 50, grade: 'D', remark: 'Basic' },
      { min: 0, grade: 'E', remark: 'Elementary — Needs Support' },
    ],
  }),

  /* ------------------------------------------------------------------ other systems ---------- */
  createScheme({
    country: 'kenya',
    academicLevel: 'secondary',
    label: 'Kenya Secondary Letter Scale',
    scale: [
      { min: 80, grade: 'A', remark: 'Excellent' },
      { min: 75, grade: 'A-', remark: 'Very Good' },
      { min: 70, grade: 'B+', remark: 'Good' },
      { min: 65, grade: 'B', remark: 'Good' },
      { min: 60, grade: 'B-', remark: 'Fairly Good' },
      { min: 55, grade: 'C+', remark: 'Above Average' },
      { min: 50, grade: 'C', remark: 'Average' },
      { min: 45, grade: 'C-', remark: 'Below Average' },
      { min: 40, grade: 'D+', remark: 'Needs Improvement' },
      { min: 35, grade: 'D', remark: 'Needs Support' },
      { min: 0, grade: 'E', remark: 'Needs Intensive Support' },
    ],
  }),
  createScheme({
    country: 'united-states',
    academicLevel: 'secondary',
    label: 'United States High School Scale',
    scale: [
      { min: 93, grade: 'A', remark: 'Excellent', points: 4.0 },
      { min: 90, grade: 'A-', remark: 'Excellent', points: 3.7 },
      { min: 87, grade: 'B+', remark: 'Very Good', points: 3.3 },
      { min: 83, grade: 'B', remark: 'Good', points: 3.0 },
      { min: 80, grade: 'B-', remark: 'Good', points: 2.7 },
      { min: 77, grade: 'C+', remark: 'Satisfactory', points: 2.3 },
      { min: 73, grade: 'C', remark: 'Satisfactory', points: 2.0 },
      { min: 70, grade: 'C-', remark: 'Needs Improvement', points: 1.7 },
      { min: 60, grade: 'D', remark: 'Minimum Pass', points: 1.0 },
      { min: 0, grade: 'F', remark: 'Fail', points: 0 },
    ],
    aggregate: { kind: 'gpa', label: 'GPA', scaleMax: 4 },
  }),
  createScheme({
    country: 'united-kingdom',
    academicLevel: 'university',
    label: 'United Kingdom Degree Classification Scale',
    scale: [
      { min: 70, grade: 'First', remark: 'First Class' },
      { min: 60, grade: '2:1', remark: 'Upper Second' },
      { min: 50, grade: '2:2', remark: 'Lower Second' },
      { min: 40, grade: 'Third', remark: 'Third Class' },
      { min: 0, grade: 'Fail', remark: 'Fail' },
    ],
  }),
];

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

const parseCustomSchemes = () => {
  if (!process.env.SCHOOL_GRADING_SCHEMES) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env.SCHOOL_GRADING_SCHEMES);
    const schemes = Array.isArray(parsed) ? parsed : parsed.schemes;
    if (!Array.isArray(schemes)) {
      return [];
    }

    return schemes
      .filter((scheme) => scheme?.country && scheme?.academicLevel && Array.isArray(scheme.scale))
      .map((scheme) =>
        createScheme({
          country: normalizeKey(scheme.country),
          academicLevel: normalizeKey(scheme.academicLevel),
          label: scheme.label || `${scheme.country} ${scheme.academicLevel}`,
          scale: scheme.scale
            .filter((band) => Number.isFinite(Number(band.min)) && band.grade)
            .map((band) => ({
              min: Number(band.min),
              grade: String(band.grade),
              remark: String(band.remark || band.grade),
              ...(Number.isFinite(Number(band.points)) ? { points: Number(band.points) } : {}),
            })),
          aggregate: scheme.aggregate || null,
          notes: String(scheme.notes || ''),
        }),
      )
      .filter((scheme) => scheme.scale.length > 0);
  } catch (error) {
    console.warn('Invalid SCHOOL_GRADING_SCHEMES JSON:', error instanceof Error ? error.message : error);
    return [];
  }
};

const inferAcademicLevel = (gradeLevel) => {
  const grade = Number(gradeLevel);
  if (!Number.isFinite(grade)) {
    return DEFAULT_LEVEL;
  }
  if (grade <= 0) return 'nursery';
  if (grade <= 7) return 'primary';
  if (grade <= 13) return 'secondary';
  return 'tertiary';
};

/**
 * Maps the school's level (and, within a secondary school, the student's own grade) onto the
 * academic level a grading scheme is keyed by.
 *
 * Secondary is the case that needs the grade: one secondary school runs both O-Level and A-Level,
 * which are graded completely differently. S1-S4 sit at grade levels 8-11 and S5-S6 at 12-13,
 * matching the P1-P7 = grades 1-7 convention the rest of the app assumes.
 */
export const academicLevelFor = (schoolLevel, gradeLevel) => {
  switch (normalizeKey(schoolLevel)) {
    case 'pre-school':
      return 'pre-school';
    case 'kindergarten':
    case 'nursery':
      return 'kindergarten';
    case 'primary':
      return 'primary';
    case 'technical':
      return 'technical';
    case 'tertiary':
    case 'university':
      return 'tertiary';
    case 'secondary': {
      const grade = Number(gradeLevel);
      return Number.isFinite(grade) && grade >= 12 ? 'secondary-a' : 'secondary-o';
    }
    default:
      return inferAcademicLevel(gradeLevel);
  }
};

// Where a level has no scheme of its own for a country, try these in order before giving up. This
// is what lets a school that only defined 'secondary' still resolve an O-Level lookup.
const LEVEL_FALLBACKS = {
  'secondary-o': ['secondary'],
  'secondary-a': ['secondary'],
  'pre-school': ['kindergarten', 'nursery'],
  kindergarten: ['nursery', 'pre-school'],
  nursery: ['kindergarten'],
  technical: ['tertiary', 'secondary'],
  tertiary: ['university'],
  university: ['tertiary'],
};

export const getGradingSchemes = () => [...PRESET_SCHEMES, ...parseCustomSchemes()];

export const getPublicGradingOptions = () => {
  const seen = new Set();
  return getGradingSchemes()
    .map(({ country, academicLevel, label }) => ({ country, academicLevel, label }))
    .filter((option) => {
      const key = `${option.country}:${option.academicLevel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/**
 * Resolves the scheme to grade against.
 *
 * `schoolLevel` is what an administrator set under Settings and is the normal way in; an explicit
 * `academicLevel` still wins, so a one-off report card can override it. Never returns null — the
 * chain falls back through related levels, then the default country, so a misconfigured school
 * still produces a report card.
 */
export const resolveGradingScheme = ({ country, academicLevel, schoolLevel, gradeLevel } = {}) => {
  const schemes = getGradingSchemes();
  const resolvedCountry = normalizeKey(country || process.env.SCHOOL_GRADING_COUNTRY || DEFAULT_COUNTRY);

  const explicitLevel = academicLevel || process.env.SCHOOL_ACADEMIC_LEVEL;
  const resolvedLevel = normalizeKey(
    explicitLevel || (schoolLevel ? academicLevelFor(schoolLevel, gradeLevel) : inferAcademicLevel(gradeLevel)),
  );

  const candidateLevels = [resolvedLevel, ...(LEVEL_FALLBACKS[resolvedLevel] || [])];

  for (const level of candidateLevels) {
    const match = schemes.find((scheme) => scheme.country === resolvedCountry && scheme.academicLevel === level);
    if (match) return match;
  }

  for (const level of candidateLevels) {
    const match = schemes.find((scheme) => scheme.country === DEFAULT_COUNTRY && scheme.academicLevel === level);
    if (match) return match;
  }

  return schemes.find((scheme) => scheme.country === DEFAULT_COUNTRY && scheme.academicLevel === DEFAULT_LEVEL);
};

/**
 * Grades one score. `points` is present only for scales that carry them (UNEB aggregates, GPAs),
 * so a scale without them returns the same two fields it always did.
 */
export const gradeScore = (score, scheme) => {
  const numericScore = Number(score);
  const band = scheme.scale.find((entry) => numericScore >= entry.min) || scheme.scale[scheme.scale.length - 1];

  return {
    grade: band.grade,
    remark: band.remark,
    ...(band.points === undefined ? {} : { points: band.points }),
  };
};

const bandLabelFor = (bands, value, direction) => {
  if (!Array.isArray(bands) || bands.length === 0) return null;

  // 'lower-better' bands are declared with a `max` ceiling, 'higher-better' with a `min` floor.
  const match =
    direction === 'lower-better'
      ? bands.find((band) => value <= band.max)
      : bands.find((band) => value >= band.min);

  return match ? match.label : bands[bands.length - 1].label;
};

/**
 * Rolls per-subject results up into the one headline figure the scheme calls for: a UNEB aggregate
 * and division, a principal-points total, or a GPA.
 *
 * Returns null when the scheme has no such concept (early years, plain letter scales), so callers
 * can simply omit the row rather than printing a meaningless zero.
 */
export const summariseResults = (results, scheme) => {
  const config = scheme?.aggregate;
  if (!config || !Array.isArray(results) || results.length === 0) return null;

  const points = results
    .map((result) => (typeof result.points === 'number' ? result.points : gradeScore(result.score, scheme).points))
    .filter((value) => typeof value === 'number');

  if (points.length === 0) return null;

  if (config.kind === 'gpa') {
    const gpa = points.reduce((total, value) => total + value, 0) / points.length;
    const rounded = Number(gpa.toFixed(2));
    return {
      kind: 'gpa',
      label: config.label || 'GPA',
      value: rounded,
      display: `${rounded.toFixed(2)} / ${config.scaleMax ?? 4}`,
      subjectsCounted: points.length,
      bandLabel: config.bandLabel || null,
      band: bandLabelFor(config.bands, rounded, 'higher-better'),
    };
  }

  // points-total: take the best N subjects, where "best" depends on which direction wins.
  const lowerIsBetter = config.direction === 'lower-better';
  const ordered = [...points].sort((a, b) => (lowerIsBetter ? a - b : b - a));
  const counted = ordered.slice(0, Math.min(config.subjects || ordered.length, ordered.length));
  const total = counted.reduce((sum, value) => sum + value, 0);

  return {
    kind: 'points-total',
    label: config.label || 'Total points',
    value: total,
    display:
      lowerIsBetter || !config.maxPerSubject
        ? String(total)
        : `${total} / ${config.maxPerSubject * counted.length}`,
    subjectsCounted: counted.length,
    // A partial aggregate is misleading: an aggregate of 8 over five subjects is not a Division 1.
    complete: counted.length >= (config.subjects || counted.length),
    bandLabel: config.bandLabel || null,
    band:
      counted.length >= (config.subjects || counted.length)
        ? bandLabelFor(config.bands, total, config.direction)
        : null,
  };
};
