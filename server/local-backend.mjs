import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseConnection, waitForDatabase } from './db/connection.mjs';
import { initializeDatabase } from './db/schema.mjs';
import { createTenantRegistry } from './db/tenants.mjs';
import { createControlConnection, initializeControlSchema, getTenantBySubdomain, listTenants, lookupTenantRoute } from './db/control.mjs';
import { createSubscriptionCharge } from './services/payment-gateway.mjs';
import { isPaymentWebhook, isWebhookSignatureValid } from './security/webhooks.mjs';
import { renderActivationEmail, sendEmail } from './services/email.mjs';
import {
  designationsForRole,
  normaliseProfile,
  profileLabel,
  sectionsFor,
} from './services/scan-profiles.mjs';
import {
  checkAvailability,
  confirmSubscriptionPayment,
  normalizeSubdomain,
  startSubscription,
  sweepSubscriptions,
} from './services/provisioning.mjs';
import { buildReportCardPdf } from './reports/report-card.mjs';
import { buildIdCardPdf, buildQrPayload, buildQrPng } from './reports/id-card.mjs';
import { buildFeeReceiptPdf, buildFeeStatementPdf } from './reports/fee-receipt.mjs';
import { buildFinanceReportPdf } from './reports/finance-report.mjs';
import { APP_VERSION, BUILD_NUMBER, DEVELOPER_CONTACTS } from './version.mjs';
import { getPublicGradingOptions } from './reports/grading-config.mjs';
import { generateLlmSearchReply, getPublicModelCatalog, resolveModelSelection } from './services/llm-models.mjs';
import { getPaymentStatus, initiatePayment, recordPaymentCallback } from './services/payment-gateway.mjs';
import { generateAssistantReply } from './services/student-chat.mjs';
import { answerChatMessage } from './agent/chat.mjs';
import { handleMcpServerRequest } from './mcp/server.mjs';
import { handleFeesFunction } from './services/fees.mjs';
import { handleCurriculumFunction } from './services/curriculum.mjs';
import { handleDigitalExaminerFunction, loadPaper } from './services/digital-examiner.mjs';
import { handleLessonPlannerFunction } from './services/lesson-planner.mjs';
import { handleChatReportFunction, renderChatReport } from './services/chat-report.mjs';
import { handleSearchFunction } from './services/search.mjs';
import { removeFromIndex, syncTable } from './search/indexer.mjs';
import { isSearchConfigured } from './search/meili.mjs';
import { buildExamPaperPdf } from './reports/exam-paper.mjs';
import { buildLessonPlanPdf } from './reports/lesson-plan.mjs';
import { buildChatReportPdf } from './reports/chat-report.mjs';
import { handleMcpFunction } from './services/mcp-servers.mjs';
import { getPublicCurriculumFrameworks } from './services/curriculum-frameworks.mjs';
import { handleSettingsFunction, loadSchoolSettings } from './services/settings.mjs';
import { toAmount, toIsoDate } from './services/fee-math.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const DEFAULT_STATIC_ROOT = process.env.LOCAL_STATIC_ROOT || join(ROOT_DIR, 'dist');
// const DEFAULT_HOST = process.env.LOCAL_BACKEND_HOST || '127.0.0.1';
const DEFAULT_HOST = process.env.LOCAL_BACKEND_HOST || '0.0.0.0';
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
      'photo_url',
    ],
    jsonColumns: ['subjects', 'medical_record'],
  },
  conversations: {
    columns: ['id', 'title', 'created_at', 'updated_at'],
    touchesUpdatedAt: true,
  },
  curriculum_documents: {
    columns: [
      'id',
      'title',
      'curriculum',
      'subject',
      'grade_level',
      'academic_year',
      'term',
      'source_type',
      'source_uri',
      'mime_type',
      'content_hash',
      'uploaded_by',
      'created_at',
    ],
  },
  // Chunk bodies are readable (a teacher checking what a citation points at), but `embedding` is
  // deliberately absent from the allow-list: it is a large float array of no use to the browser,
  // and shipping it would multiply the payload of any listing by an order of magnitude.
  curriculum_chunks: {
    columns: [
      'id',
      'document_id',
      'chunk_index',
      'heading',
      'content',
      'token_count',
      'embedding_model',
      'curriculum',
      'subject',
      'grade_level',
      'created_at',
    ],
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
    // One record per student per day, enforced here rather than left to the caller. The records
    // workspace does check its loaded list before inserting, but that is a check-then-act race
    // against a possibly stale copy — which is exactly how a day's attendance accumulated eleven
    // identical rows and blocked idx_attendance_unique from ever being created.
    conflictTarget: ['student_id', 'attendance_date'],
  },
  attendance_alerts: {
    columns: ['id', 'student_id', 'attendance_record_id', 'channel', 'recipient', 'status', 'message', 'sent_at'],
  },
  exams: {
    columns: ['id', 'name', 'exam_type', 'academic_year', 'term', 'start_date', 'end_date', 'status'],
  },
  lesson_plans: {
    columns: [
      'id',
      'teacher_id',
      'subject_id',
      'subject_name',
      'class_id',
      'curriculum',
      'academic_year',
      'term',
      'grade_level',
      'topic',
      'subtopic',
      'title',
      'duration_minutes',
      'lesson_date',
      'period',
      'competencies',
      'learning_outcomes',
      'materials',
      'activities',
      'assessment',
      'differentiation',
      'homework',
      'refs',
      'status',
      'generated_by',
      'created_by',
      'created_at',
      'updated_at',
    ],
    jsonColumns: [
      'competencies',
      'learning_outcomes',
      'materials',
      'activities',
      'assessment',
      'refs',
      'generated_by',
    ],
    touchesUpdatedAt: true,
  },
  exam_blueprints: {
    columns: [
      'id',
      'name',
      'curriculum',
      'subject_id',
      'subject_name',
      'grade_level',
      'academic_year',
      'term',
      'paper_label',
      'assessment_type',
      'duration_minutes',
      'total_marks',
      'topic_weights',
      'difficulty_mix',
      'bloom_mix',
      'question_type_mix',
      'sections',
      'created_by',
      'created_at',
      'updated_at',
    ],
    jsonColumns: ['topic_weights', 'difficulty_mix', 'bloom_mix', 'question_type_mix', 'sections'],
    touchesUpdatedAt: true,
  },
  exam_questions: {
    columns: [
      'id',
      'blueprint_id',
      'curriculum',
      'subject_id',
      'subject_name',
      'grade_level',
      'topic',
      'subtopic',
      'question_type',
      'difficulty',
      'bloom_level',
      'command_word',
      'stem',
      'options',
      'correct_answer',
      'marking_scheme',
      'marks',
      'expected_time_minutes',
      'assessment_objective',
      'source_references',
      'status',
      'review_notes',
      'generated_by',
      'created_by',
      'created_at',
      'updated_at',
    ],
    jsonColumns: ['options', 'marking_scheme', 'source_references', 'generated_by'],
    touchesUpdatedAt: true,
  },
  generated_papers: {
    columns: [
      'id',
      'blueprint_id',
      'exam_id',
      'title',
      'curriculum',
      'subject_id',
      'subject_name',
      'grade_level',
      'academic_year',
      'term',
      'assessment_type',
      'duration_minutes',
      'total_marks',
      'instructions',
      'question_ids',
      'sections',
      'status',
      'published_at',
      'created_by',
      'created_at',
      'updated_at',
    ],
    jsonColumns: ['question_ids', 'sections'],
    touchesUpdatedAt: true,
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
      'description',
      'status',
      'created_at',
    ],
  },
  payments: {
    columns: [
      'id',
      'student_id',
      'fee_structure_id',
      'invoice_id',
      'amount',
      'currency',
      'payment_method',
      'reference',
      'paid_at',
      'received_by',
      'notes',
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
      'fee_structure_id',
      'academic_year',
      'term',
      'gross_amount',
      'discount_total',
      'notes',
      'billing_key',
    ],
    jsonColumns: ['line_items'],
  },
  receipts: {
    columns: [
      'id',
      'payment_id',
      'student_id',
      'receipt_number',
      'amount',
      'currency',
      'issued_at',
      'issued_by',
    ],
  },
  // Readable through /api/db for listing, but every mutation goes through /api/functions/fees so
  // it is role-checked, transactional and audited — /api/db has no role check at all.
  fee_bursaries: {
    columns: [
      'id',
      'student_id',
      'name',
      'sponsor',
      'discount_type',
      'discount_value',
      'fee_structure_id',
      'academic_year',
      'term',
      'start_date',
      'end_date',
      'status',
      'notes',
      'approved_by',
      'created_at',
    ],
  },
  student_fee_standings: {
    columns: [
      'id',
      'student_id',
      'standing',
      'note',
      'review_date',
      'status',
      'set_by',
      'set_at',
      'cleared_by',
      'cleared_at',
    ],
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
  gate_passes: {
    columns: ['id', 'student_id', 'direction', 'authorised_by', 'reason', 'recorded_by', 'recorded_at'],
  },
  meal_records: {
    columns: ['id', 'student_id', 'meal_date', 'meal', 'served_by', 'served_at'],
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Tenant',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const sendBinary = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tenant',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers,
  });
  response.end(body);
};

