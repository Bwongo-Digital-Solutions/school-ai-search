import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseConnection, waitForDatabase } from './db/connection.mjs';
import { initializeDatabase } from './db/schema.mjs';
import { buildReportCardPdf } from './reports/report-card.mjs';
import { buildIdCardPdf, buildQrPayload, buildQrPng } from './reports/id-card.mjs';
import { getPublicGradingOptions } from './reports/grading-config.mjs';
import { generateLlmSearchReply, getPublicModelCatalog, resolveModelSelection } from './services/llm-models.mjs';
import { getPaymentStatus, initiatePayment, recordPaymentCallback } from './services/payment-gateway.mjs';
import { generateAssistantReply } from './services/student-chat.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const DEFAULT_STATIC_ROOT = process.env.LOCAL_STATIC_ROOT || join(ROOT_DIR, 'dist');
const DEFAULT_HOST = process.env.LOCAL_BACKEND_HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.LOCAL_BACKEND_PORT || process.env.PORT || 8787);

// Keep in sync with the users.role CHECK constraint in server/db/schema.mjs and src/lib/roles.ts.
// 'support_staff' covers non-teaching staff such as security, gatekeepers, cooks, cleaners and drivers.
const USER_ROLES = ['admin', 'teacher', 'support_staff'];

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const TABLES = {
  students: {
    columns: [
      'id',
      'student_id',
      'first_name',
      'last_name',
      'grade_level',
      'class_section',
      'date_of_birth',
      'gender',
      'email',
      'phone',
      'parent_name',
      'parent_phone',
      'parent_email',
      'address',
      'enrollment_date',
      'status',
      'gpa',
      'attendance_rate',
      'blood_group',
      'medical_record',
      'emergency_contact_name',
      'emergency_contact_phone',
      'emergency_contact_relation',
      'lifecycle_status',
      'graduation_date',
      'transfer_date',
      'alumni_notes',
      'subjects',
      'notes',
    ],
    jsonColumns: ['subjects', 'medical_record'],
  },
  conversations: {
    columns: ['id', 'title', 'created_at', 'updated_at'],
    touchesUpdatedAt: true,
  },
  messages: {
    columns: ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'],
    jsonColumns: ['attachments', 'metadata'],
  },
  admissions: {
    columns: [
      'id',
      'application_number',
      'student_id',
      'applicant_first_name',
      'applicant_last_name',
      'grade_level',
      'status',
      'submitted_at',
      'documents',
      'notes',
    ],
    jsonColumns: ['documents'],
  },
  classes: {
    columns: ['id', 'grade_level', 'section_name', 'stream', 'room', 'academic_year', 'capacity'],
  },
  subjects_catalog: {
    columns: ['id', 'code', 'name', 'grade_level', 'department'],
  },
  teachers: {
    columns: ['id', 'staff_id', 'display_name', 'email', 'phone', 'department'],
  },
  subject_allocations: {
    columns: ['id', 'subject_id', 'teacher_id', 'class_id', 'student_id', 'academic_year', 'term'],
  },
  timetables: {
    columns: [
      'id',
      'class_id',
      'teacher_id',
      'subject_id',
      'room',
      'day_of_week',
      'start_time',
      'end_time',
      'academic_year',
      'term',
    ],
  },
  attendance_records: {
    columns: [
      'id',
      'student_id',
      'attendance_date',
      'status',
      'reason',
      'marked_by',
      'notified_parent',
      'created_at',
    ],
  },
  attendance_alerts: {
    columns: ['id', 'student_id', 'attendance_record_id', 'channel', 'recipient', 'status', 'message', 'sent_at'],
  },
  exams: {
    columns: ['id', 'name', 'exam_type', 'academic_year', 'term', 'start_date', 'end_date', 'status'],
  },
  exam_schedules: {
    columns: ['id', 'exam_id', 'subject_id', 'class_id', 'exam_date', 'start_time', 'end_time', 'room'],
  },
  gradebook_entries: {
    columns: [
      'id',
      'student_id',
      'exam_id',
      'subject_id',
      'score',
      'max_score',
      'grade',
      'remarks',
      'rank',
      'created_at',
    ],
  },
  discipline_records: {
    columns: [
      'id',
      'student_id',
      'incident_date',
      'category',
      'severity',
      'description',
      'action_taken',
      'reported_by',
      'guardian_notified',
      'status',
      'created_at',
    ],
  },
  student_promotions: {
    columns: [
      'id',
      'student_id',
      'from_grade_level',
      'from_class_section',
      'to_grade_level',
      'to_class_section',
      'academic_year',
      'effective_date',
      'decision',
      'notes',
      'approved_by',
      'created_at',
    ],
  },
  student_transfers: {
    columns: [
      'id',
      'student_id',
      'movement_type',
      'effective_date',
      'destination_school',
      'reason',
      'documents',
      'status',
      'processed_by',
      'created_at',
    ],
    jsonColumns: ['documents'],
  },
  fee_structures: {
    columns: [
      'id',
      'name',
      'grade_level',
      'student_type',
      'academic_year',
      'term',
      'amount',
      'currency',
      'due_date',
    ],
  },
  payments: {
    columns: [
      'id',
      'student_id',
      'fee_structure_id',
      'amount',
      'currency',
      'payment_method',
      'reference',
      'paid_at',
      'received_by',
    ],
  },
  invoices: {
    columns: [
      'id',
      'student_id',
      'invoice_number',
      'status',
      'total_amount',
      'balance_due',
      'currency',
      'due_date',
      'issued_at',
      'line_items',
    ],
    jsonColumns: ['line_items'],
  },
  receipts: {
    columns: ['id', 'payment_id', 'receipt_number', 'amount', 'currency', 'issued_at'],
  },
  payment_transactions: {
    columns: [
      'id',
      'student_id',
      'invoice_id',
      'provider',
      'charge_type',
      'amount',
      'currency',
      'phone_number',
      'bank_code',
      'account_reference',
      'external_reference',
      'provider_reference',
      'status',
      'status_reason',
      'customer_message',
      'metadata',
      'created_at',
      'updated_at',
    ],
    jsonColumns: ['metadata'],
    touchesUpdatedAt: true,
  },
  portal_accounts: {
    columns: ['id', 'owner_type', 'student_id', 'user_id', 'username', 'status', 'last_login_at'],
  },
  notices: {
    columns: ['id', 'title', 'body', 'audience', 'priority', 'published_at', 'expires_at'],
  },
  internal_messages: {
    columns: ['id', 'sender_user_id', 'recipient_user_id', 'student_id', 'subject', 'body', 'read_at', 'created_at'],
  },
  library_books: {
    columns: ['id', 'isbn', 'title', 'author', 'category', 'copies_total', 'copies_available'],
  },
  library_loans: {
    columns: ['id', 'book_id', 'student_id', 'issued_at', 'due_at', 'returned_at', 'fine_amount', 'status'],
  },
  transport_routes: {
    columns: ['id', 'route_name', 'bus_number', 'driver_name', 'driver_phone', 'stops'],
    jsonColumns: ['stops'],
  },
  transport_assignments: {
    columns: ['id', 'student_id', 'route_id', 'pickup_point', 'dropoff_point', 'status'],
  },
  hostel_rooms: {
    columns: ['id', 'hostel_name', 'room_number', 'capacity', 'inventory'],
    jsonColumns: ['inventory'],
  },
  hostel_assignments: {
    columns: ['id', 'student_id', 'room_id', 'bed_number', 'start_date', 'end_date', 'status'],
  },
  inventory_items: {
    columns: ['id', 'item_name', 'category', 'sku', 'quantity', 'unit_cost', 'location', 'reorder_level'],
  },
  inventory_transactions: {
    columns: ['id', 'item_id', 'transaction_type', 'quantity', 'notes', 'created_at'],
  },
  compliance_reports: {
    columns: ['id', 'report_type', 'period_start', 'period_end', 'status', 'payload', 'created_at'],
    jsonColumns: ['payload'],
  },
  analytics_snapshots: {
    columns: ['id', 'snapshot_type', 'academic_year', 'term', 'metrics', 'created_at'],
    jsonColumns: ['metrics'],
  },
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const sendBinary = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers,
  });
  response.end(body);
};

