import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { requireRole, resolveActor } from '../auth/actor.mjs';
import { PRIVILEGED_ROLES } from '../auth/roles.mjs';

/**
 * Backups of a school's database.
 *
 * A backup here is a real `pg_dump`, not a hand-rolled dump of our own. Writing one is easy and
 * restoring one correctly is not — foreign keys, sequences, partial indexes and the order they must
 * be applied in are exactly where a home-made restore loses data, quietly, at the worst moment.
 * `pg_dump` and `pg_restore` already know all of that.
 *
 * Three things follow from what a dump actually contains — every student record, every password
 * hash, and the MCP tokens that `mcp_servers` still stores in plaintext:
 *
 *   - it is written to a directory the web process owns, never into the tenant database;
 *   - it is reachable only by the roles that answer for the institution (PRIVILEGED_ROLES);
 *   - taking, downloading, deleting or restoring one is written to the audit trail, and a restore
 *     is audited *before* it runs, because a restore that goes wrong may take the audit row with it.
 *
 * `pg_dump` is injected rather than called directly, the way provisioning.mjs injects
 * createPhysicalDatabase, so the whole flow — the argv, the filename, the role gate, the audit row
 * — is testable without a Postgres or a subprocess.
 */

const BACKUP_DIR = () => process.env.BACKUP_DIR || '/var/backups/eschool';

/** Backups are per school, and a filename is the only thing tying one to its tenant on disk. */
const fileNameFor = (tenantId) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTenant = String(tenantId || 'default').replace(/[^a-z0-9_-]/gi, '_');
  return `${safeTenant}-${stamp}.dump`;
};

/**
 * Where a dump goes, resolved and then checked.
 *
 * The filename comes from the database, but a row could have been written by anything; joining it
 * onto a directory without checking would let `../../etc/something` out of the backup directory.
 */
const resolveBackupPath = (filename) => {
  const directory = path.resolve(BACKUP_DIR());
  const resolved = path.resolve(directory, filename);
  if (resolved !== path.join(directory, path.basename(filename))) return null;
  return resolved;
};

/**
 * The connection string for the database being backed up.
 *
 * `pg` keeps it on the pool options, which is the only place a request handler can reach it — the
 * control plane deliberately never hands `db_url` to a caller.
 */
const connectionStringFor = (database) => database?.pool?.options?.connectionString || '';

