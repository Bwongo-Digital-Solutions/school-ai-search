/**
 * School requirements: the brooms, toilet paper and reams of paper a student is asked to bring.
 *
 * Two tables, and the split between them is the point. `requirement_items` is the standing list a
 * school publishes — "every primary child brings a broom" — and `student_requirements` is what
 * actually arrived with a named child in a named term. Keeping the second means the question a
 * bursar is asked in week three ("who still owes their reams?") is a query, and the answer does not
 * depend on whoever was on the desk in week one.
 *
 * ## Which list applies to a student
 *
 * From the student's own grade, not from the school's configured level. A school that runs a
 * nursery alongside its primary section has both kinds of child on one roll, and reading the level
 * from settings would hand a three-year-old the secondary list. The bands are the ones the rest of
 * the app already grades by (`inferAcademicLevel` in reports/grading-config.mjs), and they must not
 * drift from it:
 *
 *     ≤ 0  kindergarten        1–7  primary        8–13  secondary        14+  tertiary
 *
 * An item may then narrow to a single class — P7 is asked for exam pads that P1 is not — which is
 * what `grade_level` does; NULL means the whole level.
 */
import { randomUUID } from 'node:crypto';

import { requireRole, resolveActor } from '../auth/actor.mjs';
import { ALL_STAFF_ROLES } from '../auth/roles.mjs';

const trimmed = (value) => String(value ?? '').trim();

/** Roles that publish the standing list. Recording what a child brought is a wider gate, below. */
const CATALOGUE_ROLES = ['admin', 'head_teacher'];

/** Roles that record an arrival at the desk: the office, the bursar's counter, the matron. */
const RECORDING_ROLES = ['admin', 'head_teacher', 'teacher', 'accountant', 'bursar'];
const RECORDING_POSTS = ['matron'];

export const REQUIREMENT_LEVELS = ['kindergarten', 'primary', 'secondary', 'tertiary'];
export const REQUIREMENT_CATEGORIES = ['cleaning', 'scholastic', 'personal', 'bedding', 'other'];

/**
 * The band a class falls in. Mirrors inferAcademicLevel; see the header.
 *
 * A grade that is not a number gives null rather than a guess — an unscoped student gets an empty
 * list and a visible gap, which is better than being handed the wrong school's requirements.
 */
export const levelForGrade = (gradeLevel) => {
  const grade = Number(gradeLevel);
  if (!Number.isFinite(grade)) return null;
  if (grade <= 0) return 'kindergarten';
  if (grade <= 7) return 'primary';
  if (grade <= 13) return 'secondary';
  return 'tertiary';
};

/** Settings and older records spell the levels several ways; they all land on the four bands. */
const ALIASES = {
  pre_school: 'kindergarten',
  'pre-school': 'kindergarten',
  nursery: 'kindergarten',
  kindergarten: 'kindergarten',
  primary: 'primary',
  secondary: 'secondary',
  secondary_olevel: 'secondary',
  secondary_alevel: 'secondary',
  'secondary-olevel': 'secondary',
  'secondary-alevel': 'secondary',
  technical: 'tertiary',
  tertiary: 'tertiary',
  university: 'tertiary',
};

export const normaliseLevel = (value) => ALIASES[trimmed(value).toLowerCase()] || null;

const currentYear = () => String(new Date().getFullYear());
const termOf = (body) => trimmed(body.term) || 'Term 1';
const yearOf = (body) => trimmed(body.academicYear) || currentYear();

/**
 * The default lists, installed once into an empty catalogue.
 *
 * These are starting points a school edits, not rules — but they are deliberately not the same list
 * four times over. A nursery asks for wipes and crayons and no mop; a secondary boarding house asks
 * for bedding and a bucket; a tertiary institution asks for almost nothing. That difference is the
 * whole reason the catalogue is scoped by level.
 */