const sendText = (response, statusCode, text) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(text);
};

const readRequestBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
};

const serveStatic = async (requestPath, response, staticRoot) => {
  if (!existsSync(staticRoot)) {
    sendText(response, 404, 'Build output not found. Run "npm run build" first.');
    return;
  }

  const requestedPath = requestPath === '/' ? '/index.html' : requestPath;
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = resolve(staticRoot, `.${normalizedPath}`);
  const isInsideStaticRoot = filePath.startsWith(resolve(staticRoot));

  if (!isInsideStaticRoot) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  let pathToServe = filePath;
  try {
    const fileStats = await stat(pathToServe);
    if (fileStats.isDirectory()) {
      pathToServe = join(pathToServe, 'index.html');
    }
  } catch {
    pathToServe = join(staticRoot, 'index.html');
  }

  const extension = extname(pathToServe);
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': contentType });
  createReadStream(pathToServe).pipe(response);
};

const nowIso = () => new Date().toISOString();

const hashPassword = (password, salt = randomUUID()) => {
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
};

const verifyPassword = (password, storedHash) => {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, 64);
  const storedKey = Buffer.from(key, 'hex');
  return storedKey.length === derivedKey.length && timingSafeEqual(derivedKey, storedKey);
};

const sanitizeUser = (user) => {
  const { password_hash, ...rest } = user;
  return rest;
};

