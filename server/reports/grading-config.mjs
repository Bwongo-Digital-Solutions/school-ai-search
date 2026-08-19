const DEFAULT_COUNTRY = 'international';
const DEFAULT_LEVEL = 'secondary';

const createScheme = ({ country, academicLevel, label, scale }) => ({
  country,
  academicLevel,
  label,
  scale: [...scale].sort((a, b) => b.min - a.min),
});

const PRESET_SCHEMES = [
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
  createScheme({
    country: 'international',
    academicLevel: 'tertiary',
    label: 'International Tertiary Scale',
    scale: [
      { min: 85, grade: 'A', remark: 'Distinction' },
      { min: 75, grade: 'B+', remark: 'Very Good' },
      { min: 65, grade: 'B', remark: 'Good' },
      { min: 55, grade: 'C', remark: 'Pass' },
      { min: 0, grade: 'F', remark: 'Fail' },
    ],
  }),
  createScheme({
    country: 'international',
    academicLevel: 'university',
    label: 'International University Scale',
    scale: [
      { min: 85, grade: 'A', remark: 'First Class' },
      { min: 75, grade: 'B+', remark: 'Upper Second' },
      { min: 65, grade: 'B', remark: 'Lower Second' },
      { min: 50, grade: 'C', remark: 'Pass' },
      { min: 0, grade: 'F', remark: 'Fail' },
    ],
  }),
  createScheme({
    country: 'uganda',
    academicLevel: 'primary',
    label: 'Uganda Primary Leaving Scale',
    scale: [
      { min: 90, grade: 'D1', remark: 'Excellent' },
      { min: 80, grade: 'D2', remark: 'Very Good' },
      { min: 70, grade: 'C3', remark: 'Good' },
      { min: 60, grade: 'C4', remark: 'Credit' },
      { min: 50, grade: 'P5', remark: 'Pass' },
      { min: 40, grade: 'P6', remark: 'Basic Pass' },
      { min: 0, grade: 'F9', remark: 'Needs Support' },
    ],
  }),
  createScheme({
    country: 'uganda',
    academicLevel: 'secondary',
    label: 'Uganda Secondary UNEB Scale',
    scale: [
      { min: 90, grade: 'D1', remark: 'Excellent' },
      { min: 80, grade: 'D2', remark: 'Very Good' },
      { min: 70, grade: 'C3', remark: 'Good' },
      { min: 60, grade: 'C4', remark: 'Credit' },
      { min: 50, grade: 'C5', remark: 'Credit' },
      { min: 45, grade: 'C6', remark: 'Credit' },
      { min: 40, grade: 'P7', remark: 'Pass' },
      { min: 35, grade: 'P8', remark: 'Basic Pass' },
      { min: 0, grade: 'F9', remark: 'Needs Support' },
    ],
  }),
  // Uganda's competency-based curriculum (new lower secondary, first UCE examined 2024) reports
  // each subject on an A-E achievement scale, with NCDC's competency descriptors
  // (Outstanding / Moderate / Basic) in the remark. This is a separate 'uganda-cbc' system so the
  // classic D1-F9 UNEB scale above stays available for schools that still use it. The exact SBA +
  // final weighting UNEB applies is not a flat percentage, so these band cut-offs are indicative
  // and can be overridden via SCHOOL_GRADING_SCHEMES.
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
      { min: 93, grade: 'A', remark: 'Excellent' },
      { min: 90, grade: 'A-', remark: 'Excellent' },
      { min: 87, grade: 'B+', remark: 'Very Good' },
      { min: 83, grade: 'B', remark: 'Good' },
      { min: 80, grade: 'B-', remark: 'Good' },
      { min: 77, grade: 'C+', remark: 'Satisfactory' },
      { min: 73, grade: 'C', remark: 'Satisfactory' },
      { min: 70, grade: 'C-', remark: 'Needs Improvement' },
      { min: 60, grade: 'D', remark: 'Minimum Pass' },
      { min: 0, grade: 'F', remark: 'Fail' },
    ],
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
            })),
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

export const resolveGradingScheme = ({ country, academicLevel, gradeLevel } = {}) => {
  const schemes = getGradingSchemes();
  const resolvedCountry = normalizeKey(country || process.env.SCHOOL_GRADING_COUNTRY || DEFAULT_COUNTRY);
  const resolvedLevel = normalizeKey(
    academicLevel || process.env.SCHOOL_ACADEMIC_LEVEL || inferAcademicLevel(gradeLevel),
  );

  return (
    schemes.find((scheme) => scheme.country === resolvedCountry && scheme.academicLevel === resolvedLevel) ||
    schemes.find((scheme) => scheme.country === DEFAULT_COUNTRY && scheme.academicLevel === resolvedLevel) ||
    schemes.find((scheme) => scheme.country === DEFAULT_COUNTRY && scheme.academicLevel === DEFAULT_LEVEL)
  );
};

export const gradeScore = (score, scheme) => {
  const numericScore = Number(score);
  const band = scheme.scale.find((entry) => numericScore >= entry.min) || scheme.scale[scheme.scale.length - 1];
  return {
    grade: band.grade,
    remark: band.remark,
  };
};