export const DEFAULT_REQUIREMENTS = [
  // Kindergarten — small children, day school, consumables the class shares.
  { level: 'kindergarten', name: 'Toilet paper', category: 'cleaning', unit: 'rolls', quantity: 4 },
  { level: 'kindergarten', name: 'Liquid soap', category: 'cleaning', unit: 'litre', quantity: 1 },
  { level: 'kindergarten', name: 'Wet wipes', category: 'personal', unit: 'packets', quantity: 2 },
  { level: 'kindergarten', name: 'Crayons', category: 'scholastic', unit: 'packet', quantity: 1 },
  { level: 'kindergarten', name: 'Ream of paper', category: 'scholastic', unit: 'ream', quantity: 1 },
  { level: 'kindergarten', name: 'Napping mat', category: 'personal', unit: 'piece', quantity: 1 },
  {
    level: 'kindergarten', name: 'Spare uniform', category: 'personal', unit: 'set', quantity: 1,
    mandatory: false, notes: 'Kept in the class for accidents',
  },

  // Primary — the classic Ugandan primary list.
  { level: 'primary', name: 'Broom', category: 'cleaning', unit: 'piece', quantity: 1 },
  { level: 'primary', name: 'Toilet paper', category: 'cleaning', unit: 'rolls', quantity: 4 },
  { level: 'primary', name: 'Liquid soap', category: 'cleaning', unit: 'litre', quantity: 1 },
  { level: 'primary', name: 'Jik / disinfectant', category: 'cleaning', unit: 'bottle', quantity: 1 },
  { level: 'primary', name: 'Ream of paper', category: 'scholastic', unit: 'reams', quantity: 2 },
  { level: 'primary', name: 'Mathematical set', category: 'scholastic', unit: 'set', quantity: 1 },
  {
    level: 'primary', name: 'Exam pads', category: 'scholastic', unit: 'pads', quantity: 2,
    grade: 7, notes: 'Candidate class only',
  },

  // Secondary — a longer list, and the boarding half of it is marked as such.
  { level: 'secondary', name: 'Broom', category: 'cleaning', unit: 'piece', quantity: 1 },
  { level: 'secondary', name: 'Mop', category: 'cleaning', unit: 'piece', quantity: 1 },
  { level: 'secondary', name: 'Toilet paper', category: 'cleaning', unit: 'rolls', quantity: 6 },
  { level: 'secondary', name: 'Jik / disinfectant', category: 'cleaning', unit: 'bottle', quantity: 1 },
  { level: 'secondary', name: 'Ream of paper', category: 'scholastic', unit: 'reams', quantity: 2 },
  { level: 'secondary', name: 'Graph books', category: 'scholastic', unit: 'books', quantity: 2 },
  { level: 'secondary', name: 'Mathematical set', category: 'scholastic', unit: 'set', quantity: 1 },
  { level: 'secondary', name: 'Bucket', category: 'personal', unit: 'piece', quantity: 1, boarding: true },
  { level: 'secondary', name: 'Bedsheets', category: 'bedding', unit: 'pairs', quantity: 2, boarding: true },
  { level: 'secondary', name: 'Blanket', category: 'bedding', unit: 'piece', quantity: 1, boarding: true },
  { level: 'secondary', name: 'Mosquito net', category: 'bedding', unit: 'piece', quantity: 1, boarding: true },

  // Tertiary — adults who buy their own; the school asks for very little.
  { level: 'tertiary', name: 'Ream of paper', category: 'scholastic', unit: 'reams', quantity: 2 },
  {
    level: 'tertiary', name: 'Toilet paper', category: 'cleaning', unit: 'rolls', quantity: 4,
    mandatory: false,
  },
];

/**
 * Installs the defaults, but only into an empty catalogue.
 *
 * Guarded on emptiness rather than on each row, so a school that has deleted an item it does not
 * want does not find it back after the next restart.
 */
