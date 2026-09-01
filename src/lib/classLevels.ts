import type { SchoolLevel } from './settings';

/**
 * What a school calls its classes.
 *
 * A Ugandan primary school has Primary 1 to Primary 7; a secondary school has Senior 1 to Senior 6.
 * Asking either of them for a "Grade Level" between 0 and 20 makes them translate their own register
 * into somebody else's vocabulary, and do it identically every time or the filters stop matching. So
 * the school picks its level once under Settings, and every class picker offers that school's own
 * class names.
 *
 * `grade_level` stays the integer it has always been, on the scale the server already grades by:
 *
 *     nursery  ≤ 0        P1–P7  1–7        S1–S4  8–11        S5–S6  12–13        tertiary  14+
 *
 * That scale is not arbitrary and must not be renumbered. `academicLevelFor` in
 * server/reports/grading-config.mjs reads it to decide whether a secondary student is marked on the
 * UCE or the UACE scale — it returns 'secondary-a' at grade ≥ 12. Numbering Senior 5 as 5 would put
 * A-Level students on the O-Level scale, silently and only visibly on a printed report card.
 *
 * Because this is the scale already in use, nothing is migrated and no stored value changes meaning.
 */

export interface ClassOption {
  value: number;
  label: string;
}

const range = (from: number, to: number, name: (index: number) => string): ClassOption[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: name(i + 1) }));

const CLASSES: Record<SchoolLevel, ClassOption[]> = {
  // A nursery's own classes. Negative values keep them clear of Primary 1 while still landing in
  // the server's "≤ 0 is nursery" band, so they grade on development descriptors as before.
  pre_school: [
    { value: -2, label: 'Baby class' },
    { value: -1, label: 'Middle class' },
    { value: 0, label: 'Top class' },
  ],
  kindergarten: [
    { value: -2, label: 'Baby class' },
    { value: -1, label: 'Middle class' },
    { value: 0, label: 'Top class' },
  ],
  // PLE. Nursery sits at 0 because many primary schools carry a nursery section on the same roll.
  primary: [{ value: 0, label: 'Nursery / Kindergarten' }, ...range(1, 7, n => `Primary ${n}`)],
  // UCE.
  secondary_olevel: range(8, 11, n => `Senior ${n}`),
  // UACE. Starts at 12, which is what tips the grading scheme from UCE to UACE.
  secondary_alevel: range(12, 13, n => `Senior ${n + 4}`),
  secondary: range(8, 13, n => `Senior ${n}`),
  technical: range(14, 16, n => `Year ${n}`),
  tertiary: [{ value: 14, label: 'Institute / University' }],
};

/** The classes this school actually has, for any picker that sets a student's class. */
export const classOptionsFor = (level: SchoolLevel | undefined): ClassOption[] =>
  CLASSES[level ?? 'secondary'] ?? CLASSES.secondary;

/**
 * How one class reads, for this school.
 *
 * A number outside the level's range shows as `Grade 11` rather than being relabelled or hidden.
 * That case is real — a school changes its level, or a record predates the setting — and the honest
 * answer is the number that is actually stored. Quietly calling a stored 11 "Senior 5" would be
 * inventing a fact about a student's class.
 */
export const classLabel = (level: SchoolLevel | undefined, gradeLevel: number | null | undefined) => {
  if (gradeLevel === null || gradeLevel === undefined || Number.isNaN(Number(gradeLevel))) return '—';
  const match = classOptionsFor(level).find(option => option.value === Number(gradeLevel));
  return match ? match.label : `Grade ${gradeLevel}`;
};

/** The same, plus the section: "Primary 5 A". Used wherever a student's class is shown in full. */
export const classAndSection = (
  level: SchoolLevel | undefined,
  gradeLevel: number | null | undefined,
  section: string | null | undefined,
) => [classLabel(level, gradeLevel), section].filter(Boolean).join(' ');

/**
 * What a class filter should offer: the school's own classes, plus any out-of-range value students
 * actually have — so nobody becomes unreachable because the level was changed.
 */
export const classFilterOptions = (
  level: SchoolLevel | undefined,
  usedGradeLevels: Array<number | null | undefined>,
): ClassOption[] => {
  const options = classOptionsFor(level);
  const known = new Set(options.map(option => option.value));
  const extras = [...new Set(usedGradeLevels.map(Number).filter(Number.isFinite))]
    .filter(value => !known.has(value))
    .sort((a, b) => a - b)
    .map(value => ({ value, label: `Grade ${value}` }));
  return [...options, ...extras];
};