const requireTable = (table) => {
  const config = TABLES[table];
  if (!config) {
    throw new Error(`Unknown table: ${table}`);
  }
  return config;
};

const resolveColumns = (requestedColumns, allowedColumns) => {
  if (!requestedColumns || requestedColumns === '*') {
    return allowedColumns;
  }

  return requestedColumns
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => {
      if (!allowedColumns.includes(column)) {
        throw new Error(`Unknown column: ${column}`);
      }
      return column;
    });
};

const buildWhereClause = (filters = [], allowedColumns = [], startingIndex = 1) => {
  const values = [];
  const clauses = filters.map((filter, index) => {
    if (filter.operator !== 'eq') {
      throw new Error(`Unsupported filter operator: ${filter.operator}`);
    }
    if (!allowedColumns.includes(filter.field)) {
      throw new Error(`Unknown filter column: ${filter.field}`);
    }
    values.push(filter.value);
    return `"${filter.field}" = $${startingIndex + index}`;
  });

  return {
    clause: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
};

const formatRow = (row) => row;

const serializeValue = (config, column, value) => {
  if (config.jsonColumns?.includes(column)) {
    return JSON.stringify(value ?? (column === 'metadata' ? {} : []));
  }

  return value;
};

const handleDbQuery = async (database, body) => {
  const { table, operation, columns, filters = [], orderBy, limit, payload, single } = body || {};
  const config = requireTable(table);
  const selectedColumns = resolveColumns(columns, config.columns);

  if (operation === 'select') {
    const { clause, values } = buildWhereClause(filters, config.columns);
    const orderClause = orderBy?.field
      ? (() => {
          if (!config.columns.includes(orderBy.field)) {
            throw new Error(`Unknown order column: ${orderBy.field}`);
          }
          return ` ORDER BY "${orderBy.field}" ${orderBy.ascending === false ? 'DESC' : 'ASC'}`;
        })()
      : '';
    const limitClause = typeof limit === 'number' ? ` LIMIT ${Number(limit)}` : '';

    const result = await database.query(
      `SELECT ${selectedColumns.map((column) => `"${column}"`).join(', ')} FROM "${table}"${clause}${orderClause}${limitClause}`,
      values,
    );
    const rows = result.rows.map(formatRow);
    return single ? rows[0] ?? null : rows;
  }

  if (operation === 'insert') {
    const rows = Array.isArray(payload) ? payload : [payload];
    const insertedRows = [];

    for (const row of rows) {
      const data = { ...row, id: row?.id || randomUUID() };
      const insertColumns = Object.keys(data).filter((column) => config.columns.includes(column));
      const values = insertColumns.map((column) => serializeValue(config, column, data[column]));
      const placeholders = insertColumns.map((_, index) => `$${index + 1}`);

      const result = await database.query(
        `
          INSERT INTO "${table}" (${insertColumns.map((column) => `"${column}"`).join(', ')})
          VALUES (${placeholders.join(', ')})
          RETURNING ${selectedColumns.map((column) => `"${column}"`).join(', ')}
        `,
        values,
      );
      insertedRows.push(...result.rows.map(formatRow));
    }

    return single ? insertedRows[0] ?? null : insertedRows;
  }

  if (operation === 'update') {
    if (!filters.length) {
      throw new Error('Update queries must include at least one filter');
    }

    const data = { ...payload };
    if (config.touchesUpdatedAt && config.columns.includes('updated_at')) {
      data.updated_at = nowIso();
    }

    const updateColumns = Object.keys(data).filter((column) => config.columns.includes(column));
    if (updateColumns.length === 0) {
      throw new Error('No valid update columns were provided');
    }

    const setClause = updateColumns.map((column, index) => `"${column}" = $${index + 1}`).join(', ');
    const where = buildWhereClause(filters, config.columns, updateColumns.length + 1);
    const values = [...updateColumns.map((column) => serializeValue(config, column, data[column])), ...where.values];

    const result = await database.query(
      `
        UPDATE "${table}"
        SET ${setClause}
        ${where.clause}
        RETURNING ${selectedColumns.map((column) => `"${column}"`).join(', ')}
      `,
      values,
    );

    return single ? result.rows[0] ?? null : result.rows.map(formatRow);
  }

  if (operation === 'delete') {
    if (!filters.length) {
      throw new Error('Delete queries must include at least one filter');
    }

    const where = buildWhereClause(filters, config.columns);
    const result = await database.query(
      `DELETE FROM "${table}"${where.clause} RETURNING ${selectedColumns.map((column) => `"${column}"`).join(', ')}`,
      where.values,
    );
    return single ? result.rows[0] ?? null : result.rows.map(formatRow);
  }

  throw new Error(`Unsupported operation: ${operation}`);
};

const fetchAllStudents = async (database) => {
  const result = await database.query(
    'SELECT * FROM students ORDER BY last_name ASC, first_name ASC',
  );
  return result.rows.map(formatRow);
};

const fetchStudentById = async (database, studentId) => {
  const result = await database.query('SELECT * FROM students WHERE id = $1 LIMIT 1', [studentId]);
  return result.rows[0] ? formatRow(result.rows[0]) : null;
};

const ensureConversation = async (database, { conversationId, title }) => {
  if (conversationId) {
    const existing = await database.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    if (existing.rows[0]) {
      return formatRow(existing.rows[0]);
    }
  }

  const created = await database.query(
    `
      INSERT INTO conversations (id, title)
      VALUES ($1, $2)
      RETURNING *
    `,
    [randomUUID(), title],
  );
  return formatRow(created.rows[0]);
};

const insertMessage = async (database, { conversationId, role, content, attachments = [], metadata = {} }) => {
  await database.query(
    `
      INSERT INTO messages (id, conversation_id, role, content, attachments, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [randomUUID(), conversationId, role, content, JSON.stringify(attachments), JSON.stringify(metadata)],
  );

  await database.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
};

const handleAuthFunction = async (database, body) => {
  const action = body?.action;

  if (action === 'signup') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();

    if (!email || !password || !displayName) {
      return { error: 'Missing required signup fields' };
    }

    const existing = await database.query('SELECT id FROM users WHERE auth_email = $1 LIMIT 1', [email]);
    if (existing.rows[0]) {
      return { error: 'An account with that email already exists' };
    }

    const userCount = await database.query('SELECT COUNT(*)::int AS count FROM users');
    const role = userCount.rows[0]?.count === 0 ? 'admin' : 'teacher';

    const inserted = await database.query(
      `
        INSERT INTO users (id, auth_email, display_name, role, avatar_url, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, auth_email, display_name, role, avatar_url, created_at
      `,
      [randomUUID(), email, displayName, role, '', hashPassword(password)],
    );

    return { user: sanitizeUser(inserted.rows[0]) };
  }

  if (action === 'signin') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const result = await database.query('SELECT * FROM users WHERE auth_email = $1 LIMIT 1', [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return { error: 'Invalid email or password' };
    }

    return { user: sanitizeUser(user) };
  }

  if (action === 'log_audit') {
    await database.query(
      `
        INSERT INTO audit_logs (
          id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        body.userEmail,
        body.userName,
        body.userRole,
        body.auditAction,
        body.entityType || 'student',
        body.entityId || null,
        body.entityName || null,
        JSON.stringify(body.changes || {}),
      ],
    );
    return { success: true };
  }

  if (action === 'get_audit_log') {
    const limit = Number(body.limit || 50);
    const result = await database.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return { logs: result.rows.map(formatRow) };
  }

  if (action === 'get_users') {
    const result = await database.query(
      'SELECT id, auth_email, display_name, role, avatar_url, created_at FROM users ORDER BY created_at ASC',
    );
    return { users: result.rows.map(formatRow) };
  }

  if (action === 'update_role') {
    if (body.requesterRole !== 'admin') {
      return { error: 'Unauthorized' };
    }

    if (!USER_ROLES.includes(body.newRole)) {
      return { error: `Unsupported role: ${body.newRole}` };
    }

    const result = await database.query(
      `
        UPDATE users
        SET role = $1
        WHERE id = $2
        RETURNING id, auth_email, display_name, role, avatar_url, created_at
      `,
      [body.newRole, body.userId],
    );

    if (!result.rows[0]) {
      return { error: 'User not found' };
    }

    return { user: result.rows[0] };
  }

  return { error: `Unsupported auth action: ${action}` };
};

const toIsoDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const toAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const resolveFeeStatus = ({ invoiceCount, totalPaid, balanceDue, earliestUnpaidDueDate }) => {
  if (invoiceCount === 0) return 'no_invoices';
  if (balanceDue <= 0) return 'cleared';
  if (earliestUnpaidDueDate && earliestUnpaidDueDate < toIsoDate(new Date())) return 'overdue';
  return totalPaid > 0 ? 'partial' : 'unpaid';
};

// Student ID cards may be scanned, typed, or read by a keyboard-wedge scanner, so the payload
// can arrive as a bare student number, a JSON blob, or a URL. Reduce all of them to the number.
export const parseStudentCode = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const fromJson = parsed.student_id || parsed.studentId || parsed.id || parsed.code;
      if (fromJson) return String(fromJson).trim();
    } catch {
      // Fall through and treat the payload as plain text.
    }
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const fromQuery =
        url.searchParams.get('student_id') || url.searchParams.get('studentId') || url.searchParams.get('id');
      if (fromQuery) return fromQuery.trim();
      const lastSegment = url.pathname.split('/').filter(Boolean).pop();
      if (lastSegment) return decodeURIComponent(lastSegment).trim();
    } catch {
      // Fall through and treat the payload as plain text.
    }
  }

  return text;
};