const sendText = (response, statusCode, text) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tenant',
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

  const raw = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }
  // The raw text is kept so payment webhooks can be signature-verified before it is trusted.
  return { raw, body };
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

/**
 * Builds the ON CONFLICT clause for a table that declares a natural key via `conflictTarget`.
 *
 * Makes the insert idempotent on that key: a repeat updates the existing row instead of adding a
 * second one. `id` and the key columns themselves are excluded from the update — rewriting the
 * primary key on conflict would change a row's identity, and rewriting the key columns is a no-op.
 *
 * Returns an empty string for the tables that declare no key, so their inserts are untouched.
 */
const buildConflictClause = (config, insertColumns) => {
  const target = config.conflictTarget;
  if (!target || target.length === 0) return '';

  const updatable = insertColumns.filter((column) => column !== 'id' && !target.includes(column));

  // When the caller sent nothing but the key, there is nothing to change — but DO NOTHING returns
  // no rows, which would leave RETURNING empty and hand the caller a null where it expects the
  // record. Self-assigning a key column keeps it a DO UPDATE, so the existing row always comes back.
  const assignments = updatable.length > 0 ? updatable : [target[0]];

  return [
    `ON CONFLICT (${target.map((column) => `"${column}"`).join(', ')}) DO UPDATE SET`,
    assignments.map((column) => `"${column}" = EXCLUDED."${column}"`).join(', '),
  ].join(' ');
};

/**
 * Refreshes the search index after a write, without making the caller wait for it.
 *
 * Deliberately not awaited: a search index falling behind must never fail or delay the record that
 * triggered it. Postgres stays the system of record, and a reindex from Settings repairs anything
 * a missed sync left stale.
 */
const scheduleSearchSync = (database, table, { deletedIds = null, httpClient } = {}) => {
  if (!isSearchConfigured()) return;

  const work = deletedIds
    ? removeFromIndex(table, deletedIds, { httpClient })
    : syncTable(database, table, { httpClient });

  work.catch((error) => {
    console.warn('Search sync failed:', error instanceof Error ? error.message : error);
  });
};

