import { randomUUID } from 'node:crypto';

import { requireRole, resolveActor } from '../auth/actor.mjs';
import { PRIVILEGED_ROLES } from '../auth/roles.mjs';
import { withTransaction } from '../db/connection.mjs';

/**
 * Taking the school's records out, and putting them back.
 *
 * Distinct from a backup on purpose. A backup is a `pg_dump` — opaque, complete, and for restoring
 * this database. An export is readable: CSV a bursar can open in a spreadsheet, or JSON another
 * system can read. They answer different questions, so neither replaces the other.
 *
 * What is deliberately left out, and why:
 *
 *   - `users.password_hash` — a hash is still a credential, and one that survives leaving here.
 *   - `provider_credentials.api_key` and `mcp_servers.auth_token` — the first is ciphertext that
 *     only means anything under this deployment's SECRETS_KEY, and the second is stored in
 *     plaintext, so exporting it would hand over live tokens.
 *   - `curriculum_chunks` and seeded `curriculum_documents` — rebuildable by re-chunking.
 *   - `analytics_snapshots`, `compliance_reports` — derived, and regenerated on demand.
 *
 * The Meilisearch index is not here either: Postgres is the system of record, and a restore ends by
 * reindexing rather than by carrying a copy of something derived.
 */

/** Columns that never leave, whatever table they are found on. */
const NEVER_EXPORT = new Set(['password_hash', 'api_key', 'auth_token', 'api_secret']);

/** Tables holding nothing that a restore needs, because they can be rebuilt from what is here. */
const REBUILDABLE = new Set([
  'curriculum_chunks',
  'analytics_snapshots',
  'compliance_reports',
  'internal_message_reads',
]);

/**
 * The order rows must be written back in.
 *
 * Foreign keys make this a dependency order, not an alphabetical one: an invoice needs its student,
 * a receipt needs its payment, a gate pass needs the permission it was issued against. Anything not
 * named here is written after, in the order the export listed it.
 */
export const RESTORE_ORDER = [
  'students',
  'teachers',
  'subjects_catalog',
  'classes',
  'exams',
  'fee_structures',
  'curriculum_documents',
  'library_books',
  'transport_routes',
  'hostel_rooms',
  'exam_blueprints',
  'invoices',
  'payments',
  'receipts',
  'gate_permissions',
  'gate_passes',
  'exam_clearances',
  'exam_admissions',
  'exam_questions',
  'generated_papers',
];