// Returns fee payment status only — no contact, academic, medical or behavioural data.
// This is the single student-facing endpoint the support_staff role is allowed to read.
const handleFeeStatusFunction = async (database, body = {}) => {
  const code = parseStudentCode(body.code);

  const [students, invoices, payments] = await Promise.all([
    code
      ? database.query(
          `
            SELECT id, student_id, first_name, last_name, grade_level, class_section
            FROM students
            WHERE UPPER(student_id) = UPPER($1) OR id = $1
            LIMIT 1
          `,
          [code],
        )
      : database.query(
          'SELECT id, student_id, first_name, last_name, grade_level, class_section FROM students ORDER BY last_name, first_name',
        ),
    database.query('SELECT student_id, status, total_amount, balance_due, currency, due_date FROM invoices'),
    database.query('SELECT student_id, amount, currency, paid_at FROM payments'),
  ]);

  const summaries = new Map(
    students.rows.map((student) => [
      student.id,
      {
        student_id: student.id,
        student_number: student.student_id,
        full_name: `${student.first_name} ${student.last_name}`,
        grade_level: student.grade_level,
        class_section: student.class_section,
        currency: 'UGX',
        invoice_count: 0,
        total_invoiced: 0,
        total_paid: 0,
        balance_due: 0,
        next_due_date: null,
        last_payment_at: null,
        status: 'no_invoices',
      },
    ]),
  );

  const earliestUnpaidDueDates = new Map();

  for (const invoice of invoices.rows) {
    const summary = summaries.get(invoice.student_id);
    if (!summary) continue;

    const balance = toAmount(invoice.balance_due);
    summary.invoice_count += 1;
    summary.total_invoiced += toAmount(invoice.total_amount);
    summary.balance_due += balance;
    if (invoice.currency) summary.currency = invoice.currency;

    const dueDate = toIsoDate(invoice.due_date);
    if (dueDate && (!summary.next_due_date || dueDate < summary.next_due_date)) {
      summary.next_due_date = dueDate;
    }
    if (balance > 0 && dueDate) {
      const earliest = earliestUnpaidDueDates.get(invoice.student_id);
      if (!earliest || dueDate < earliest) {
        earliestUnpaidDueDates.set(invoice.student_id, dueDate);
      }
    }
  }

  for (const payment of payments.rows) {
    const summary = summaries.get(payment.student_id);
    if (!summary) continue;

    summary.total_paid += toAmount(payment.amount);

    const paidAt = payment.paid_at instanceof Date ? payment.paid_at.toISOString() : payment.paid_at;
    if (paidAt && (!summary.last_payment_at || paidAt > summary.last_payment_at)) {
      summary.last_payment_at = paidAt;
    }
  }

  const rows = [...summaries.values()].map((summary) => ({
    ...summary,
    status: resolveFeeStatus({
      invoiceCount: summary.invoice_count,
      totalPaid: summary.total_paid,
      balanceDue: summary.balance_due,
      earliestUnpaidDueDate: earliestUnpaidDueDates.get(summary.student_id) ?? null,
    }),
  }));

  return code ? { students: rows, code, matched: rows.length > 0 } : { students: rows };
};