export const seedDefaultRequirements = async (database) => {
  const { rows } = await database.query('SELECT COUNT(*)::int AS n FROM requirement_items');
  if (rows[0].n > 0) return { seeded: 0 };

  for (const item of DEFAULT_REQUIREMENTS) {
    await database.query(
      `
        INSERT INTO requirement_items
          (id, item_name, category, unit, quantity, school_level, grade_level,
           mandatory, boarding_only, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        randomUUID(), item.name, item.category, item.unit, item.quantity, item.level,
        item.grade ?? null, item.mandatory !== false, item.boarding === true, item.notes || '',
      ],
    );
  }
  return { seeded: DEFAULT_REQUIREMENTS.length };
};

/** The standing list, optionally narrowed to one level or one class. */
const catalogue = async (database, body) => {
  const level = normaliseLevel(body.level);
  const grade = body.gradeLevel === undefined || body.gradeLevel === null || trimmed(body.gradeLevel) === ''
    ? null
    : Number(body.gradeLevel);

  const { rows } = await database.query(
    `
      SELECT * FROM requirement_items
      WHERE ($1 = true OR status = 'active')
        AND ($2::text IS NULL OR school_level = $2)
        AND ($3::int IS NULL OR grade_level IS NULL OR grade_level = $3)
      ORDER BY school_level ASC, category ASC, item_name ASC
    `,
    [body.includeArchived === true, level, Number.isFinite(grade) ? grade : null],
  );
  return { items: rows, levels: REQUIREMENT_LEVELS, categories: REQUIREMENT_CATEGORIES };
};

const addItem = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;

  const name = trimmed(body.itemName);
  if (!name) return { error: 'The item needs a name' };

  const level = normaliseLevel(body.level || body.schoolLevel);
  if (!level) return { error: `Choose a level: ${REQUIREMENT_LEVELS.join(', ')}` };

  const category = REQUIREMENT_CATEGORIES.includes(trimmed(body.category))
    ? trimmed(body.category)
    : 'other';

  const quantity = Number(body.quantity);
  const grade = trimmed(body.gradeLevel) === '' ? null : Number(body.gradeLevel);

  const { rows } = await database.query(
    `
      INSERT INTO requirement_items
        (id, item_name, category, unit, quantity, school_level, grade_level,
         mandatory, boarding_only, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      randomUUID(), name, category, trimmed(body.unit),
      Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
      level, Number.isFinite(grade) ? grade : null,
      body.mandatory !== false, body.boardingOnly === true, trimmed(body.notes),
    ],
  );
  return { item: rows[0] };
};

const updateItem = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;

  const id = trimmed(body.itemId);
  if (!id) return { error: 'Which item?' };

  const existing = await database.query('SELECT * FROM requirement_items WHERE id = $1 LIMIT 1', [id]);
  const item = existing.rows[0];
  if (!item) return { error: 'That item is no longer in the list' };

  const level = body.level === undefined && body.schoolLevel === undefined
    ? item.school_level
    : normaliseLevel(body.level || body.schoolLevel);
  if (!level) return { error: `Choose a level: ${REQUIREMENT_LEVELS.join(', ')}` };

  const quantity = body.quantity === undefined ? item.quantity : Number(body.quantity);
  const grade = body.gradeLevel === undefined
    ? item.grade_level
    : (trimmed(body.gradeLevel) === '' ? null : Number(body.gradeLevel));

  const { rows } = await database.query(
    `
      UPDATE requirement_items
      SET item_name = $2, category = $3, unit = $4, quantity = $5, school_level = $6,
          grade_level = $7, mandatory = $8, boarding_only = $9, notes = $10, status = $11
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      body.itemName === undefined ? item.item_name : trimmed(body.itemName),
      body.category === undefined || !REQUIREMENT_CATEGORIES.includes(trimmed(body.category))
        ? item.category
        : trimmed(body.category),
      body.unit === undefined ? item.unit : trimmed(body.unit),
      Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : item.quantity,
      level,
      Number.isFinite(Number(grade)) ? Number(grade) : null,
      body.mandatory === undefined ? item.mandatory : body.mandatory !== false,
      body.boardingOnly === undefined ? item.boarding_only : body.boardingOnly === true,
      body.notes === undefined ? item.notes : trimmed(body.notes),
      body.status === 'archived' || body.status === 'active' ? body.status : item.status,
    ],
  );
  return { item: rows[0] };
};

/** Retiring an item leaves every record of it being brought intact; see the schema. */
const archiveItem = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;

  const id = trimmed(body.itemId);
  if (!id) return { error: 'Which item?' };

  const { rows } = await database.query(
    'UPDATE requirement_items SET status = $2 WHERE id = $1 RETURNING *',
    [id, body.restore === true ? 'active' : 'archived'],
  );
  if (!rows[0]) return { error: 'That item is no longer in the list' };
  return { item: rows[0] };
};

const resolveStudent = async (database, code) => {
  const { rows } = await database.query(
    'SELECT * FROM students WHERE id = $1 OR UPPER(student_id) = UPPER($1) LIMIT 1',
    [trimmed(code)],
  );
  return rows[0] || null;
};

/**
 * The items that apply to one student, each carrying what has been recorded for the term.
 *
 * This is what registration shows and what the requirements screen shows later — the same list,
 * with `status` 'pending' for anything not yet recorded. Boarding-only items are included only for
 * a student who has a live hostel bed, so a day student is never asked for a mosquito net.
 */
export const requirementsForStudent = async (database, student, { term, academicYear }) => {
  const level = levelForGrade(student.grade_level);
  if (!level) return { level: null, items: [] };

  const boarding = await database.query(
    `SELECT id FROM hostel_assignments WHERE student_id = $1 AND status = 'active' LIMIT 1`,
    [student.id],
  );
  const isBoarder = Boolean(boarding.rows[0]);

  const { rows } = await database.query(
    `
      SELECT i.*,
             r.id AS record_id, r.status AS record_status, r.quantity_brought,
             r.quantity_expected, r.note, r.recorded_by, r.recorded_at
      FROM requirement_items i
      LEFT JOIN student_requirements r
        ON r.requirement_id = i.id AND r.student_id = $1
       AND r.term = $2 AND r.academic_year = $3
      WHERE i.status = 'active'
        AND i.school_level = $4
        AND (i.grade_level IS NULL OR i.grade_level = $5)
        AND ($6 = true OR i.boarding_only = false)
      ORDER BY i.category ASC, i.item_name ASC
    `,
    [student.id, term, academicYear, level, Number(student.grade_level), isBoarder],
  );

  return {
    level,
    boarder: isBoarder,
    items: rows.map((row) => ({
      requirement_id: row.id,
      item_name: row.item_name,
      category: row.category,
      unit: row.unit,
      quantity: row.quantity,
      mandatory: row.mandatory,
      boarding_only: row.boarding_only,
      notes: row.notes,
      status: row.record_status || 'pending',
      quantity_expected: row.quantity_expected ?? row.quantity,
      quantity_brought: row.quantity_brought ?? 0,
      note: row.note || '',
      recorded_by: row.recorded_by || '',
      recorded_at: row.recorded_at || null,
    })),
  };
};

const forStudent = async (database, body) => {
  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const term = termOf(body);
  const academicYear = yearOf(body);
  const result = await requirementsForStudent(database, student, { term, academicYear });

  return {
    student: {
      id: student.id,
      student_id: student.student_id,
      full_name: `${student.first_name} ${student.last_name}`.trim(),
      grade_level: student.grade_level,
      class_section: student.class_section,
    },
    term,
    academic_year: academicYear,
    ...result,
  };
};

/**
 * Records what a student brought, or that they have been excused.
 *
 * An upsert on (student, item, term, year): recording twice corrects the first answer rather than
 * writing a second one, which is what happens when a child brings half the reams on Monday and the
 * rest on Friday.
 */
export const recordRequirement = async (database, {
  studentId, requirementId, term, academicYear,
  status = 'brought', quantityBrought, quantityExpected,
  note = '', recordedBy = '',
}) => {
  const clean = ['pending', 'brought', 'waived'].includes(status) ? status : 'brought';

  const item = await database.query(
    'SELECT * FROM requirement_items WHERE id = $1 LIMIT 1',
    [requirementId],
  );
  if (!item.rows[0]) return { error: 'That item is not in the requirements list' };

  const expected = Number.isFinite(Number(quantityExpected))
    ? Number(quantityExpected)
    : Number(item.rows[0].quantity);

  /* A 'brought' with no count means the whole expected amount — the common case at the desk, where
     somebody ticks a box rather than counting rolls. An explicit number always wins. */
  const brought = Number.isFinite(Number(quantityBrought))
    ? Number(quantityBrought)
    : (clean === 'brought' ? expected : 0);

  const { rows } = await database.query(
    `
      INSERT INTO student_requirements
        (id, student_id, requirement_id, term, academic_year, quantity_expected,
         quantity_brought, status, note, recorded_by, recorded_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (student_id, requirement_id, term, academic_year)
      DO UPDATE SET quantity_expected = EXCLUDED.quantity_expected,
                    quantity_brought = EXCLUDED.quantity_brought,
                    status = EXCLUDED.status,
                    note = EXCLUDED.note,
                    recorded_by = EXCLUDED.recorded_by,
                    recorded_at = NOW()
      RETURNING *
    `,
    [
      randomUUID(), studentId, requirementId,
      trimmed(term) || 'Term 1', trimmed(academicYear) || currentYear(),
      expected, brought, clean, trimmed(note), trimmed(recordedBy),
    ],
  );
  return { record: rows[0] };
};

const record = async (database, body, actor) => {
  const refusal = requirePostOrRole(actor);
  if (refusal) return refusal;

  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const requirementId = trimmed(body.requirementId);
  if (!requirementId) return { error: 'Which item?' };

  return recordRequirement(database, {
    studentId: student.id,
    requirementId,
    term: termOf(body),
    academicYear: yearOf(body),
    status: trimmed(body.status) || 'brought',
    quantityBrought: body.quantityBrought,
    quantityExpected: body.quantityExpected,
    note: body.note,
    recordedBy: actor?.name || actor?.email || '',
  });
};

/**
 * Assigning the whole list to a student, which is what registration does.
 *
 * Every applicable item gets a row, so a student who brought nothing still reads as owing the list
 * rather than as having no requirements at all. Items named in `brought` are marked as arrived in
 * the same pass.
 */
export const assignRequirements = async (database, student, {
  term, academicYear, brought = [], waived = [], recordedBy = '',
}) => {
  const { items, level } = await requirementsForStudent(database, student, { term, academicYear });
  const isBrought = new Set(brought.map((id) => trimmed(id)));
  const isWaived = new Set(waived.map((id) => trimmed(id)));

  const written = [];
  for (const item of items) {
    const status = isWaived.has(item.requirement_id)
      ? 'waived'
      : (isBrought.has(item.requirement_id) ? 'brought' : 'pending');

    const result = await recordRequirement(database, {
      studentId: student.id,
      requirementId: item.requirement_id,
      term,
      academicYear,
      status,
      quantityExpected: item.quantity,
      recordedBy,
    });
    if (result.record) written.push(result.record);
  }
  return { level, assigned: written.length, records: written };
};

const assign = async (database, body, actor) => {
  const refusal = requirePostOrRole(actor);
  if (refusal) return refusal;

  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  return assignRequirements(database, student, {
    term: termOf(body),
    academicYear: yearOf(body),
    brought: Array.isArray(body.brought) ? body.brought : [],
    waived: Array.isArray(body.waived) ? body.waived : [],
    recordedBy: actor?.name || actor?.email || '',
  });
};

/**
 * What a set of students still owes, worked out from the catalogue rather than from what somebody
 * remembered to assign.
 *
 * The distinction matters. `student_requirements` only holds rows once a list has been assigned —
 * at registration, or by hand — so a query that reads that table alone reports "owes nothing" for
 * every student enrolled before the feature existed, and for anyone the desk skipped. Deriving the
 * expected list per student and subtracting what has actually been recorded means an unassigned
 * student reads as owing the whole list, which is the truth.
 *
 * Only mandatory items count: a school that lists a spare uniform as optional should not see every
 * child in the nursery reported as outstanding because of it.
 *
 * Four queries and the join in Node, deliberately. Doing it in SQL needs either a correlated
 * subquery or string_agg, and pg-mem supports neither — it backs the test suite and the hosted
 * demo, so such a query would work on the school's Postgres and fail everywhere this is developed.
 */
export const outstandingForStudents = async (database, { term, academicYear, students }) => {
  if (!students.length) return [];

  const [catalogue, recorded, boarders] = await Promise.all([
    database.query(`SELECT * FROM requirement_items WHERE status = 'active' AND mandatory = true`),
    database.query(
      `SELECT student_id, requirement_id, status FROM student_requirements
        WHERE term = $1 AND academic_year = $2`,
      [term, academicYear],
    ),
    database.query(`SELECT student_id FROM hostel_assignments WHERE status = 'active'`),
  ]);

  const isBoarder = new Set(boarders.rows.map((row) => row.student_id));

  /* Anything already answered — brought or waived — is settled. Only 'pending' and rows that were
     never written at all count as owing. */
  const settled = new Set(
    recorded.rows
      .filter((row) => row.status === 'brought' || row.status === 'waived')
      .map((row) => `${row.student_id}:${row.requirement_id}`),
  );

  const results = [];
  for (const student of students) {
    const level = levelForGrade(student.grade_level);
    if (!level) continue;

    const owed = catalogue.rows.filter((item) => (
      item.school_level === level
      && (item.grade_level === null || Number(item.grade_level) === Number(student.grade_level))
      && (!item.boarding_only || isBoarder.has(student.id))
      && !settled.has(`${student.id}:${item.id}`)
    ));
    if (!owed.length) continue;

    results.push({
      ...student,
      full_name: `${student.first_name} ${student.last_name}`.trim(),
      level,
      boarder: isBoarder.has(student.id),
      owing: owed.length,
      item_list: owed.map((item) => ({
        requirement_id: item.id,
        item_name: item.item_name,
        category: item.category,
        quantity: item.quantity,
        unit: item.unit,
      })),
      items: owed.map((item) => item.item_name).join(', '),
    });
  }
  return results;
};

/** Who still owes something, by class. */
const outstanding = async (database, body) => {
  const term = termOf(body);
  const academicYear = yearOf(body);
  const grade = trimmed(body.gradeLevel) === '' ? null : Number(body.gradeLevel);
  const section = trimmed(body.classSection);

  const { rows } = await database.query(
    `
      SELECT id, student_id, first_name, last_name, grade_level, class_section
      FROM students
      WHERE status = 'active'
        AND ($1::int IS NULL OR grade_level = $1)
        AND ($2 = '' OR class_section = $2)
      ORDER BY grade_level ASC, class_section ASC, last_name ASC
    `,
    [Number.isFinite(grade) ? grade : null, section],
  );

  return {
    term,
    academic_year: academicYear,
    students: await outstandingForStudents(database, { term, academicYear, students: rows }),
  };
};

const seed = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;
  return seedDefaultRequirements(database);
};

/** Recording an arrival is open to the desk roles and to the matron, who checks the dormitories. */
const requirePostOrRole = (actor) => {
  if (!actor) return { error: 'Unauthorized' };
  if (RECORDING_ROLES.includes(actor.role)) return null;
  if (actor.designation && RECORDING_POSTS.includes(actor.designation)) return null;
  return { error: 'Unauthorized' };
};

const ACTIONS = {
  catalogue,
  add_item: addItem,
  update_item: updateItem,
  archive_item: archiveItem,
  for_student: forStudent,
  record,
  assign,
  outstanding,
  seed_defaults: seed,
};

export const handleRequirementsFunction = async (database, body = {}, { actor: authenticated } = {}) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, ALL_STAFF_ROLES);
  if (refusal) return refusal;

  const action = trimmed(body.action) || 'catalogue';
  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported action: ${action}` };

  return handler(database, body, actor);
};
