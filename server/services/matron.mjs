/**
 * The matron's own screen: the dormitories, the sick bay, and the children in them.
 *
 * The matron already existed in this system as a designation — she can scan a card and see a
 * student's dormitory, parents and gate permission (services/scan-profiles.mjs). What she had no
 * way to do was work from her own list rather than from whoever happened to walk past. The four
 * things a matron actually does across an evening are here:
 *
 *   - the dormitory head count, which is not the class register: it is asked at night, about beds
 *   - the sick bay book, so "was my child seen on Tuesday?" has an answer
 *   - beds: who sleeps where, which are free, and the room list itself — she keeps it, because she
 *     is the person standing in the room who knows it holds six beds and not four
 *   - welfare: the boarders who still owe their requirements, and who is signed out of the gate
 *
 * ## Who may open it
 *
 * A matron's role is `support_staff`, which is the same role as the cook and the askari. Gating on
 * the role alone would either lock her out or hand the cook the dormitory roll, so this gates on
 * the post — role *or* designation — through `requirePost`. The designation is read from her own
 * users row, never from the request.
 *
 * 'sick_bay' and 'away' are first-class answers at roll call, distinct from 'absent'. A matron who
 * knows where a child is has not lost one, and collapsing the three would turn every sick child
 * into a missing person at ten o'clock at night.
 */
import { randomUUID } from 'node:crypto';

import { requirePost, resolveActor } from '../auth/actor.mjs';
import { outstandingForStudents } from './requirements.mjs';

const trimmed = (value) => String(value ?? '').trim();
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Runs the school, or runs the dormitories. Nobody else. */
const MATRON_GATE = { roles: ['admin', 'head_teacher'], designations: ['matron'] };

const CHECK_NAMES = ['morning', 'night'];
const ROLL_STATUSES = ['present', 'absent', 'sick_bay', 'away'];
const OUTCOMES = ['resting', 'discharged', 'referred', 'sent_home'];

/** The date a request is about, as YYYY-MM-DD. Never SQL CURRENT_DATE — see the schema comment. */
const dateOf = (body) => trimmed(body.date) || todayIso();
const checkOf = (body) => (CHECK_NAMES.includes(trimmed(body.check)) ? trimmed(body.check) : 'night');

const resolveStudent = async (database, code) => {
  const { rows } = await database.query(
    'SELECT * FROM students WHERE id = $1 OR UPPER(student_id) = UPPER($1) LIMIT 1',
    [trimmed(code)],
  );
  return rows[0] || null;
};

/**
 * Everything the matron's home screen counts, for one date.
 *
 * Deliberately one query set rather than several round trips from the phone: this is opened on a
 * handset in a dormitory corridor, and the difference between one request and six is the difference
 * between a screen that loads and one that does not.
 */