const handleAiChatFunction = async (database, body, httpClient) => {
  const message = String(body?.message || '').trim();
  const hasImage = Boolean(body?.imageData);
  const students = await fetchAllStudents(database);
  const selectedModel = resolveModelSelection(body?.modelId);

  const conversation = await ensureConversation(database, {
    conversationId: body?.conversationId || null,
    title: (message || 'Image analysis request').slice(0, 60),
  });

  await insertMessage(database, {
    conversationId: conversation.id,
    role: 'user',
    content: message || 'Please analyze this image.',
    attachments: hasImage ? [{ type: 'image', data: body.imageData, name: 'upload' }] : [],
    metadata: {},
  });

  let reply;
  try {
    reply =
      selectedModel.provider === 'local_rules'
        ? generateAssistantReply({ message, students, hasImage })
        : await generateLlmSearchReply({
            modelId: selectedModel.id,
            message,
            students,
            hasImage,
            httpClient,
          });
  } catch (error) {
    reply = {
      message: [
        `The selected model (${selectedModel.label}) could not process the request.`,
        '',
        error instanceof Error ? error.message : 'Unknown model provider error.',
        '',
        'Switch to Local Rules or configure the provider credentials to continue.',
      ].join('\n'),
      studentsFound: 0,
      model: {
        id: selectedModel.id,
        label: selectedModel.label,
        provider: selectedModel.provider,
        model: selectedModel.model,
      },
      error: true,
    };
  }

  if (!reply) {
    reply = generateAssistantReply({ message, students, hasImage });
  }

  await insertMessage(database, {
    conversationId: conversation.id,
    role: 'assistant',
    content: reply.message,
    attachments: [],
    metadata: {
      studentsFound: reply.studentsFound,
      modelId: selectedModel.id,
      modelProvider: selectedModel.provider,
      modelName: selectedModel.model,
      usage: reply.usage || null,
      providerResponseId: reply.providerResponseId || null,
      modelError: Boolean(reply.error),
    },
  });

  return {
    message: reply.message,
    studentsFound: reply.studentsFound,
    conversationId: conversation.id,
    model: {
      id: selectedModel.id,
      label: selectedModel.label,
      provider: selectedModel.provider,
      model: selectedModel.model,
    },
    usage: reply.usage || null,
  };
};

