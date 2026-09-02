/**
 * Clubs, societies and teams, and who is in them.
 *
 * Schools allocate students to clubs at registration and then spend the rest of the term unable to
 * answer "who is in Debate?" because the answer lived in a book somebody took home. This keeps the
 * clubs as a catalogue an administrator maintains, and membership as rows against it, so the roster
 * is a query rather than a recollection.
 *
 * Two things are deliberate:
 *
 * A club's patron is a name first and a user second. The teacher who runs the wildlife club very
 * often has no account, and refusing to record the club until they do would mean the club is not
 * recorded. `patron_user_id` links to a real account when there is one.
 *
 * Capacity is checked here rather than by a constraint. An oversubscribed club must refuse a join
 * with a sentence the person at the desk can read out — "Football is full (30 of 30)" — not with a
 * constraint violation. `capacity` NULL means no limit, which is the usual case.
 */
import { randomUUID } from 'node:crypto';

import { requireRole, resolveActor } from '../auth/actor.mjs';
import { ALL_STAFF_ROLES, TEACHING_ROLES } from '../auth/roles.mjs';

const trimmed = (value) => String(value ?? '').trim();
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Roles that maintain the catalogue itself: adding a club, renaming it, retiring it. */
const CATALOGUE_ROLES = ['admin', 'head_teacher'];

/**
 * A capacity as stored: a positive whole number, or null for "no limit".
 *
 * Zero and negatives become null rather than a club nobody can join, which is what a stray 0 from
 * an empty number input would otherwise create.
 */
