#!/usr/bin/env node
/**
 * Collapses duplicate attendance rows so the unique index can be created.
 *
 * One record per student per day is the rule, but a database written before the write path upserted
 * can hold several rows for the same day — repeated saves against a stale client list. Those
 * duplicates block idx_attendance_unique, and without that index the upsert cannot work, so the
 * problem sustains itself until it is broken by hand. This is that hand.
 *
 * Dry run by default: it prints what it would remove and changes nothing. Pass --apply to delete.
 *
 *   node scripts/dedupe-attendance.mjs
 *   node scripts/dedupe-attendance.mjs --apply
 *   DATABASE_URL=postgres://... node scripts/dedupe-attendance.mjs --apply
 */
import { createDatabaseConnection } from '../server/db/connection.mjs';

/**
 * Picks the row to keep from each (student, date) group, in priority order:
 *
 *   1. notified_parent — a copy recording that a parent was actually notified is the only one
 *      carrying that fact, and deleting it would lose it silently.
 *   2. created_at, earliest — so the surviving row keeps the real time attendance was first taken.
 *   3. id — a deterministic tiebreak, so repeat runs agree on the same winner.
 *
 * Ranking happens here rather than in SQL because a window function would need PostgreSQL, and
 * keeping it in one plain function means the preview, the delete and the tests all use the very
 * same rule with no chance of drift.
 *
 * Returns { keep, remove } of row ids.
 */
export const chooseSurvivors = (rows) => {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.student_id}|${formatDate(row.attendance_date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const keep = [];
  const remove = [];

  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => {
      if (Boolean(left.notified_parent) !== Boolean(right.notified_parent)) {
        return left.notified_parent ? -1 : 1;
      }
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id).localeCompare(String(right.id));
    });

    keep.push(ordered[0].id);
    remove.push(...ordered.slice(1).map((row) => row.id));
  }

  return { keep, remove };
};

/**
 * Formats a DATE column for display and grouping.
 *
 * `pg` hands back a DATE as a JS Date at *local* midnight, so toISOString() would convert to UTC and
 * print the previous day for anywhere east of Greenwich — showing 2026-08-18 for a row the database
 * stores as 2026-08-19. Read the local components instead.
 */
export const formatDate = (value) => {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
};

const describeTarget = () => {
  const url = process.env.DATABASE_URL;
  if (!url) return 'the default database (DATABASE_URL is unset — see server/db/connection.mjs)';
  // Never print the password.
  return url.replace(/(\/\/[^:]+:)[^@]*(@)/, '$1****$2');
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const database = createDatabaseConnection({});

  try {
    console.log(`Database: ${describeTarget()}`);

    // Every row belonging to a duplicated (student, date) key, with the student's name for display.
    const { rows } = await database.query(`
      SELECT a.id, a.student_id, a.attendance_date, a.status, a.notified_parent, a.created_at,
             s.first_name || ' ' || s.last_name AS student
      FROM attendance_records a
      LEFT JOIN students s ON s.id = a.student_id
      WHERE (a.student_id, a.attendance_date) IN (
        SELECT student_id, attendance_date
        FROM attendance_records
        GROUP BY student_id, attendance_date
        HAVING COUNT(*) > 1
      )
      ORDER BY a.student_id, a.attendance_date, a.created_at
    `);

    const { keep, remove } = chooseSurvivors(rows);

    if (rows.length === 0) {
      console.log('No duplicate (student, date) rows. Nothing to do.');
    } else {
      console.log(`\nFound ${keep.length} duplicated (student, date) key(s), ${remove.length} surplus row(s) to remove:\n`);

      const removing = new Set(remove);
      let currentKey = null;
      for (const row of rows) {
        const key = `${row.student_id}|${formatDate(row.attendance_date)}`;
        if (key !== currentKey) {
          currentKey = key;
          console.log(`  ${row.student || row.student_id} — ${formatDate(row.attendance_date)}`);
        }
        const verdict = removing.has(row.id) ? 'remove' : 'KEEP  ';
        console.log(`    ${verdict} status=${row.status}${row.notified_parent ? ', parent notified' : ''}`);
      }
    }

    if (!apply) {
      console.log('\nDry run — nothing was changed. Re-run with --apply to remove the surplus rows.');
      return;
    }

    if (remove.length > 0) {
      // An expanded IN list rather than `= ANY($1)`: the array form is PostgreSQL-only, and this
      // way the identical statement runs under pg-mem so the tests exercise the real delete.
      const placeholders = remove.map((_, index) => `$${index + 1}`).join(', ');
      const { rowCount } = await database.query(
        `DELETE FROM attendance_records WHERE id IN (${placeholders})`,
        remove,
      );
      console.log(`\nRemoved ${rowCount} surplus row(s).`);
    }

    // The whole point of the cleanup: get the index in place so the upsert can work.
    try {
      await database.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance_records(student_id, attendance_date)',
      );
      // Redundant once the unique index covers the same columns; see ensureAttendanceUniqueness.
      await database.query('DROP INDEX IF EXISTS idx_attendance_student_date');
      console.log('Unique index idx_attendance_unique is in place. Attendance saves now upsert.');
    } catch (error) {
      console.error(
        'Removed the duplicates but could not create the index:',
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
};

// Only run when invoked directly, so the ranking can be imported and tested.
if (process.argv[1] && process.argv[1].endsWith('dedupe-attendance.mjs')) {
  main().catch((error) => {
    console.error('dedupe-attendance failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