const handleDbQuery = async (database, body, httpClient = fetch) => {
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
          ${buildConflictClause(config, insertColumns)}
          RETURNING ${selectedColumns.map((column) => `"${column}"`).join(', ')}
        `,
        values,
      );
      insertedRows.push(...result.rows.map(formatRow));
    }

    scheduleSearchSync(database, table, { httpClient });
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

    scheduleSearchSync(database, table, { httpClient });
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

    // Mirrored rather than left to the next reindex: a deleted student must leave the index.
    scheduleSearchSync(database, table, {
      deletedIds: result.rows.map((row) => row.id).filter(Boolean),
      httpClient,
    });
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

// Returns the new row's id so the chat can exclude the turn it just wrote when replaying history.
const insertMessage = async (database, { conversationId, role, content, attachments = [], metadata = {} }) => {
  const id = randomUUID();

  await database.query(
    `
      INSERT INTO messages (id, conversation_id, role, content, attachments, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [id, conversationId, role, content, JSON.stringify(attachments), JSON.stringify(metadata)],
  );

  await database.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
  return { id };
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
    const isFirstUser = userCount.rows[0]?.count === 0;
    const role = isFirstUser ? 'admin' : 'teacher';
    // The founding account bootstraps the school and is approved on the spot; every later
    // signup waits for an administrator to approve it before it can sign in.
    const approvalStatus = isFirstUser ? 'approved' : 'pending';

    // A requested designation is only honoured if it belongs to the role being created;
    // anything else is dropped rather than rejected, leaving the account unspecialised.
    const requested = String(body.designation || '').trim();
    const designation = designationsForRole(role).includes(requested) ? requested : null;

    const inserted = await database.query(
      `
        INSERT INTO users (id, auth_email, display_name, role, avatar_url, password_hash, approval_status, designation)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, auth_email, display_name, role, avatar_url, created_at, approval_status, designation
      `,
      [randomUUID(), email, displayName, role, '', hashPassword(password), approvalStatus, designation],
    );

    return { user: sanitizeUser(inserted.rows[0]), pending: approvalStatus !== 'approved' };
  }

  if (action === 'set_designation') {
    const email = String(body.email || '').trim().toLowerCase();
    const result = await database.query('SELECT * FROM users WHERE auth_email = $1 LIMIT 1', [email]);
    const target = result.rows[0];
    if (!target) return { error: 'No account with that email' };

    const requested = String(body.designation || '').trim();
    const allowed = designationsForRole(target.role);
    if (requested && !allowed.includes(requested)) {
      return {
        error: `A ${target.role} account cannot be a ${requested}. Allowed: ${allowed.join(', ') || 'none'}`,
      };
    }

    const updated = await database.query(
      `
        UPDATE users SET designation = $1 WHERE auth_email = $2
        RETURNING id, auth_email, display_name, role, avatar_url, created_at, approval_status, designation
      `,
      [requested || null, email],
    );

    return { user: sanitizeUser(updated.rows[0]) };
  }

  if (action === 'signin') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const result = await database.query('SELECT * FROM users WHERE auth_email = $1 LIMIT 1', [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return { error: 'Invalid email or password' };
    }

    // A pending account has valid credentials but no access until an administrator approves it.
    // (A rejected account is deleted, so it falls through to the invalid-credentials path above.)
    if (user.approval_status !== 'approved') {
      return { error: 'Your account is awaiting administrator approval.' };
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
      'SELECT id, auth_email, display_name, role, avatar_url, created_at, approval_status FROM users ORDER BY created_at ASC',
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

  // Edit an existing account's name, sign-in email and designation. Separate from update_role so a
  // rename cannot silently change someone's permissions, and vice versa.
  if (action === 'update_account') {
    if (body.requesterRole !== 'admin') {
      return { error: 'Unauthorized' };
    }

    const existing = await database.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [body.userId]);
    const target = existing.rows[0];
    if (!target) return { error: 'User not found' };

    const displayName = String(body.displayName ?? target.display_name).trim();
    if (!displayName) return { error: 'A display name is required' };

    const email = String(body.email ?? target.auth_email).trim().toLowerCase();
    if (!email.includes('@')) return { error: 'A valid email address is required' };

    // The email is the sign-in identity, so a clash would lock one of the two accounts out.
    if (email !== target.auth_email) {
      const clash = await database.query('SELECT id FROM users WHERE auth_email = $1 AND id <> $2 LIMIT 1', [
        email,
        body.userId,
      ]);
      if (clash.rows[0]) return { error: 'Another account already uses that email' };
    }

    // A designation only means something for the roles that have one, so a role change elsewhere
    // must not leave a stale one behind.
    const requested = body.designation === undefined ? target.designation : String(body.designation || '').trim();
    const allowed = designationsForRole(target.role);
    if (requested && !allowed.includes(requested)) {
      return {
        error: `A ${target.role} account cannot be a ${requested}. Allowed: ${allowed.join(', ') || 'none'}`,
      };
    }

    const updated = await database.query(
      `
        UPDATE users SET display_name = $1, auth_email = $2, designation = $3
        WHERE id = $4
        RETURNING id, auth_email, display_name, role, avatar_url, created_at, approval_status, designation
      `,
      [displayName, email, requested || null, body.userId],
    );

    await recordAccountDecision(database, body, 'account_updated', updated.rows[0]);
    return { user: sanitizeUser(updated.rows[0]) };
  }

  // Permanently remove an account. Distinct from reject_account, which is the pending-signup path:
  // this deletes staff who have already been approved and are leaving the school.
  if (action === 'delete_account') {
    if (body.requesterRole !== 'admin') {
      return { error: 'Unauthorized' };
    }

    const existing = await database.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [body.userId]);
    const target = existing.rows[0];
    if (!target) return { error: 'User not found' };

    // Deleting the account you are signed in as would strand you mid-session, and it is almost
    // always a misclick rather than an intention.
    if (String(body.requesterEmail || '').trim().toLowerCase() === target.auth_email) {
      return { error: 'You cannot delete the account you are signed in with' };
    }

    // Removing the last administrator would leave nobody able to manage staff, settings or fees,
    // and there is no way back in from that state.
    if (target.role === 'admin') {
      const { rows } = await database.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND approval_status = 'approved'",
      );
      if ((rows[0]?.count ?? 0) <= 1) {
        return { error: 'This is the only administrator account — promote another admin before deleting it' };
      }
    }

    await database.query('DELETE FROM users WHERE id = $1', [body.userId]);
    await recordAccountDecision(database, body, 'account_deleted', target);
    return { deleted: true, user: sanitizeUser(target) };
  }

  if (action === 'approve_account') {
    if (body.requesterRole !== 'admin') {
      return { error: 'Unauthorized' };
    }

    const result = await database.query(
      `
        UPDATE users
        SET approval_status = 'approved'
        WHERE id = $1
        RETURNING id, auth_email, display_name, role, avatar_url, created_at, approval_status
      `,
      [body.userId],
    );

    if (!result.rows[0]) {
      return { error: 'User not found' };
    }

    await recordAccountDecision(database, body, 'account_approved', result.rows[0]);
    return { user: result.rows[0] };
  }

  if (action === 'reject_account') {
    if (body.requesterRole !== 'admin') {
      return { error: 'Unauthorized' };
    }

    // Rejection deletes the account outright. An administrator can never be rejected this way —
    // that guards against locking every admin out of the school.
    const result = await database.query(
      `
        DELETE FROM users
        WHERE id = $1 AND role <> 'admin'
        RETURNING id, auth_email, display_name, role
      `,
      [body.userId],
    );

    if (!result.rows[0]) {
      const stillThere = await database.query('SELECT role FROM users WHERE id = $1 LIMIT 1', [body.userId]);
      if (stillThere.rows[0]?.role === 'admin') {
        return { error: 'Administrator accounts cannot be rejected' };
      }
      return { error: 'User not found' };
    }

    await recordAccountDecision(database, body, 'account_rejected', result.rows[0]);
    return { deleted: true, user: result.rows[0] };
  }

  return { error: `Unsupported auth action: ${action}` };
};