const handleVoiceFunction = async () => ({
  warning: 'Voice transcription is not implemented in local mode yet. Type your message to continue.',
});

const handlePaymentFunction = async (database, body, httpClient) => {
  const action = body?.action;

  if (action === 'initiate') {
    return initiatePayment({ database, body, httpClient });
  }

  if (action === 'status') {
    return getPaymentStatus({
      database,
      paymentReference: body.paymentReference || body.externalReference || body.providerReference,
      httpClient,
    });
  }

  if (action === 'callback') {
    return recordPaymentCallback({ database, body });
  }

  return { error: `Unsupported payment action: ${action}` };
};

const handleReportCardRequest = async (database, pathname, searchParams) => {
  const match = pathname.match(/^\/api\/report-cards\/([^/]+)\.pdf$/);
  if (!match) {
    return null;
  }

  const student = await fetchStudentById(database, decodeURIComponent(match[1]));
  if (!student) {
    return {
      type: 'json',
      status: 404,
      body: { error: 'Student not found' },
    };
  }

  const term = searchParams.get('term') || 'Term 1';
  const academicYear = searchParams.get('academicYear') || undefined;
  const gradingCountry = searchParams.get('gradingCountry') || undefined;
  const academicLevel = searchParams.get('academicLevel') || undefined;
  const reportTitle = searchParams.get('reportTitle') || undefined;
  const schoolName = searchParams.get('schoolName') || undefined;
  const schoolTagline = searchParams.get('schoolTagline') || undefined;
  const teacherName = searchParams.get('teacherName') || undefined;
  const headTeacherName = searchParams.get('headTeacherName') || undefined;
  const teacherComment = searchParams.get('teacherComment') || undefined;
  const reportNotes = searchParams.get('reportNotes') || undefined;
  const pdfBytes = await buildReportCardPdf({
    student,
    term,
    academicYear,
    gradingCountry,
    academicLevel,
    reportTitle,
    schoolName,
    schoolTagline,
    teacherName,
    headTeacherName,
    teacherComment,
    reportNotes,
  });

  return {
    type: 'binary',
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${student.student_id}-${term.replace(/\s+/g, '-').toLowerCase()}-report-card.pdf"`,
    },
    body: Buffer.from(pdfBytes),
  };
};