/** The default runner. Kept tiny so the injected test double has an obvious shape to match. */
const defaultRunPgDump = ({ connectionString, destination }) =>
  new Promise((resolve, reject) => {
    // --format=custom so pg_restore can be selective, and it compresses. --no-owner/--no-acl so the
    // dump restores into a database owned by a different role, which is what a recovery usually is.
    const args = ['--format=custom', '--no-owner', '--no-acl', '--file', destination, connectionString];
    const child = spawn('pg_dump', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) =>
      reject(new Error(`pg_dump could not be started: ${error.message}. Is postgresql-client installed?`)),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`)),
    );
  });

const writeAudit = async (database, actor, { action, entityId, entityName, changes }) => {
  await database.query(
    `
      INSERT INTO audit_logs (
        id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes
      ) VALUES ($1, $2, $3, $4, $5, 'backup', $6, $7, $8)
    `,
    [
      randomUUID(),
      actor?.email || '',
      actor?.name || '',
      actor?.role || '',
      action,
      entityId || null,
      entityName || null,
      JSON.stringify(changes || {}),
    ],
  );
};

/**
 * Whether a scheduler is actually running in this process.
 *
 * Set by the scheduler when it starts, rather than inferred from the env var it reads, so the
 * screen reports what is true of this process and not what its configuration hoped for. A flag here
 * rather than an import from the scheduler, which imports this module.
 */
let schedulerRunning = false;
export const setSchedulerRunning = (running) => {
  schedulerRunning = Boolean(running);
};
const schedulerIsRunning = () => schedulerRunning;

const listBackups = async ({ database }) => {
  const { rows } = await database.query(
    `SELECT id, filename, size_bytes, kind, status, error, encrypted, created_by, created_at
     FROM school_backups ORDER BY created_at DESC LIMIT 100`,
  );
  const schedule = await loadBackupSchedule(database);
  return {
    backups: rows,
    // The UI says plainly when backups cannot be taken here, rather than offering a button that
    // fails: pg-mem has no dump, and a deployment without postgresql-client cannot make one.
    available: database.kind === 'postgres',
    directory: BACKUP_DIR(),
    schedule: {
      enabled: Boolean(schedule.enabled),
      runAt: schedule.run_at || '02:00',
      timezone: schedule.timezone || '',
      keepLast: Number(schedule.keep_last) || 7,
      lastRunAt: schedule.last_run_at || null,
      lastError: schedule.last_error || '',
      // Whether anything is actually running the schedule. A schedule saved on a deployment with
      // the scheduler switched off would otherwise sit there looking armed and never fire.
      runnerActive: schedulerIsRunning(),
    },
  };
};

/**
 * Delete the oldest scheduled backups beyond the ones the school asked to keep.
 *
 * Only scheduled ones. A manual backup is a deliberate act — somebody took it before a risky
 * change, and having the machine delete it a week later because an unrelated retention number said
 * so would be its own kind of data loss. Automatic backups are the ones that accumulate on their
 * own, so they are the ones pruned on their own.
 */
const pruneScheduledBackups = async ({ database, keep }) => {
  const limit = Number.isFinite(Number(keep)) ? Math.max(1, Math.floor(Number(keep))) : 7;
  const { rows } = await database.query(
    `SELECT id, filename FROM school_backups
     WHERE kind = 'scheduled' ORDER BY created_at DESC`,
  );

  const surplus = rows.slice(limit);
  for (const row of surplus) {
    const destination = resolveBackupPath(row.filename);
    if (destination) await rm(destination, { force: true });
    await database.query('DELETE FROM school_backups WHERE id = $1', [row.id]);
  }
  return surplus.length;
};

const createBackup = async ({ database, actor, tenantId, runPgDump, kind = 'manual' }) => {
  if (database.kind !== 'postgres') {
    return { error: 'Backups need a real PostgreSQL database. This server is running on an in-memory one.' };
  }

  const connectionString = connectionStringFor(database);
  if (!connectionString) {
    return { error: 'The server could not determine its own database connection, so it cannot back it up.' };
  }

  const filename = fileNameFor(tenantId);
  const destination = resolveBackupPath(filename);
  const id = randomUUID();

  // The row is written first and completed after. A crash mid-dump then leaves a row saying
  // 'running' rather than a half-written file that reads as a usable backup.
  // created_by is blank for a scheduled run — nobody pressed anything — and the UI reads a blank
  // author as 'automatic'.
  await database.query(
    `INSERT INTO school_backups (id, filename, kind, status, created_by)
     VALUES ($1, $2, $4, 'running', $3)`,
    [id, filename, actor?.email || '', kind === 'scheduled' ? 'scheduled' : 'manual'],
  );

  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await (runPgDump || defaultRunPgDump)({ connectionString, destination });
    const { size } = await stat(destination);

    await database.query(
      `UPDATE school_backups SET status = 'complete', size_bytes = $2 WHERE id = $1`,
      [id, size],
    );
    await writeAudit(database, actor, {
      action: 'backup_created',
      entityId: id,
      entityName: filename,
      changes: { size_bytes: size },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup failed';
    await database.query(`UPDATE school_backups SET status = 'failed', error = $2 WHERE id = $1`, [
      id,
      message,
    ]);
    return { error: `Backup failed: ${message}` };
  }

  return listBackups({ database });
};

const DEFAULT_SCHEDULE = {
  id: 'default',
  enabled: false,
  run_at: '02:00',
  timezone: '',
  keep_last: 7,
  last_run_at: null,
  last_error: '',
};

/** 'HH:MM' on a 24-hour clock, or null. Anything else is a typo, not a time. */
const normalizeRunAt = (value) => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};

/**
 * A timezone name Intl will accept, or '' for the server's own.
 *
 * Checked by trying it, because the list of valid zone names belongs to the platform's ICU data and
 * not to us — a name this Node build cannot resolve would otherwise throw once a day, at 2am.
 */
const normalizeTimezone = (value) => {
  const zone = String(value ?? '').trim();
  if (!zone) return '';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
};

/**
 * The date and wall-clock time at an instant, as the school's clock would read them.
 *
 * Formatted rather than computed from an offset so daylight saving is the platform's problem: a
 * school on a clock that shifts twice a year still backs up at the hour it asked for.
 */
const localClock = (instant, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    day: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour') === '24' ? '00' : value('hour')}:${value('minute')}`,
  };
};

/**
 * Whether an unattended backup is owed right now.
 *
 * Expressed as "the hour has come round and today's has not been taken" rather than as an interval
 * since the last one. That is what makes it survive a restart: a container that comes back up at
 * 09:00 having missed 02:00 still takes the day's backup, and one restarted at 01:59 takes it at
 * 02:00 rather than skipping the day, because neither is reasoning about elapsed time.
 */
export const isBackupDue = (schedule, now = new Date()) => {
  if (!schedule?.enabled) return false;
  const runAt = normalizeRunAt(schedule.run_at);
  if (!runAt) return false;

  const timezone = normalizeTimezone(schedule.timezone) ?? '';
  const clock = localClock(now, timezone);
  if (clock.time < runAt) return false;

  if (!schedule.last_run_at) return true;
  return localClock(new Date(schedule.last_run_at), timezone).day !== clock.day;
};