// Approvals and rejections are sensitive admin actions, so they are recorded server-side rather
// than relying on the client to log them. The requester's identity rides in the request body,
// consistent with the rest of the auth endpoint's trust-the-client model.
const recordAccountDecision = async (database, body, auditAction, target) => {
  await database.query(
    `
      INSERT INTO audit_logs (
        id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes
      ) VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8)
    `,
    [
      randomUUID(),
      body.requesterEmail || '',
      body.requesterName || '',
      'admin',
      auditAction,
      target.id,
      `${target.display_name} <${target.auth_email}>`,
      JSON.stringify({ role: target.role, approval_status: target.approval_status ?? 'rejected' }),
    ],
  );
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
const todayIso = () => new Date().toISOString().slice(0, 10);

const MEALS = ['breakfast', 'lunch', 'supper'];

const findStudentByCode = async (database, rawCode) => {
  const code = parseStudentCode(rawCode);
  if (!code) return null;
  const result = await database.query(
    'SELECT * FROM students WHERE UPPER(student_id) = UPPER($1) OR id = $1 LIMIT 1',
    [code],
  );
  return result.rows[0] || null;
};

/**
 * Assembles the card a scanning staff member sees, carrying only the sections their profile
 * grants. Every section is fetched independently so an empty table (no invoices yet, no
 * dormitory assignment) reads as "nothing recorded" rather than failing the whole scan.
 */
const handleStudentCardFunction = async (database, body = {}) => {
  const student = await findStudentByCode(database, body.code);
  if (!student) {
    return { error: 'No student matches that ID' };
  }

  const profile = normaliseProfile(body.role, body.designation);
  const sections = sectionsFor(profile.role, profile.designation);
  const wants = (section) => sections.includes(section);

  const card = {
    profile: { ...profile, label: profileLabel(profile.role, profile.designation) },
    sections,
    student: {
      id: student.id,
      student_id: student.student_id,
      full_name: `${student.first_name} ${student.last_name}`,
      grade_level: student.grade_level,
      class_section: student.class_section,
      status: student.status,
      lifecycle_status: student.lifecycle_status,
    },
  };

  // Fees back the exam-clearance rule, so they are fetched for either section.
  const needsInvoices = wants('fees') || wants('exam_clearance');

  const [invoices, dormitory, grades, attendance, passes, meals] = await Promise.all([
    needsInvoices
      ? database.query(
          'SELECT id, invoice_number, status, total_amount, balance_due, currency, due_date FROM invoices WHERE student_id = $1',
          [student.id],
        )
      : null,
    wants('dormitory')
      ? database.query(
          `
            SELECT a.bed_number, a.status, a.start_date, r.hostel_name, r.room_number
            FROM hostel_assignments a
            JOIN hostel_rooms r ON r.id = a.room_id
            WHERE a.student_id = $1 AND a.status = 'active'
            LIMIT 1
          `,
          [student.id],
        )
      : null,
    wants('academics')
      ? database.query(
          'SELECT id, subject_id, score, max_score, grade, remarks, rank FROM gradebook_entries WHERE student_id = $1',
          [student.id],
        )
      : null,
    wants('attendance')
      ? database.query(
          'SELECT attendance_date, status, reason FROM attendance_records WHERE student_id = $1 ORDER BY attendance_date DESC LIMIT 30',
          [student.id],
        )
      : null,
    wants('gate_pass')
      ? database.query(
          'SELECT id, direction, authorised_by, reason, recorded_by, recorded_at FROM gate_passes WHERE student_id = $1 ORDER BY recorded_at DESC LIMIT 5',
          [student.id],
        )
      : null,
    wants('meal_card')
      ? database.query(
          'SELECT meal, served_by, served_at FROM meal_records WHERE student_id = $1 AND meal_date = $2',
          [student.id, todayIso()],
        )
      : null,
  ]);

  if (wants('bio')) {
    card.bio = {
      date_of_birth: student.date_of_birth,
      gender: student.gender,
      blood_group: student.blood_group,
      address: student.address,
      enrollment_date: student.enrollment_date,
      medical_record: student.medical_record,
    };
  }

  if (wants('class')) {
    card.class_allocation = {
      grade_level: student.grade_level,
      class_section: student.class_section,
      subjects: student.subjects,
    };
  }

  if (wants('parents')) {
    card.parents = {
      parent_name: student.parent_name,
      parent_phone: student.parent_phone,
      parent_email: student.parent_email,
      emergency_contact_name: student.emergency_contact_name,
      emergency_contact_phone: student.emergency_contact_phone,
      emergency_contact_relation: student.emergency_contact_relation,
    };
  }

  const invoiceRows = invoices ? invoices.rows : [];
  const balance = invoiceRows.reduce((total, row) => total + Number(row.balance_due || 0), 0);
  const invoiced = invoiceRows.reduce((total, row) => total + Number(row.total_amount || 0), 0);

  if (wants('fees')) {
    card.fees = {
      currency: invoiceRows[0]?.currency || 'UGX',
      invoice_count: invoiceRows.length,
      total_invoiced: invoiced,
      balance_due: balance,
      status: invoiceRows.length === 0 ? 'no_invoices' : balance > 0 ? 'outstanding' : 'cleared',
    };
  }

  if (wants('exam_clearance')) {
    // A student sits their exams once the fees are settled; with nothing invoiced there is
    // nothing to clear, so an unbilled student is not held back at the exam room door.
    const cleared = balance <= 0;
    card.exam_clearance = {
      cleared,
      balance_due: balance,
      currency: invoiceRows[0]?.currency || 'UGX',
      reason: cleared
        ? invoiceRows.length === 0
          ? 'No fees invoiced'
          : 'Fees cleared'
        : 'Outstanding fees balance',
    };
  }

  if (wants('dormitory')) {
    const room = dormitory.rows[0];
    card.dormitory = room
      ? {
          hostel_name: room.hostel_name,
          room_number: room.room_number,
          bed_number: room.bed_number,
          since: room.start_date,
        }
      : null;
  }

  if (wants('academics')) {
    const rows = grades.rows;
    const scored = rows.filter((row) => Number(row.max_score) > 0);
    const average = scored.length
      ? scored.reduce((total, row) => total + (Number(row.score) / Number(row.max_score)) * 100, 0) /
        scored.length
      : null;
    card.academics = {
      entry_count: rows.length,
      average_percent: average === null ? null : Math.round(average * 10) / 10,
      gpa: student.gpa,
      entries: rows,
    };
  }

  if (wants('attendance')) {
    const rows = attendance.rows;
    const present = rows.filter((row) => row.status === 'present').length;
    card.attendance = {
      rate: student.attendance_rate,
      recorded: rows.length,
      present,
      absent: rows.length - present,
      recent: rows.slice(0, 10),
    };
  }

  if (wants('gate_pass')) {
    const rows = passes.rows;
    const last = rows[0] || null;
    card.gate_pass = {
      // Out on the last movement means the student is currently off the premises.
      on_premises: !last || last.direction === 'in',
      last_movement: last,
      history: rows,
    };
  }

  if (wants('meal_card')) {
    const served = new Map(meals.rows.map((row) => [row.meal, row]));
    card.meal_card = {
      meal_date: todayIso(),
      meals: MEALS.map((meal) => ({
        meal,
        eaten: served.has(meal),
        served_at: served.get(meal)?.served_at || null,
        served_by: served.get(meal)?.served_by || '',
      })),
    };
  }

  return card;
};

/** Records a movement through the gate. Only the askari's profile grants this. */
const handleGatePassFunction = async (database, body = {}) => {
  const student = await findStudentByCode(database, body.code);
  if (!student) return { error: 'No student matches that ID' };

  const direction = body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : null;
  if (!direction) return { error: 'Direction must be "out" or "in"' };

  const authorisedBy = String(body.authorisedBy || '').trim();
  if (!authorisedBy) return { error: 'An authorising person is required' };

  const inserted = await database.query(
    `
      INSERT INTO gate_passes (id, student_id, direction, authorised_by, reason, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, direction, authorised_by, reason, recorded_by, recorded_at
    `,
    [
      randomUUID(),
      student.id,
      direction,
      authorisedBy,
      String(body.reason || '').trim(),
      String(body.recordedBy || '').trim(),
    ],
  );

  return { pass: inserted.rows[0], on_premises: direction === 'in' };
};

/**
 * Marks a meal as served. Serving the same meal twice in a day is a re-scan of a student who
 * already ate, not a second helping, so the existing row is returned instead of a new one.
 */
const handleMealRecordFunction = async (database, body = {}) => {
  const student = await findStudentByCode(database, body.code);
  if (!student) return { error: 'No student matches that ID' };

  const meal = MEALS.includes(body.meal) ? body.meal : null;
  if (!meal) return { error: `Meal must be one of ${MEALS.join(', ')}` };

  const mealDate = body.mealDate || todayIso();
  const existing = await database.query(
    'SELECT meal, served_by, served_at FROM meal_records WHERE student_id = $1 AND meal_date = $2 AND meal = $3 LIMIT 1',
    [student.id, mealDate, meal],
  );

  if (existing.rows[0]) {
    return { meal: existing.rows[0], already_served: true };
  }

  const inserted = await database.query(
    `
      INSERT INTO meal_records (id, student_id, meal_date, meal, served_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING meal, served_by, served_at
    `,
    [randomUUID(), student.id, mealDate, meal, String(body.servedBy || '').trim()],
  );

  return { meal: inserted.rows[0], already_served: false };
};

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

// Non-teaching support staff may only see fee payment status, so the assistant is closed to them.
// The browser already hides it (ChatWindow, ChatContext), but that is a UI convenience: this is the
// check that actually holds, matching the guard every other service here puts ahead of its actions.
const CHAT_ROLES = ['admin', 'teacher'];

/**
 * Per-student fee summaries for the rules engine, which is synchronous and so cannot fetch them
 * itself. Reuses the fee-status aggregation rather than duplicating the arithmetic.
 *
 * Best-effort: a school with no billing data, or a database predating the fee tables, simply gets
 * no fee section on the profile rather than a failed chat request.
 */
const loadFeeSummaries = async (database) => {
  try {
    const result = await handleFeeStatusFunction(database, {});
    return new Map((result.students || []).map((summary) => [summary.student_id, summary]));
  } catch {
    return null;
  }
};

const handleAiChatFunction = async (database, body, httpClient) => {
  if (!CHAT_ROLES.includes(body?.requesterRole)) {
    return { error: 'Unauthorized' };
  }

  const message = String(body?.message || '').trim();
  const hasImage = Boolean(body?.imageData);
  const students = await fetchAllStudents(database);
  const selectedModel = resolveModelSelection(body?.modelId);

  const conversation = await ensureConversation(database, {
    conversationId: body?.conversationId || null,
    title: (message || 'Image analysis request').slice(0, 60),
  });

  const userMessage = await insertMessage(database, {
    conversationId: conversation.id,
    role: 'user',
    content: message || 'Please analyze this image.',
    attachments: hasImage ? [{ type: 'image', data: body.imageData, name: 'upload' }] : [],
    metadata: {},
  });

  let reply;
  try {
    reply = await answerChatMessage({
      database,
      model: selectedModel,
      message,
      students,
      hasImage,
      conversationId: conversation.id,
      // The turn just written is the prompt, not history.
      excludeMessageId: userMessage?.id,
      mode: body?.mode === 'agent' ? 'agent' : 'direct',
      useRag: Boolean(body?.useRag),
      mcpServerIds: Array.isArray(body?.mcpServerIds) ? body.mcpServerIds : null,
      actor: {
        email: String(body?.actorEmail || ''),
        name: String(body?.actorName || ''),
        role: body.requesterRole,
      },
      httpClient,
      generateLocalReply: generateAssistantReply,
      feeSummaries: await loadFeeSummaries(database),
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

  // Steps and citations are persisted, not just returned, so reopening a past conversation still
  // shows what the assistant did and which sources it used.
  const metadata = {
    studentsFound: reply.studentsFound,
    modelId: selectedModel.id,
    modelProvider: selectedModel.provider,
    modelName: selectedModel.model,
    usage: reply.usage || null,
    providerResponseId: reply.providerResponseId || null,
    modelError: Boolean(reply.error),
    mode: reply.mode || 'direct',
    steps: reply.steps || [],
    citations: reply.citations || [],
    ...(reply.notice ? { notice: reply.notice } : {}),
    ...(reply.mcpErrors?.length ? { mcpErrors: reply.mcpErrors } : {}),
    ...(reply.stoppedAtStepLimit ? { stoppedAtStepLimit: true } : {}),
  };

  await insertMessage(database, {
    conversationId: conversation.id,
    role: 'assistant',
    content: reply.message,
    attachments: [],
    metadata,
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
    mode: metadata.mode,
    steps: metadata.steps,
    citations: metadata.citations,
    ...(reply.notice ? { notice: reply.notice } : {}),
    ...(reply.mcpErrors?.length ? { mcpErrors: reply.mcpErrors } : {}),
    ...(reply.stoppedAtStepLimit ? { stoppedAtStepLimit: true } : {}),
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

const handleReportCardRequest = async (database, pathname, searchParams, { method = 'GET', body = {} } = {}) => {
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

  // Text fields arrive on the query string for a simple GET. Uploaded images (school logo,
  // student photo) are far too large for a URL, so a POST carries the whole set as a JSON body
  // instead; when present, the body is the source of truth.
  const source = method === 'POST' ? (body || {}) : Object.fromEntries(searchParams.entries());
  const pick = (key) => {
    const value = source[key];
    return value === undefined || value === null || value === '' ? undefined : value;
  };

  // The global branding is the default; a value supplied per-request overrides it. The student's
  // stored photo is used unless the request uploads a one-off one.
  const settings = await loadSchoolSettings(database);
  const term = pick('term') || 'Term 1';
  const pdfBytes = await buildReportCardPdf({
    student,
    term,
    academicYear: pick('academicYear'),
    // The school's own settings decide the grading system; a request may still override either.
    gradingCountry: pick('gradingCountry') || settings.grading_country,
    academicLevel: pick('academicLevel'),
    schoolLevel: pick('schoolLevel') || settings.school_level,
    reportTitle: pick('reportTitle'),
    schoolName: pick('schoolName') || settings.school_name,
    schoolTagline: pick('schoolTagline') || settings.tagline,
    schoolAddress: pick('schoolAddress') || settings.address,
    themeColor: pick('themeColor') || settings.theme_color,
    schoolLogo: pick('schoolLogo') || settings.logo,
    studentPhoto: pick('studentPhoto') || student.photo_url,
    teacherName: pick('teacherName'),
    headTeacherName: pick('headTeacherName'),
    teacherComment: pick('teacherComment'),
    reportNotes: pick('reportNotes'),
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
  const qrBaseUrl = searchParams.get('qrBaseUrl') || undefined;
  // School name, logo and theme come from the global settings; a query param can still override
  // the name for a one-off print.
  const settings = await loadSchoolSettings(database);
  const schoolName = searchParams.get('schoolName') || settings.school_name;

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

  const pdfBytes = await buildIdCardPdf({
    students,
    layout,
    schoolName,
    qrBaseUrl,
    themeColor: settings.theme_color,
    logo: settings.logo,
  });

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

const pdfResponse = (bytes, filename) => ({
  type: 'binary',
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
  },
  body: Buffer.from(bytes),
});

/**
 * A saved AI conversation as a printable PDF report.
 *
 * Teaching staff only — the same gate as the chat itself, since the transcript contains whatever
 * student data was discussed.
 */
const handleChatReportRequest = async (database, pathname, searchParams) => {
  const match = pathname.match(/^\/api\/chat-reports\/([^/]+)\.pdf$/);
  if (!match) {
    return null;
  }

  if (!['admin', 'teacher'].includes(searchParams.get('requesterRole'))) {
    return { type: 'json', status: 403, body: { error: 'Unauthorized' } };
  }

  // Built through the shared loader, so a downloaded report and an emailed one always carry the
  // same content. (The bytes differ — pdf-lib stamps each render with a creation time.)
  const report = await renderChatReport(database, decodeURIComponent(match[1]));
  if (!report) {
    return { type: 'json', status: 404, body: { error: 'Conversation not found' } };
  }
  if (report.messages.length === 0) {
    return { type: 'json', status: 404, body: { error: 'This conversation has no messages to report on' } };
  }

  return pdfResponse(report.pdf, report.filename);
};

/**
 * A lesson plan as a printable PDF. Teaching staff only, checked from the query string as the other
 * document routes do.
 */
const handleLessonPlanRequest = async (database, pathname, searchParams) => {
  const match = pathname.match(/^\/api\/lesson-plans\/([^/]+)\.pdf$/);
  if (!match) {
    return null;
  }

  if (!['admin', 'teacher'].includes(searchParams.get('requesterRole'))) {
    return { type: 'json', status: 403, body: { error: 'Unauthorized' } };
  }

  const { rows } = await database.query('SELECT * FROM lesson_plans WHERE id = $1', [
    decodeURIComponent(match[1]),
  ]);
  const plan = rows[0];
  if (!plan) {
    return { type: 'json', status: 404, body: { error: 'Lesson plan not found' } };
  }

  const settings = await loadSchoolSettings(database);
  const pdfBytes = await buildLessonPlanPdf({
    school: settings,
    themeColor: settings.theme_color,
    plan: formatRow(plan),
  });

  const slug = String(plan.title || 'lesson-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return pdfResponse(pdfBytes, `${slug || 'lesson-plan'}.pdf`);
};

/**
 * Exam papers and their marking schemes.
 *
 * Teaching staff only, checked from the query string because a GET carries no body — the same
 * trust-the-client model as the fee documents below. The marking scheme is the more sensitive of
 * the two, but both come off the same paper, so the gate is identical.
 */
const handleExamPaperRequest = async (database, pathname, searchParams) => {
  const paperMatch = pathname.match(/^\/api\/papers\/([^/]+)\.pdf$/);
  const schemeMatch = pathname.match(/^\/api\/papers\/([^/]+)\/marking-scheme\.pdf$/);
  if (!paperMatch && !schemeMatch) {
    return null;
  }

  if (!['admin', 'teacher'].includes(searchParams.get('requesterRole'))) {
    return { type: 'json', status: 403, body: { error: 'Unauthorized' } };
  }

  const markingScheme = Boolean(schemeMatch);
  const paperId = decodeURIComponent((schemeMatch || paperMatch)[1]);

  const loaded = await loadPaper(database, paperId);
  if (!loaded) {
    return { type: 'json', status: 404, body: { error: 'Paper not found' } };
  }

  const settings = await loadSchoolSettings(database);
  const pdfBytes = await buildExamPaperPdf({
    school: settings,
    themeColor: settings.theme_color,
    paper: loaded.paper,
    questions: loaded.questions,
    markingScheme,
  });

  const slug = String(loaded.paper.title || 'paper').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return pdfResponse(pdfBytes, `${slug || 'paper'}${markingScheme ? '-marking-scheme' : ''}.pdf`);
};

/**
 * Fee receipts and statements. Both are admin-only, checked from the query string because a GET
 * carries no body — the same trust-the-client model as every other role check here, but it does
 * stop a support-staff browser from pulling a student's full fee history.
 */
const handleFeeDocumentRequest = async (database, pathname, searchParams) => {
  const receiptMatch = pathname.match(/^\/api\/fees\/receipts\/([^/]+)\.pdf$/);
  const statementMatch = pathname.match(/^\/api\/fees\/statements\/([^/]+)\.pdf$/);
  const reportMatch = pathname === '/api/fees/report.pdf';
  if (!receiptMatch && !statementMatch && !reportMatch) {
    return null;
  }

  // Receipts and the school-wide financial report stay admin-only. A single student's statement is
  // open to teaching staff too: a teacher fielding "has this family paid?" needs the history, and it
  // is a read of one student rather than a view of the school's finances.
  const requesterRole = searchParams.get('requesterRole');
  const allowedRoles = statementMatch ? ['admin', 'teacher'] : ['admin'];
  if (!allowedRoles.includes(requesterRole)) {
    return { type: 'json', status: 403, body: { error: 'Unauthorized' } };
  }

  const settings = await loadSchoolSettings(database);
  const school = searchParams.get('schoolName') || settings.school_name;
  const branding = { tagline: settings.tagline, themeColor: settings.theme_color };

  // School-wide financial report: headline totals, standing distribution, and arrears ageing.
  // Sourced from the same fees actions the screens use, so the numbers always match.
  if (reportMatch) {
    const asOf = searchParams.get('asOf') || undefined;
    const gradeLevel = searchParams.get('gradeLevel') || undefined;
    const [summary, arrears] = await Promise.all([
      handleFeesFunction(database, { action: 'summary', requesterRole: 'admin', asOf }),
      handleFeesFunction(database, { action: 'arrears_report', requesterRole: 'admin', asOf, gradeLevel }),
    ]);
    const pdfBytes = await buildFinanceReportPdf({ school, ...branding, summary, arrears, asOf: arrears.asOf });
    return pdfResponse(pdfBytes, `financial-report-${arrears.asOf}.pdf`);
  }

  if (receiptMatch) {
    const paymentId = decodeURIComponent(receiptMatch[1]);
    const result = await database.query(
      `
        SELECT
          p.*,
          r.receipt_number, r.issued_at AS receipt_issued_at, r.amount AS receipt_amount,
          r.currency AS receipt_currency,
          s.student_id AS student_number, s.first_name, s.last_name, s.grade_level, s.class_section
        FROM payments p
        JOIN students s ON s.id = p.student_id
        LEFT JOIN receipts r ON r.payment_id = p.id
        WHERE p.id = $1
        LIMIT 1
      `,
      [paymentId],
    );

    const row = result.rows[0];
    if (!row) return notFound('Payment not found');
    if (!row.receipt_number) return notFound('No receipt has been issued for this payment');

    const allocations = row.invoice_id
      ? (
          await database.query('SELECT invoice_number, balance_due FROM invoices WHERE id = $1', [row.invoice_id])
        ).rows.map((invoice) => ({
          invoice_number: invoice.invoice_number,
          applied: toAmount(row.amount),
          balance_due: toAmount(invoice.balance_due),
        }))
      : [];

    const pdfBytes = await buildFeeReceiptPdf({
      school,
      ...branding,
      student: {
        full_name: `${row.first_name} ${row.last_name}`,
        student_number: row.student_number,
        grade_level: row.grade_level,
        class_section: row.class_section,
      },
      payment: row,
      receipt: {
        receipt_number: row.receipt_number,
        issued_at: row.receipt_issued_at,
        amount: row.receipt_amount,
        currency: row.receipt_currency,
      },
      allocations,
    });

    return pdfResponse(pdfBytes, `${row.receipt_number}.pdf`);
  }

  const studentId = decodeURIComponent(statementMatch[1]);
  const ledger = await handleFeesFunction(database, {
    action: 'student_ledger',
    requesterRole: 'admin',
    studentId,
  });
  if (ledger.error) return notFound(ledger.error);

  const from = toIsoDate(searchParams.get('from'));
  const to = toIsoDate(searchParams.get('to'));
  const entries = ledger.entries.filter(
    (entry) => (!from || entry.date >= from) && (!to || entry.date <= to),
  );

  const pdfBytes = await buildFeeStatementPdf({
    school,
    ...branding,
    student: ledger.student,
    entries,
    summary: ledger.summary,
    // Every mobile-money and bank attempt, settled or not, listed after the balance so a parent can
    // see a pending or failed request rather than concluding their payment vanished.
    transactions: (ledger.transactions || []).filter(
      (transaction) => (!from || transaction.date >= from) && (!to || transaction.date <= to),
    ),
    asOf: to || new Date(),
  });

  return pdfResponse(pdfBytes, `${ledger.student.student_number}-fee-statement.pdf`);
};

/**
 * Self-service tenant provisioning, dispatched by an `action`. Public actions (availability,
 * signup, callback, status) power the sign-up + pay flow; list and sweep are admin/cron only.
 * Inert (returns an error) unless a control database is configured.
 */
const handleProvisionFunction = async (provisioning, body = {}, httpClient) => {
  if (!provisioning) return { error: 'Self-service provisioning is not enabled on this deployment' };
  const { control } = provisioning;
  const action = body?.action;

  if (action === 'availability') {
    return checkAvailability(control, body.subdomain);
  }

  if (action === 'signup') {
    return startSubscription(
      control,
      {
        subdomain: body.subdomain,
        schoolName: body.schoolName,
        contactEmail: body.contactEmail,
        provider: body.provider,
        phoneNumber: body.phoneNumber,
        bankCode: body.bankCode,
      },
      { initiateCharge: provisioning.initiateCharge, httpClient },
    );
  }

  if (action === 'callback') {
    const result = await confirmSubscriptionPayment(
      control,
      { externalReference: body.externalReference || body.reference, status: body.status },
      provisioning.provisionOptions,
    );
    if (result.provisioned) {
      provisioning.onProvisioned(result.subdomain);
      await provisioning.notifyActivated(result.tenant, httpClient);
    }
    return result;
  }

  if (action === 'status') {
    const tenant = await getTenantBySubdomain(control, normalizeSubdomain(body.subdomain));
    return {
      tenant: tenant
        ? { subdomain: tenant.subdomain, status: tenant.status, current_period_end: tenant.current_period_end }
        : null,
    };
  }

  if (action === 'list') {
    if (body.requesterRole !== 'admin') return { error: 'Unauthorized' };
    return { tenants: await listTenants(control) };
  }

  if (action === 'sweep') {
    if (body.requesterRole !== 'admin') return { error: 'Unauthorized' };
    return sweepSubscriptions(control);
  }

  return { error: `Unsupported provision action: ${action}` };
};

export const createAppRuntime = async ({
  connectionString,
  useInMemoryDatabase = false,
  httpClient = fetch,
  controlDatabase = null,
  useInMemoryControl = false,
  provisionOptions = {},
} = {}) => {
  const defaultDatabase = createDatabaseConnection({
    connectionString,
    useInMemoryDatabase,
  });

  await waitForDatabase(defaultDatabase, useInMemoryDatabase ? { attempts: 1, delayMs: 0 } : undefined);
  // httpClient is threaded through so curriculum seeding embeds via the same (injectable) client
  // every other outbound call uses, rather than reaching the network directly under test.
  await initializeDatabase(defaultDatabase, { httpClient });

  // The control plane (tenant registry + subscriptions). Present only when a control database is
  // configured (CONTROL_DATABASE_URL, an injected handle, or the in-memory flag for tests). Without
  // it the app is single-tenant / static-TENANTS exactly as before.
  const control =
    controlDatabase ||
    (useInMemoryControl ? createDatabaseConnection({ useInMemoryDatabase: true }) : createControlConnection());
  if (control) {
    await initializeControlSchema(control);
  }

  // With a control database, subdomains resolve dynamically from it (self-service provisioning);
  // otherwise the static TENANTS env (if any) is used. The registry shares the provisioning
  // connection factory so tests can route in-memory tenant databases (production uses the real one).
  const lookup = control ? (subdomain) => lookupTenantRoute(control, subdomain) : null;
  const tenants = createTenantRegistry({
    lookup,
    ...(provisionOptions.createConnection ? { createConnection: provisionOptions.createConnection } : {}),
    ...(provisionOptions.init ? { init: provisionOptions.init } : {}),
  });

  const provisioning = control
    ? {
        control,
        initiateCharge: createSubscriptionCharge,
        provisionOptions,
        onProvisioned: (subdomain) => tenants.invalidate(subdomain),
        // Best-effort "your school is ready" email; a failed send never fails provisioning, and
        // it is a no-op in mock email mode (the default).
        notifyActivated: async (tenant, client) => {
          if (!tenant?.contact_email) return;
          try {
            const message = renderActivationEmail({ schoolName: tenant.school_name, subdomain: tenant.subdomain });
            await sendEmail({ to: tenant.contact_email, ...message }, { httpClient: provisionOptions.sendEmailClient || client });
          } catch (error) {
            console.warn('Activation email failed:', error instanceof Error ? error.message : error);
          }
        },
      }
    : null;

  return {
    database: defaultDatabase,
    control,
    tenantsEnabled: tenants.enabled,
    provisioningEnabled: Boolean(provisioning),
    // Used by the HTTP layer to pick the tenant database for a request; single-tenant callers and
    // tests omit host and get the default database.
    resolveDatabase: (host, headerTenant) => tenants.resolve(host, headerTenant, defaultDatabase),
    async close() {
      await defaultDatabase.close();
      await tenants.close();
      if (control) await control.close();
    },
    async dispatch({ method = 'GET', pathname = '/', searchParams = new URLSearchParams(), body = {}, headers = {}, database = defaultDatabase }) {
      const reportCardResponse = await handleReportCardRequest(database, pathname, searchParams, { method, body });
      if (reportCardResponse) {
        return reportCardResponse;
      }

      const idCardResponse = await handleIdCardRequest(database, pathname, searchParams);
      if (idCardResponse) {
        return idCardResponse;
      }

      const feeDocumentResponse = await handleFeeDocumentRequest(database, pathname, searchParams);
      if (feeDocumentResponse) {
        return feeDocumentResponse;
      }

      const examPaperResponse = await handleExamPaperRequest(database, pathname, searchParams);
      if (examPaperResponse) {
        return examPaperResponse;
      }

      const lessonPlanResponse = await handleLessonPlanRequest(database, pathname, searchParams);
      if (lessonPlanResponse) {
        return lessonPlanResponse;
      }

      const chatReportResponse = await handleChatReportRequest(database, pathname, searchParams);
      if (chatReportResponse) {
        return chatReportResponse;
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

      if (method === 'GET' && pathname === '/api/meta') {
        return {
          type: 'json',
          status: 200,
          body: { data: { version: APP_VERSION, build: BUILD_NUMBER, developer: DEVELOPER_CONTACTS } },
        };
      }

      if (method === 'POST' && pathname === '/api/db') {
        const data = await handleDbQuery(database, body, httpClient);
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

      if (method === 'POST' && pathname === '/api/functions/student-card') {
        const data = await handleStudentCardFunction(database, body);
        return data?.error
          ? { type: 'json', status: 404, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/gate-pass') {
        const data = await handleGatePassFunction(database, body);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/meal-record') {
        const data = await handleMealRecordFunction(database, body);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/settings') {
        const data = await handleSettingsFunction(database, body);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/provision') {
        const data = await handleProvisionFunction(provisioning, body, httpClient);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/fees') {
        const data = await handleFeesFunction(database, body);
        return data?.error
          ? { type: 'json', status: 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/ai-chat') {
        const data = await handleAiChatFunction(database, body, httpClient);
        return data?.error === 'Unauthorized'
          ? { type: 'json', status: 403, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/ai-models') {
        return { type: 'json', status: 200, body: { data: { models: getPublicModelCatalog() } } };
      }

      if (method === 'GET' && pathname === '/api/grading-schemes') {
        return { type: 'json', status: 200, body: { data: { schemes: getPublicGradingOptions() } } };
      }

      if (method === 'GET' && pathname === '/api/curriculum-frameworks') {
        return { type: 'json', status: 200, body: { data: { frameworks: getPublicCurriculumFrameworks() } } };
      }

      // SchoolBot's own MCP server: the same tool registry, exposed to external MCP clients.
      // Returns raw JSON-RPC envelopes rather than the { data } wrapper the browser endpoints use,
      // because the caller is an MCP client and expects the protocol's own shape.
      if (method === 'POST' && pathname === '/api/mcp') {
        const result = await handleMcpServerRequest({ database, body, headers, httpClient });
        return result.body === null
          ? { type: 'json', status: result.status, body: {} }
          : { type: 'json', status: result.status, body: result.body };
      }

      if (method === 'POST' && pathname === '/api/functions/search') {
        const data = await handleSearchFunction(database, body, httpClient);
        return data?.error
          ? { type: 'json', status: data.error === 'Unauthorized' ? 403 : 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/chat-report') {
        const data = await handleChatReportFunction(database, body, httpClient);
        return data?.error
          ? { type: 'json', status: data.error === 'Unauthorized' ? 403 : 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/lesson-planner') {
        const data = await handleLessonPlannerFunction(database, body, httpClient);
        return data?.error
          ? { type: 'json', status: data.error === 'Unauthorized' ? 403 : 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/digital-examiner') {
        const data = await handleDigitalExaminerFunction(database, body, httpClient);
        // The payload is kept alongside the error rather than nulled: a failed generation still
        // carries the model's reply, and discarding it is what left the teacher with an error
        // dialog and no way to recover the questions it had just written.
        return data?.error
          ? { type: 'json', status: data.error === 'Unauthorized' ? 403 : 400, body: { error: data.error, data } }
          : { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/curriculum') {
        const data = await handleCurriculumFunction(database, body, httpClient);
        return data?.error
          ? { type: 'json', status: data.error === 'Unauthorized' ? 403 : 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
      }

      // Note: mcp_servers is deliberately absent from the TABLES allow-list above. It holds live
      // credentials, and /api/db has no role check — this endpoint is the only way in, and it masks
      // the token on every read.
      if (method === 'POST' && pathname === '/api/functions/mcp') {
        const data = await handleMcpFunction(database, body, httpClient);
        return data?.error
          ? { type: 'json', status: data.error === 'Unauthorized' ? 403 : 400, body: { error: data.error, data: null } }
          : { type: 'json', status: 200, body: { data } };
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
        'Access-Control-Allow-Headers': 'Content-Type, X-Tenant',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      response.end();
      return;
    }

    const url = new URL(request.url, 'http://127.0.0.1');

    try {
      if (url.pathname.startsWith('/api/')) {
        const { raw, body } = request.method === 'POST' ? await readRequestBody(request) : { raw: '', body: {} };

        // Payment webhooks (subscription + student fees) must be proven to come from the provider,
        // or anyone could POST a fake "paid" and provision a school or clear an invoice for free.
        if (isPaymentWebhook(url.pathname, body) && !isWebhookSignatureValid(raw, request.headers['x-webhook-signature'])) {
          sendJson(response, 401, { error: 'Invalid webhook signature' });
          return;
        }

        // Route to the tenant's database by subdomain (or X-Tenant). In single-tenant mode this is
        // always the default database. A suspended school (lapsed subscription) is blocked with a
        // renewal notice; an unknown subdomain is rejected.
        const { database, tenantId, status } = await runtime.resolveDatabase(request.headers.host, request.headers['x-tenant']);
        if (!database) {
          if (status === 'suspended') {
            sendJson(response, 402, { error: 'This school\'s subscription has lapsed. Please renew to continue.', tenant: tenantId, status });
            return;
          }
          if (status === 'pending') {
            sendJson(response, 402, { error: 'This school is awaiting activation. Complete payment to continue.', tenant: tenantId, status });
            return;
          }
          sendJson(response, 404, { error: `Unknown school: ${tenantId}` });
          return;
        }

        const result = await runtime.dispatch({
          method: request.method || 'GET',
          pathname: url.pathname,
          searchParams: url.searchParams,
          body,
          headers: request.headers,
          database,
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
  // USE_IN_MEMORY_DB runs the same code path against pg-mem, for demos and machines
  // without a PostgreSQL instance. Data is discarded when the process exits.
  const useInMemoryDatabase = process.env.USE_IN_MEMORY_DB === 'true' || process.argv.includes('--in-memory');

  try {
    const { address } = await startServer({ useInMemoryDatabase });
    const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
    console.log(`Local backend listening on http://${DEFAULT_HOST}:${port}`);
    if (useInMemoryDatabase) {
      console.log('Using the in-memory database — records are seeded fresh and lost on exit.');
    }
  } catch (error) {
    if (error?.code === 'ECONNREFUSED') {
      const target = process.env.DATABASE_URL || 'postgres://127.0.0.1:5432';
      console.error(`\nCannot reach PostgreSQL at ${target}\n`);
      console.error('Start a database, or run without one:');
      console.error('  docker compose -f docker-compose.dev.yml up db   # real PostgreSQL');
      console.error('  npm run start:memory                            # in-memory, data lost on exit\n');
      process.exit(1);
    }
    throw error;
  }
}
