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

const listBackups = async ({ database }) => {
  const { rows } = await database.query(
    `SELECT id, filename, size_bytes, kind, status, error, encrypted, created_by, created_at
     FROM school_backups ORDER BY created_at DESC LIMIT 100`,
  );
  return {
    backups: rows,
    // The UI says plainly when backups cannot be taken here, rather than offering a button that
    // fails: pg-mem has no dump, and a deployment without postgresql-client cannot make one.
    available: database.kind === 'postgres',
    directory: BACKUP_DIR(),
  };
};

const createBackup = async ({ database, actor, tenantId, runPgDump }) => {
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
  await database.query(
    `INSERT INTO school_backups (id, filename, kind, status, created_by)
     VALUES ($1, $2, 'manual', 'running', $3)`,
    [id, filename, actor?.email || ''],
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