export const loadBackupSchedule = async (database) => {
  try {
    const { rows } = await database.query(
      `SELECT id, enabled, run_at, timezone, keep_last, last_run_at, last_error
       FROM school_backup_schedule WHERE id = 'default' LIMIT 1`,
    );
    return rows[0] || { ...DEFAULT_SCHEDULE };
  } catch {
    // The table may not exist yet on a database that has not been migrated. No schedule is a
    // perfectly good answer: it means no unattended backups, which is also the default.
    return { ...DEFAULT_SCHEDULE };
  }
};

const saveSchedule = async ({ database, body, actor }) => {
  const runAt = normalizeRunAt(body.runAt ?? DEFAULT_SCHEDULE.run_at);
  if (!runAt) return { error: 'Give the time as HH:MM on a 24-hour clock, for example 02:00.' };

  const timezone = normalizeTimezone(body.timezone);
  if (timezone === null) {
    return { error: 'That is not a timezone this server recognises. Leave it blank to use the server clock.' };
  }

  const keepLast = Math.min(365, Math.max(1, Math.floor(Number(body.keepLast) || DEFAULT_SCHEDULE.keep_last)));
  const enabled = Boolean(body.enabled);

  await database.query(
    `
      INSERT INTO school_backup_schedule (id, enabled, run_at, timezone, keep_last, updated_by, updated_at)
      VALUES ('default', $1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        run_at = EXCLUDED.run_at,
        timezone = EXCLUDED.timezone,
        keep_last = EXCLUDED.keep_last,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `,
    [enabled, runAt, timezone, keepLast, actor?.email || ''],
  );

  await writeAudit(database, actor, {
    action: 'backup_schedule_updated',
    entityId: 'default',
    entityName: enabled ? `daily at ${runAt}` : 'disabled',
    changes: { enabled, run_at: runAt, timezone, keep_last: keepLast },
  });

  return listBackups({ database });
};

/**
 * Take the day's backup for one database, if one is owed. Called by the scheduler, not by a route.
 *
 * `last_run_at` is stamped whether the dump succeeded or failed, so a database that cannot be
 * dumped is retried tomorrow rather than every minute for the rest of the day.
 */
export const runScheduledBackup = async ({ database, tenantId, runPgDump, now = new Date() }) => {
  const schedule = await loadBackupSchedule(database);
  if (!isBackupDue(schedule, now)) return { ran: false };

  const result = await createBackup({ database, actor: null, tenantId, runPgDump, kind: 'scheduled' });
  const failure = result?.error || '';
  if (!failure) await pruneScheduledBackups({ database, keep: schedule.keep_last });

  await database.query(
    `UPDATE school_backup_schedule SET last_run_at = $1, last_error = $2 WHERE id = 'default'`,
    [now.toISOString(), failure],
  );

  return { ran: true, error: failure || undefined };
};

const deleteBackup = async ({ database, body, actor }) => {
  const id = String(body.id || '').trim();
  if (!id) return { error: 'Which backup?' };

  const { rows } = await database.query('SELECT filename FROM school_backups WHERE id = $1', [id]);
  if (rows.length === 0) return { error: 'That backup is not on file.' };

  const destination = resolveBackupPath(rows[0].filename);
  if (destination) await rm(destination, { force: true });
  await database.query('DELETE FROM school_backups WHERE id = $1', [id]);
  await writeAudit(database, actor, {
    action: 'backup_deleted',
    entityId: id,
    entityName: rows[0].filename,
  });

  return listBackups({ database });
};

/**
 * Read a completed backup off disk, for the download route.
 *
 * Not part of ACTIONS: it returns bytes rather than JSON, so it is called from the GET handler.
 */
export const readBackupFile = async (database, id) => {
  const { rows } = await database.query(
    "SELECT filename, status FROM school_backups WHERE id = $1 AND status = 'complete'",
    [id],
  );
  if (rows.length === 0) return null;

  const destination = resolveBackupPath(rows[0].filename);
  if (!destination) return null;

  try {
    return { filename: rows[0].filename, bytes: await readFile(destination) };
  } catch {
    // On disk according to the database, but gone from the filesystem — a wiped volume, usually.
    return null;
  }
};

const ACTIONS = {
  list: listBackups,
  create: createBackup,
  delete: deleteBackup,
  save_schedule: saveSchedule,
};

export const BACKUP_ACTIONS = Object.keys(ACTIONS);

export const handleBackupFunction = async (
  database,
  body = {},
  { actor: authenticated, tenantId, runPgDump } = {},
) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, PRIVILEGED_ROLES);
  if (refusal) return refusal;

  const action = String(body.action || 'list').trim();
  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported backup action: ${action}` };

  return handler({ database, body, actor, tenantId, runPgDump });
};