const dashboard = async (database, body) => {
  const date = dateOf(body);
  const check = checkOf(body);

  const [boarders, sickBay, roll, gate, owing, rooms] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS n FROM hostel_assignments WHERE status = 'active'`,
    ),
    database.query(
      `SELECT COUNT(*)::int AS n FROM sick_bay_records WHERE discharged_at IS NULL`,
    ),
    database.query(
      `
        SELECT status, COUNT(*)::int AS n FROM dorm_checks
        WHERE check_date = $1 AND check_name = $2
        GROUP BY status
      `,
      [date, check],
    ),
    database.query(
      `
        SELECT COUNT(*)::int AS n FROM gate_permissions
        WHERE status = 'active'
      `,
    ),
    /* The boarders themselves, so the count below can be derived the same way the welfare list is.
       Counting pending rows directly would report zero for a student nobody has assigned a list to
       — and then the tile would disagree with the list it opens. */
    database.query(
      `
        SELECT s.id, s.first_name, s.last_name, s.grade_level
        FROM hostel_assignments a
        JOIN students s ON s.id = a.student_id
        WHERE a.status = 'active'
      `,
    ),
    database.query(
      `
        SELECT COUNT(*)::int AS rooms,
               COALESCE(SUM(capacity), 0)::int AS beds
        FROM hostel_rooms
      `,
    ),
  ]);

  const byStatus = Object.fromEntries(roll.rows.map((row) => [row.status, row.n]));
  const counted = ROLL_STATUSES.reduce((total, name) => total + (byStatus[name] || 0), 0);

  const owingBoarders = await outstandingForStudents(database, {
    term: trimmed(body.term) || 'Term 1',
    academicYear: trimmed(body.academicYear) || String(new Date().getFullYear()),
    students: owing.rows,
  });

  return {
    date,
    check,
    boarders: boarders.rows[0].n,
    in_sick_bay: sickBay.rows[0].n,
    signed_out: gate.rows[0].n,
    owing_requirements: owingBoarders.length,
    rooms: rooms.rows[0].rooms,
    beds: rooms.rows[0].beds,
    beds_free: Math.max(0, rooms.rows[0].beds - boarders.rows[0].n),
    roll: {
      present: byStatus.present || 0,
      absent: byStatus.absent || 0,
      sick_bay: byStatus.sick_bay || 0,
      away: byStatus.away || 0,
      // What is left of the boarders once everybody counted so far is taken off.
      unmarked: Math.max(0, boarders.rows[0].n - counted),
    },
  };
};

/**
 * The roll for one check on one day: every boarder, with tonight's answer against them.
 *
 * A LEFT JOIN, so a student nobody has marked yet appears with no status rather than dropping off
 * the list — the unmarked are the entire reason for taking a roll.
 */
const dormRoll = async (database, body) => {
  const date = dateOf(body);
  const check = checkOf(body);
  const hostel = trimmed(body.hostel);

  /* The two "where else might this child be?" lookups are fetched as sets rather than as
     correlated subqueries in the SELECT: pg-mem cannot correlate a subquery to an outer alias at
     all, and it backs the test suite and the hosted demo. Two small queries, merged below. */
  const [{ rows }, sick, out] = await Promise.all([
    database.query(
      `
        SELECT s.id, s.student_id, s.first_name, s.last_name, s.grade_level, s.class_section,
               r.hostel_name, r.room_number, r.id AS room_id, a.bed_number,
               d.status, d.note, d.recorded_by, d.recorded_at
        FROM hostel_assignments a
        JOIN students s ON s.id = a.student_id
        JOIN hostel_rooms r ON r.id = a.room_id
        LEFT JOIN dorm_checks d
          ON d.student_id = s.id AND d.check_date = $1 AND d.check_name = $2
        WHERE a.status = 'active'
          AND ($3 = '' OR r.hostel_name = $3)
        ORDER BY r.hostel_name ASC, r.room_number ASC, s.last_name ASC, s.first_name ASC
      `,
      [date, check, hostel],
    ),
    database.query('SELECT student_id FROM sick_bay_records WHERE discharged_at IS NULL'),
    database.query(`SELECT student_id FROM gate_permissions WHERE status = 'active'`),
  ]);

  const inSickBay = new Set(sick.rows.map((row) => row.student_id));
  const signedOut = new Set(out.rows.map((row) => row.student_id));

  return {
    date,
    check,
    students: rows.map((row) => ({
      id: row.id,
      student_number: row.student_id,
      full_name: `${row.first_name} ${row.last_name}`.trim(),
      grade_level: row.grade_level,
      class_section: row.class_section,
      hostel_name: row.hostel_name,
      room_number: row.room_number,
      room_id: row.room_id,
      bed_number: row.bed_number,
      status: row.status || '',
      note: row.note || '',
      recorded_by: row.recorded_by || '',
      recorded_at: row.recorded_at || null,
      // Shown beside an unmarked name so the matron is not hunting a child the office signed out.
      in_sick_bay: inSickBay.has(row.id),
      signed_out: signedOut.has(row.id),
    })),
  };
};

/** Marking one student. An upsert, so correcting a mistake overwrites rather than duplicates. */
const mark = async (database, body, actor) => {
  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const status = trimmed(body.status);
  if (!ROLL_STATUSES.includes(status)) {
    return { error: `A roll call answer must be one of: ${ROLL_STATUSES.join(', ')}` };
  }

  const room = await database.query(
    `SELECT room_id FROM hostel_assignments WHERE student_id = $1 AND status = 'active' LIMIT 1`,
    [student.id],
  );

  const { rows } = await database.query(
    `
      INSERT INTO dorm_checks
        (id, student_id, room_id, check_date, check_name, status, note, recorded_by, recorded_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (check_date, check_name, student_id)
      DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
                    room_id = EXCLUDED.room_id,
                    recorded_by = EXCLUDED.recorded_by, recorded_at = NOW()
      RETURNING *
    `,
    [
      randomUUID(), student.id, room.rows[0]?.room_id || null, dateOf(body), checkOf(body),
      status, trimmed(body.note), actor?.name || actor?.email || '',
    ],
  );
  return { check: rows[0] };
};

/** Who is in the sick bay now, and — when asked for — who has been through it recently. */
const sickBay = async (database, body) => {
  const openOnly = body.includeDischarged !== true;

  const { rows } = await database.query(
    `
      SELECT k.*, s.student_id AS student_number, s.first_name, s.last_name,
             s.grade_level, s.class_section, s.parent_name, s.parent_phone,
             s.blood_group, s.medical_record
      FROM sick_bay_records k
      JOIN students s ON s.id = k.student_id
      WHERE ($1 = false OR k.discharged_at IS NULL)
      ORDER BY k.admitted_at DESC
      LIMIT $2
    `,
    [openOnly, Number(body.limit) > 0 ? Math.min(Number(body.limit), 200) : 50],
  );

  return {
    records: rows.map((row) => ({
      ...row,
      full_name: `${row.first_name} ${row.last_name}`.trim(),
      open: !row.discharged_at,
    })),
  };
};

/**
 * Admitting a student to the sick bay.
 *
 * A student already admitted and not discharged is returned as-is rather than admitted twice: two
 * open episodes for one child would make "who is in the sick bay?" ambiguous, and the honest answer
 * to a second admission is that the first one never ended.
 */
const admit = async (database, body, actor) => {
  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const complaint = trimmed(body.complaint);
  if (!complaint) return { error: 'Say what the student is complaining of' };

  const open = await database.query(
    'SELECT * FROM sick_bay_records WHERE student_id = $1 AND discharged_at IS NULL LIMIT 1',
    [student.id],
  );
  if (open.rows[0]) return { record: open.rows[0], already: true };

  const temperature = Number(body.temperature);

  const { rows } = await database.query(
    `
      INSERT INTO sick_bay_records
        (id, student_id, complaint, treatment, temperature, outcome, referred_to,
         parent_informed, note, recorded_by)
      VALUES ($1, $2, $3, $4, $5, 'resting', $6, $7, $8, $9)
      RETURNING *
    `,
    [
      randomUUID(), student.id, complaint, trimmed(body.treatment),
      Number.isFinite(temperature) && temperature > 0 ? temperature : null,
      trimmed(body.referredTo), body.parentInformed === true, trimmed(body.note),
      actor?.name || actor?.email || '',
    ],
  );

  /* The night's roll should agree with the sick bay without the matron marking the same child
     twice. Marking is best-effort: a failure here must not lose the admission itself. */
  try {
    await mark(database, {
      studentId: student.id, status: 'sick_bay', date: dateOf(body), check: checkOf(body),
      note: complaint,
    }, actor);
  } catch (error) {
    console.warn('Could not mark the roll for a sick bay admission:', error instanceof Error ? error.message : error);
  }

  return { record: rows[0], student: { id: student.id, full_name: `${student.first_name} ${student.last_name}`.trim() } };
};

/** Closing an episode. The outcome says how it ended; 'resting' is not an ending. */
const discharge = async (database, body, actor) => {
  const id = trimmed(body.recordId);
  if (!id) return { error: 'Which sick bay record?' };

  const outcome = OUTCOMES.includes(trimmed(body.outcome)) ? trimmed(body.outcome) : 'discharged';
  if (outcome === 'resting') return { error: 'Resting is not a discharge' };

  const { rows } = await database.query(
    `
      UPDATE sick_bay_records
      SET discharged_at = NOW(), outcome = $2, treatment = $3, referred_to = $4,
          parent_informed = $5, note = $6, recorded_by = $7
      WHERE id = $1 AND discharged_at IS NULL
      RETURNING *
    `,
    [
      id, outcome, trimmed(body.treatment), trimmed(body.referredTo),
      body.parentInformed === true, trimmed(body.note),
      actor?.name || actor?.email || '',
    ],
  );
  if (!rows[0]) return { error: 'That student has already been discharged' };
  return { record: rows[0] };
};

/**
 * Where one student sleeps, or null for a day student.
 *
 * Exported as a plain function rather than as an action, and deliberately: every action in this
 * module goes through `MATRON_GATE`, which is the matron's and the head's alone. A class teacher
 * looking at a student's file is entitled to know which hostel that child is in — the section
 * policy in scan-profiles.mjs already says so — but is not entitled to the dormitory screens.
 * Callers that have already done their own permission check reach the fact through here.
 *
 * Boarding is not a column on `students`; an active assignment is what makes a student a boarder,
 * so the absence of a row here is the answer "day student" rather than missing data.
 */
export const dormitoryForStudent = async (database, studentId) => {
  const { rows } = await database.query(
    `
      SELECT a.bed_number, a.status, a.start_date, r.hostel_name, r.room_number
      FROM hostel_assignments a
      JOIN hostel_rooms r ON r.id = a.room_id
      WHERE a.student_id = $1 AND a.status = 'active'
      LIMIT 1
    `,
    [studentId],
  );

  const room = rows[0];
  return room
    ? {
        hostel_name: room.hostel_name,
        room_number: room.room_number,
        bed_number: room.bed_number,
        since: room.start_date,
      }
    : null;
};

/** One room with its live occupancy, or null. */
const roomWithOccupancy = async (database, roomId) => {
  const { rows } = await database.query('SELECT * FROM hostel_rooms WHERE id = $1 LIMIT 1', [roomId]);
  if (!rows[0]) return null;

  const counted = await database.query(
    `SELECT COUNT(*)::int AS n FROM hostel_assignments WHERE room_id = $1 AND status = 'active'`,
    [roomId],
  );
  return { ...rows[0], occupied: counted.rows[0].n };
};

/**
 * The dormitories, how full they are, and who is in them.
 *
 * The occupants are the point. A count alone tells the matron a room is full but not which child to
 * move, so the one thing she wants to do standing in the corridor — take this boy out of that bed —
 * could not be reached from the list at all. One extra query rather than one per room: this is
 * opened on a handset, and a request per dormitory is a screen that never loads.
 */
const rooms = async (database) => {
  const { rows } = await database.query(
    'SELECT * FROM hostel_rooms ORDER BY hostel_name ASC, room_number ASC',
  );

  const { rows: beds } = await database.query(
    `
      SELECT a.id AS assignment_id, a.room_id, a.bed_number, a.start_date,
             s.id AS student_id, s.student_id AS student_number,
             s.first_name, s.last_name, s.grade_level, s.class_section
      FROM hostel_assignments a
      JOIN students s ON s.id = a.student_id
      WHERE a.status = 'active'
      ORDER BY s.last_name ASC, s.first_name ASC
    `,
  );

  const byRoom = new Map();
  for (const bed of beds) {
    if (!byRoom.has(bed.room_id)) byRoom.set(bed.room_id, []);
    byRoom.get(bed.room_id).push(bed);
  }

  return {
    rooms: rows.map((row) => {
      const occupants = byRoom.get(row.id) || [];
      const occupied = occupants.length;
      return {
        ...row,
        occupants,
        occupied,
        free: Math.max(0, Number(row.capacity) - occupied),
        full: occupied >= Number(row.capacity),
      };
    }),
  };
};

/**
 * Giving a student a bed.
 *
 * A full room is refused with a sentence rather than overfilled, and an existing live assignment is
 * ended rather than left beside the new one — a student sleeping in two rooms at once is not a
 * state the roll call can make sense of.
 */
const assignBed = async (database, body, actor) => {
  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const roomId = trimmed(body.roomId);
  if (!roomId) return { error: 'Which room?' };

  const room = await roomWithOccupancy(database, roomId);
  if (!room) return { error: 'That room no longer exists' };

  const alreadyHere = await database.query(
    `SELECT id FROM hostel_assignments WHERE student_id = $1 AND room_id = $2 AND status = 'active' LIMIT 1`,
    [student.id, roomId],
  );

  if (!alreadyHere.rows[0] && Number(room.occupied) >= Number(room.capacity)) {
    return { error: `${room.hostel_name} room ${room.room_number} is full (${room.occupied} of ${room.capacity})` };
  }
  if (alreadyHere.rows[0]) return { assignment: alreadyHere.rows[0], already: true };

  await database.query(
    `UPDATE hostel_assignments SET status = 'ended', end_date = $2
      WHERE student_id = $1 AND status = 'active'`,
    [student.id, todayIso()],
  );

  const { rows } = await database.query(
    `
      INSERT INTO hostel_assignments (id, student_id, room_id, bed_number, start_date, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
    `,
    [randomUUID(), student.id, roomId, trimmed(body.bedNumber), todayIso()],
  );
  return { assignment: rows[0] };
};

const releaseBed = async (database, body) => {
  const student = await resolveStudent(database, body.studentId);
  if (!student) return { error: 'No student matches that number' };

  const { rows } = await database.query(
    `UPDATE hostel_assignments SET status = 'ended', end_date = $2
      WHERE student_id = $1 AND status = 'active' RETURNING *`,
    [student.id, todayIso()],
  );
  if (!rows[0]) return { error: 'That student does not have a bed' };
  return { assignment: rows[0] };
};

/**
 * Adding a dormitory room, or changing one.
 *
 * The matron is the person who knows a room has six beds in it and not four, so she keeps this list
 * rather than filing a request with the office and waiting. Capacity cannot be cut below the number
 * of children already sleeping there: the alternative is a room that reports itself over-full, and
 * a roll call that cannot be reconciled against it.
 */
const saveRoom = async (database, body) => {
  const hostelName = trimmed(body.hostelName);
  const roomNumber = trimmed(body.roomNumber);
  if (!hostelName) return { error: 'Which hostel?' };
  if (!roomNumber) return { error: 'Which room?' };

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1) {
    return { error: 'How many beds? A whole number, at least one.' };
  }

  const id = trimmed(body.roomId);

  /* Same hostel, same room number, two rows: they cannot be told apart on any screen that lists
     them, and the beds in one room would report as two half-empty ones. */
  const clash = await database.query(
    `SELECT id, hostel_name, room_number FROM hostel_rooms
      WHERE UPPER(hostel_name) = UPPER($1) AND UPPER(room_number) = UPPER($2) AND id <> $3 LIMIT 1`,
    [hostelName, roomNumber, id || ''],
  );
  /* The stored spelling, not the typed one. The match is case-insensitive, so telling a matron who
     typed "nile house" that "nile house already has a room 12" leaves her looking for a hostel by
     that name and not finding it. */
  if (clash.rows[0]) {
    return { error: `${clash.rows[0].hostel_name} already has a room ${clash.rows[0].room_number}` };
  }

  if (!id) {
    const { rows } = await database.query(
      `INSERT INTO hostel_rooms (id, hostel_name, room_number, capacity)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [randomUUID(), hostelName, roomNumber, capacity],
    );
    return { room: { ...rows[0], occupants: [], occupied: 0, free: capacity, full: false } };
  }

  const existing = await roomWithOccupancy(database, id);
  if (!existing) return { error: 'That room no longer exists' };

  const occupied = Number(existing.occupied);
  if (capacity < occupied) {
    return {
      error: `${occupied} ${occupied === 1 ? 'child sleeps' : 'children sleep'} in ${existing.hostel_name} ${existing.room_number}. Move them before cutting it to ${capacity} ${capacity === 1 ? 'bed' : 'beds'}.`,
    };
  }

  const { rows } = await database.query(
    'UPDATE hostel_rooms SET hostel_name = $2, room_number = $3, capacity = $4 WHERE id = $1 RETURNING *',
    [id, hostelName, roomNumber, capacity],
  );
  return {
    room: { ...rows[0], occupied, free: Math.max(0, capacity - occupied), full: occupied >= capacity },
  };
};