const notFound = (message) => ({ type: 'json', status: 404, body: { error: message } });

const handleIdCardRequest = async (database, pathname, searchParams) => {
  const qrMatch = pathname.match(/^\/api\/id-cards\/([^/]+)\.png$/);
  if (qrMatch) {
    const student = await fetchStudentById(database, decodeURIComponent(qrMatch[1]));
    if (!student) {
      return notFound('Student not found');
    }

    const png = await buildQrPng(buildQrPayload(student, searchParams.get('qrBaseUrl') || undefined));
    return {
      type: 'binary',
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
      body: png,
    };
  }

  const singleMatch = pathname.match(/^\/api\/id-cards\/([^/]+)\.pdf$/);
  const batchMatch = pathname === '/api/id-cards.pdf';
  if (!singleMatch && !batchMatch) {
    return null;
  }

  const layout = searchParams.get('layout') === 'a4' ? 'a4' : 'card';
  const schoolName = searchParams.get('schoolName') || undefined;
  const qrBaseUrl = searchParams.get('qrBaseUrl') || undefined;

  let students;
  let filename;

  if (singleMatch) {
    const student = await fetchStudentById(database, decodeURIComponent(singleMatch[1]));
    if (!student) {
      return notFound('Student not found');
    }
    students = [student];
    filename = `${student.student_id}-id-card.pdf`;
  } else {
    const conditions = [];
    const values = [];
    const grade = searchParams.get('grade');
    const section = searchParams.get('section');

    if (grade) {
      values.push(Number(grade));
      conditions.push(`grade_level = $${values.length}`);
    }
    if (section) {
      values.push(section);
      conditions.push(`class_section = $${values.length}`);
    }

    const result = await database.query(
      `
        SELECT * FROM students
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY last_name, first_name
      `,
      values,
    );

    if (result.rows.length === 0) {
      return notFound('No students match that ID card selection');
    }

    students = result.rows.map(formatRow);
    filename = `student-id-cards${grade ? `-grade-${grade}` : ''}${section ? `-${section}` : ''}.pdf`;
  }

  const pdfBytes = await buildIdCardPdf({ students, layout, schoolName, qrBaseUrl });

  return {
    type: 'binary',
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: Buffer.from(pdfBytes),
  };
};