const normaliseCapacity = (value) => {
  if (value === null || value === undefined || trimmed(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
};

/**
 * How many live members each club has, as a map.
 *
 * Counted in its own grouped query and merged in Node rather than as a correlated subquery beside
 * `c.*`: pg-mem cannot resolve the outer alias inside such a subquery ("Unknown alias c"), and
 * pg-mem backs both the test suite and the hosted demo. The same shape is used everywhere a count
 * is needed here, so there is one way this is done rather than two.
 */
const memberCounts = async (database) => {
  const { rows } = await database.query(
    `SELECT club_id, COUNT(*)::int AS n FROM club_members WHERE status = 'active' GROUP BY club_id`,
  );
  return new Map(rows.map((row) => [row.club_id, row.n]));
};

/** One club with its live membership count, or null. */
const clubWithCount = async (database, clubId) => {
  const { rows } = await database.query('SELECT * FROM clubs WHERE id = $1 LIMIT 1', [clubId]);
  if (!rows[0]) return null;

  const counted = await database.query(
    `SELECT COUNT(*)::int AS n FROM club_members WHERE club_id = $1 AND status = 'active'`,
    [clubId],
  );
  return { ...rows[0], member_count: counted.rows[0].n };
};

/** The clubs a school runs, each with its live membership count. */
const list = async (database, body) => {
  const includeArchived = body.includeArchived === true;
  const { rows } = await database.query(
    `
      SELECT * FROM clubs
      WHERE ($1 = true OR status = 'active')
      ORDER BY name ASC
    `,
    [includeArchived],
  );

  const counts = await memberCounts(database);
  return {
    clubs: rows.map((row) => {
      const club = { ...row, member_count: counts.get(row.id) || 0 };
      return { ...club, full: isFull(club) };
    }),
  };
};

/** A club is full when it has a capacity and has reached it. No capacity is never full. */
const isFull = (club) => Boolean(club.capacity) && Number(club.member_count) >= Number(club.capacity);

/**
 * Name uniqueness is checked here rather than with an index.
 *
 * A case-insensitive unique index needs an expression index, which pg-mem does not support and
 * which would therefore hold on the school's own Postgres and not in the tests — the worst
 * combination. Checking in code means "Debate" and "debate" collide everywhere.
 */
const nameTaken = async (database, name, exceptId = null) => {
  const { rows } = await database.query(
    `SELECT id FROM clubs WHERE LOWER(name) = LOWER($1) AND ($2::text IS NULL OR id <> $2) LIMIT 1`,
    [name, exceptId],
  );
  return Boolean(rows[0]);
};

const create = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;

  const name = trimmed(body.name);
  if (!name) return { error: 'A club needs a name' };
  if (await nameTaken(database, name)) return { error: `There is already a club called ${name}` };

  const { rows } = await database.query(
    `
      INSERT INTO clubs
        (id, name, description, category, patron_name, patron_user_id,
         meeting_day, meeting_time, venue, capacity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      randomUUID(), name, trimmed(body.description), trimmed(body.category) || 'general',
      trimmed(body.patronName), trimmed(body.patronUserId) || null,
      trimmed(body.meetingDay), trimmed(body.meetingTime), trimmed(body.venue),
      normaliseCapacity(body.capacity),
    ],
  );
  return { club: { ...rows[0], member_count: 0, full: false } };
};

const update = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;

  const id = trimmed(body.clubId);
  if (!id) return { error: 'Which club?' };

  const existing = await database.query('SELECT * FROM clubs WHERE id = $1 LIMIT 1', [id]);
  const club = existing.rows[0];
  if (!club) return { error: 'That club no longer exists' };

  const name = body.name === undefined ? club.name : trimmed(body.name);
  if (!name) return { error: 'A club needs a name' };
  if (await nameTaken(database, name, id)) return { error: `There is already a club called ${name}` };

  /* A capacity cannot be cut below the number of students already in the club: the alternative is
     a roster that is over its own limit, and no answer to which member should be removed. */
  const capacity = body.capacity === undefined ? club.capacity : normaliseCapacity(body.capacity);
  if (capacity) {
    const { rows } = await database.query(
      `SELECT COUNT(*)::int AS n FROM club_members WHERE club_id = $1 AND status = 'active'`,
      [id],
    );
    const members = rows[0].n;
    if (capacity < members) {
      return { error: `${name} already has ${members} members, so its limit cannot be set to ${capacity}` };
    }
  }

  const pick = (key, fallback) => (body[key] === undefined ? fallback : trimmed(body[key]));
  const { rows } = await database.query(
    `
      UPDATE clubs
      SET name = $2, description = $3, category = $4, patron_name = $5, patron_user_id = $6,
          meeting_day = $7, meeting_time = $8, venue = $9, capacity = $10
      WHERE id = $1
      RETURNING *
    `,
    [
      id, name, pick('description', club.description), pick('category', club.category) || 'general',
      pick('patronName', club.patron_name),
      body.patronUserId === undefined ? club.patron_user_id : (trimmed(body.patronUserId) || null),
      pick('meetingDay', club.meeting_day), pick('meetingTime', club.meeting_time),
      pick('venue', club.venue), capacity,
    ],
  );
  return { club: rows[0] };
};

/**
 * Retiring a club, which is not the same as deleting one.
 *
 * The members stay attached. A club that ran last year and no longer does is still the true answer
 * to what a student did last year, and dropping the rows would rewrite that.
 */
const archive = async (database, body, actor) => {
  const refusal = requireRole(actor, CATALOGUE_ROLES);
  if (refusal) return refusal;

  const id = trimmed(body.clubId);
  if (!id) return { error: 'Which club?' };

  const status = body.restore === true ? 'active' : 'archived';
  const { rows } = await database.query(
    'UPDATE clubs SET status = $2 WHERE id = $1 RETURNING *',
    [id, status],
  );
  if (!rows[0]) return { error: 'That club no longer exists' };
  return { club: rows[0] };
};

/** Who is in one club, most recently joined first. */
const roster = async (database, body) => {
  const id = trimmed(body.clubId);
  if (!id) return { error: 'Which club?' };

  const { rows } = await database.query(
    `
      SELECT m.id, m.student_id, m.joined_on, m.left_on, m.status, m.recorded_by,
             s.student_id AS student_number, s.first_name, s.last_name,
             s.grade_level, s.class_section
      FROM club_members m
      JOIN students s ON s.id = m.student_id
      WHERE m.club_id = $1 AND ($2 = true OR m.status = 'active')
      ORDER BY m.joined_on DESC, s.last_name ASC
    `,
    [id, body.includeLeft === true],
  );
  return {
    members: rows.map((row) => ({
      ...row,
      full_name: `${row.first_name} ${row.last_name}`.trim(),
    })),
  };
};

/** The clubs one student belongs to — what the student's card and record show. */
export const clubsForStudent = async (database, studentId, { includeLeft = false } = {}) => {
  const { rows } = await database.query(
    `
      SELECT m.id, m.club_id, m.joined_on, m.left_on, m.status,
             c.name, c.category, c.patron_name, c.meeting_day, c.meeting_time, c.venue
      FROM club_members m
      JOIN clubs c ON c.id = m.club_id
      WHERE m.student_id = $1 AND ($2 = true OR m.status = 'active')
      ORDER BY c.name ASC
    `,
    [studentId, includeLeft],
  );
  return rows;
};

const forStudent = async (database, body) => {
  const studentId = trimmed(body.studentId);
  if (!studentId) return { error: 'Which student?' };

  const student = await resolveStudent(database, studentId);
  if (!student) return { error: 'No student matches that number' };

  return { clubs: await clubsForStudent(database, student.id, { includeLeft: body.includeLeft === true }) };
};

/** A student by their internal id or the number printed on their card. */
const resolveStudent = async (database, code) => {
  const { rows } = await database.query(
    'SELECT * FROM students WHERE id = $1 OR UPPER(student_id) = UPPER($1) LIMIT 1',
    [trimmed(code)],
  );
  return rows[0] || null;
};

/**
 * Putting a student into a club.
 *
 * Shared with registration, which allocates several at once, so it takes an open connection and
 * returns a sentence rather than throwing: one full club must not fail the whole enrolment.
 */
export const joinClub = async (database, { clubId, studentId, recordedBy = '' }) => {
  const club = await clubWithCount(database, clubId);
  if (!club) return { error: 'That club no longer exists' };
  if (club.status !== 'active') return { error: `${club.name} is not running this year` };

  /* Already in it is success, not an error: two people registering the same child, or a form
     submitted twice, should leave one membership and no complaint. */
  const { rows: existing } = await database.query(
    'SELECT * FROM club_members WHERE club_id = $1 AND student_id = $2 LIMIT 1',
    [clubId, studentId],
  );
  if (existing[0] && existing[0].status === 'active') return { member: existing[0], already: true };

  // The capacity check counts only live members, and only when the student is not already one.
  if (club.capacity && Number(club.member_count) >= Number(club.capacity)) {
    return { error: `${club.name} is full (${club.member_count} of ${club.capacity})` };
  }

  const { rows } = await database.query(
    `
      INSERT INTO club_members (id, club_id, student_id, joined_on, status, recorded_by)
      VALUES ($1, $2, $3, $4, 'active', $5)
      ON CONFLICT (club_id, student_id)
      DO UPDATE SET status = 'active', left_on = NULL, joined_on = EXCLUDED.joined_on,
                    recorded_by = EXCLUDED.recorded_by
      RETURNING *
    `,
    [randomUUID(), clubId, studentId, todayIso(), trimmed(recordedBy)],
  );
  return { member: rows[0] };
};

const join = async (database, body, actor) => {
  const refusal = requireRole(actor, TEACHING_ROLES);
  if (refusal) return refusal;

  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const clubId = trimmed(body.clubId);
  if (!clubId) return { error: 'Which club?' };

  return joinClub(database, {
    clubId,
    studentId: student.id,
    recordedBy: actor?.name || actor?.email || '',
  });
};

/** Leaving is recorded, not deleted — see the club_members comment in the schema. */
const leave = async (database, body, actor) => {
  const refusal = requireRole(actor, TEACHING_ROLES);
  if (refusal) return refusal;

  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const { rows } = await database.query(
    `
      UPDATE club_members SET status = 'left', left_on = $3
      WHERE club_id = $1 AND student_id = $2 AND status = 'active'
      RETURNING *
    `,
    [trimmed(body.clubId), student.id, todayIso()],
  );
  if (!rows[0]) return { error: 'That student is not in this club' };
  return { member: rows[0] };
};

const ACTIONS = {
  list,
  create,
  update,
  archive,
  roster,
  for_student: forStudent,
  join,
  leave,
};

/**
 * Reading the catalogue is open to any signed-in member of staff — a matron and an askari both
 * have reason to know which club a child is at this afternoon. Changing it is not: each action
 * above applies its own gate.
 */
export const handleClubsFunction = async (database, body = {}, { actor: authenticated } = {}) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, ALL_STAFF_ROLES);
  if (refusal) return refusal;

  const action = trimmed(body.action) || 'list';
  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported action: ${action}` };

  return handler(database, body, actor);
};