/**
 * Taking a room off the list.
 *
 * Refused while anyone still sleeps there — and not merely for tidiness. `hostel_assignments`
 * references `hostel_rooms` ON DELETE CASCADE, so deleting an occupied room would take the
 * assignments with it and erase the record of who slept where, silently and with no way back.
 */
const removeRoom = async (database, body) => {
  const id = trimmed(body.roomId);
  if (!id) return { error: 'Which room?' };

  const room = await roomWithOccupancy(database, id);
  if (!room) return { error: 'That room no longer exists' };

  const occupied = Number(room.occupied);
  if (occupied > 0) {
    return {
      error: `${occupied} ${occupied === 1 ? 'child still sleeps' : 'children still sleep'} in ${room.hostel_name} ${room.room_number}. Move them out first.`,
    };
  }

  await database.query('DELETE FROM hostel_rooms WHERE id = $1', [id]);
  return { removed: id };
};

/**
 * The boarders who still owe a mandatory requirement.
 *
 * The matron is usually the person who notices — she is the one in the dormitory looking at whether
 * a child has a mosquito net — so the same list the bursar reads is on her screen too, narrowed to
 * the students who actually sleep here.
 */
const welfare = async (database, body) => {
  /* The same derivation the bursar's list uses, narrowed to the students who actually sleep here —
     shared rather than re-queried, so the matron and the office cannot report different answers to
     the same question. */
  const { rows } = await database.query(
    `
      SELECT s.id, s.student_id, s.first_name, s.last_name, s.grade_level, s.class_section,
             r.hostel_name, r.room_number
      FROM hostel_assignments a
      JOIN students s ON s.id = a.student_id
      JOIN hostel_rooms r ON r.id = a.room_id
      WHERE a.status = 'active'
        AND ($1 = '' OR r.hostel_name = $1)
      ORDER BY r.hostel_name ASC, r.room_number ASC, s.last_name ASC
    `,
    [trimmed(body.hostel)],
  );

  const owing = await outstandingForStudents(database, {
    term: trimmed(body.term) || 'Term 1',
    academicYear: trimmed(body.academicYear) || String(new Date().getFullYear()),
    students: rows,
  });

  return {
    students: owing.map((entry) => ({ ...entry, student_number: entry.student_id })),
  };
};

const ACTIONS = {
  dashboard,
  dorm_roll: dormRoll,
  mark,
  sick_bay: sickBay,
  admit,
  discharge,
  rooms,
  assign_bed: assignBed,
  release_bed: releaseBed,
  save_room: saveRoom,
  remove_room: removeRoom,
  welfare,
};

export const handleMatronFunction = async (database, body = {}, { actor: authenticated } = {}) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requirePost(actor, MATRON_GATE);
  if (refusal) return refusal;

  const action = trimmed(body.action) || 'dashboard';
  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported action: ${action}` };

  return handler(database, body, actor);
};