export const createAppRuntime = async ({
  connectionString,
  useInMemoryDatabase = false,
  httpClient = fetch,
} = {}) => {
  const database = createDatabaseConnection({
    connectionString,
    useInMemoryDatabase,
  });

  await waitForDatabase(database, useInMemoryDatabase ? { attempts: 1, delayMs: 0 } : undefined);
  await initializeDatabase(database);

  return {
    database,
    async close() {
      await database.close();
    },
    async dispatch({ method = 'GET', pathname = '/', searchParams = new URLSearchParams(), body = {} }) {
      const reportCardResponse = await handleReportCardRequest(database, pathname, searchParams);
      if (reportCardResponse) {
        return reportCardResponse;
      }

      const idCardResponse = await handleIdCardRequest(database, pathname, searchParams);
      if (idCardResponse) {
        return idCardResponse;
      }

      if (method === 'GET' && pathname === '/api/health') {
        const countResult = await database.query('SELECT COUNT(*)::int AS count FROM students');
        return {
          type: 'json',
          status: 200,
          body: {
            data: {
              ok: true,
              mode: useInMemoryDatabase ? 'memory-postgres' : 'postgres',
              students: countResult.rows[0]?.count ?? 0,
            },
          },
        };
      }

      if (method === 'POST' && pathname === '/api/db') {
        const data = await handleDbQuery(database, body);
        return { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/auth') {
        const data = await handleAuthFunction(database, body);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/fee-status') {
        const data = await handleFeeStatusFunction(database, body);
        return { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/ai-chat') {
        const data = await handleAiChatFunction(database, body, httpClient);
        return { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/ai-models') {
        return { type: 'json', status: 200, body: { data: { models: getPublicModelCatalog() } } };
      }

      if (method === 'GET' && pathname === '/api/grading-schemes') {
        return { type: 'json', status: 200, body: { data: { schemes: getPublicGradingOptions() } } };
      }

      if (method === 'POST' && pathname === '/api/functions/voice-to-text') {
        const data = await handleVoiceFunction();
        return { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/payments') {
        const data = await handlePaymentFunction(database, body, httpClient);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      return {
        type: 'json',
        status: 404,
        body: { error: 'Route not found' },
      };
    },
  };
};

export const createAppServer = async ({
  connectionString,
  useInMemoryDatabase = false,
  staticRoot = DEFAULT_STATIC_ROOT,
} = {}) => {
  const runtime = await createAppRuntime({ connectionString, useInMemoryDatabase });

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      sendJson(response, 400, { error: 'Missing request URL' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      response.end();
      return;
    }

    const url = new URL(request.url, 'http://127.0.0.1');

    try {
      if (url.pathname.startsWith('/api/')) {
        const body = request.method === 'POST' ? await readRequestBody(request) : {};
        const result = await runtime.dispatch({
          method: request.method || 'GET',
          pathname: url.pathname,
          searchParams: url.searchParams,
          body,
        });

        if (result.type === 'binary') {
          sendBinary(response, result.status, result.body, result.headers);
          return;
        }

        sendJson(response, result.status, result.body);
        return;
      }

      if (request.method === 'GET') {
        await serveStatic(url.pathname, response, staticRoot);
        return;
      }

      sendJson(response, 404, { error: 'Route not found' });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unexpected server error',
      });
    }
  });

  return {
    server,
    runtime,
  };
};

export const startServer = async (options = {}) => {
  const { server, runtime } = await createAppServer(options);

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve({ server, runtime, address: server.address() });
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port || DEFAULT_PORT, options.host || DEFAULT_HOST);
  });
};

if (process.argv[1] === __filename) {
  const { address } = await startServer();
  const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
  console.log(`Local backend listening on http://${DEFAULT_HOST}:${port}`);
}