/** Which tables a school may take with it, and which columns of each. */
export const exportableTables = (tables) =>
  Object.entries(tables)
    .filter(([name]) => !REBUILDABLE.has(name))
    .map(([name, definition]) => ({
      name,
      columns: definition.columns.filter((column) => !NEVER_EXPORT.has(column)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * One CSV cell.
 *
 * Everything is quoted rather than only what needs it. A name with a comma, a note with a newline
 * and a field that is empty are all the same shape then, which is what stops a spreadsheet reading
 * one row as two.
 */
const csvCell = (value) => {
  if (value === null || value === undefined) return '""';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const toCsv = (columns, rows) =>
  [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))].join('\n');

const readTable = async (database, name, columns) => {
  const { rows } = await database.query(`SELECT ${columns.join(', ')} FROM ${name}`);
  return rows;
};

const listTables = async ({ tables }) => ({ tables: exportableTables(tables) });

const exportData = async ({ database, body, actor, tables }) => {
  const requested = Array.isArray(body.tables) && body.tables.length > 0 ? body.tables : null;
  const wanted = exportableTables(tables).filter((t) => !requested || requested.includes(t.name));
  if (wanted.length === 0) return { error: 'No exportable tables were named.' };

  const format = body.format === 'csv' ? 'csv' : 'json';
  const files = [];
  let rowCount = 0;

  for (const table of wanted) {
    const rows = await readTable(database, table.name, table.columns);
    rowCount += rows.length;
    files.push({
      name: `${table.name}.${format}`,
      table: table.name,
      rows: rows.length,
      content: format === 'csv' ? toCsv(table.columns, rows) : JSON.stringify(rows, null, 2),
    });
  }

  await database.query(
    `INSERT INTO audit_logs (id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes)
     VALUES ($1, $2, $3, $4, 'data_exported', 'export', NULL, $5, $6)`,
    [
      randomUUID(),
      actor?.email || '',
      actor?.name || '',
      actor?.role || '',
      `${wanted.length} tables`,
      JSON.stringify({ format, tables: wanted.map((t) => t.name), rows: rowCount }),
    ],
  );

  return { format, exportedAt: new Date().toISOString(), rowCount, files };
};

/**
 * Check an import without writing anything.
 *
 * Always run first, and the writing path refuses without it. An import is the one operation here
 * that can destroy records rather than copy them, and "what would this do" is a question worth
 * being able to ask before the answer is permanent.
 */
const validate = (tables, payload) => {
  const problems = [];
  const summary = [];

  if (!payload || typeof payload !== 'object') {
    return { problems: [{ table: '—', problem: 'The file did not read as data.' }], summary };
  }

  for (const [name, rows] of Object.entries(payload)) {
    const definition = tables[name];
    if (!definition) {
      problems.push({ table: name, problem: 'Not a table this school holds; it would be skipped.' });
      continue;
    }
    if (REBUILDABLE.has(name)) {
      problems.push({ table: name, problem: 'Rebuilt from other tables, so it is not imported.' });
      continue;
    }
    if (!Array.isArray(rows)) {
      problems.push({ table: name, problem: 'Expected a list of rows.' });
      continue;
    }

    const allowed = new Set(definition.columns.filter((c) => !NEVER_EXPORT.has(c)));
    const unknown = new Set();
    let missingId = 0;

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (!row.id) missingId += 1;
      for (const column of Object.keys(row)) if (!allowed.has(column)) unknown.add(column);
    }

    if (missingId > 0) {
      problems.push({ table: name, problem: `${missingId} row(s) have no id, so they cannot be matched or written.` });
    }
    if (unknown.size > 0) {
      problems.push({ table: name, problem: `Columns that would be ignored: ${[...unknown].join(', ')}.` });
    }
    summary.push({ table: name, rows: rows.length });
  }

  return { problems, summary };
};

const dryRun = async ({ body, tables }) => {
  const { problems, summary } = validate(tables, body.data);
  return {
    dryRun: true,
    summary,
    problems,
    // Named rather than implied: a caller has to pass this back to actually write.
    token: problems.length === 0 ? 'ready' : '',
  };
};

const importData = async ({ database, body, actor, tables }) => {
  if (body.confirm !== 'ready') {
    return { error: 'Run the check first — an import is only allowed once it has been previewed.' };
  }

  const { problems, summary } = validate(tables, body.data);
  if (problems.length > 0) return { error: 'The file still has problems; run the check again.', problems };

  const ordered = [
    ...RESTORE_ORDER.filter((name) => body.data[name]),
    ...Object.keys(body.data).filter((name) => !RESTORE_ORDER.includes(name) && tables[name]),
  ];

  let written = 0;
  await withTransaction(database, async (executor) => {
    for (const name of ordered) {
      if (REBUILDABLE.has(name)) continue;
      const columns = tables[name].columns.filter((c) => !NEVER_EXPORT.has(c));

      for (const row of body.data[name]) {
        const present = columns.filter((column) => row[column] !== undefined);
        if (present.length === 0 || !row.id) continue;

        const values = present.map((column) => row[column]);
        const placeholders = present.map((_, index) => `$${index + 1}`);
        // Existing rows are updated rather than rejected: an import is usually a re-import, and
        // failing the whole file because one student is already on the roll helps nobody.
        const updates = present.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`);

        await executor.query(
          `INSERT INTO ${name} (${present.join(', ')}) VALUES (${placeholders.join(', ')})
           ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`,
          values,
        );
        written += 1;
      }
    }
  });

  await database.query(
    `INSERT INTO audit_logs (id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes)
     VALUES ($1, $2, $3, $4, 'data_imported', 'import', NULL, $5, $6)`,
    [
      randomUUID(),
      actor?.email || '',
      actor?.name || '',
      actor?.role || '',
      `${ordered.length} tables`,
      JSON.stringify({ tables: summary, rowsWritten: written }),
    ],
  );

  return { imported: true, rowsWritten: written, summary };
};

const ACTIONS = {
  list_tables: listTables,
  export: exportData,
  check_import: dryRun,
  import: importData,
};

export const DATA_TRANSFER_ACTIONS = Object.keys(ACTIONS);

export const handleDataTransferFunction = async (
  database,
  body = {},
  { actor: authenticated, tenantId, tables } = {},
) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, PRIVILEGED_ROLES);
  if (refusal) return refusal;

  const action = String(body.action || 'list_tables').trim();
  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported data action: ${action}` };

  return handler({ database, body, actor, tenantId, tables });
};
