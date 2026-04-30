import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseConnection, waitForDatabase } from './db/connection.mjs';
import { initializeDatabase } from './db/schema.mjs';
import { buildReportCardPdf } from './reports/report-card.mjs';
import { generateAssistantReply } from './services/student-chat.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const DEFAULT_STATIC_ROOT = process.env.LOCAL_STATIC_ROOT || join(ROOT_DIR, 'dist');
const DEFAULT_HOST = process.env.LOCAL_BACKEND_HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.LOCAL_BACKEND_PORT || process.env.PORT || 8787);

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
      'subjects',
      'notes',
    ],
    jsonColumns: ['subjects'],
  },
  conversations: {
    columns: ['id', 'title', 'created_at', 'updated_at'],
    touchesUpdatedAt: true,
  },
  messages: {
    columns: ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'],
    jsonColumns: ['attachments', 'metadata'],
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

const handleAiChatFunction = async (database, body) => {
  const message = String(body?.message || '').trim();
  const hasImage = Boolean(body?.imageData);
  const students = await fetchAllStudents(database);

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

  const reply = generateAssistantReply({
    message,
    students,
    hasImage,
  });

  await insertMessage(database, {
    conversationId: conversation.id,
    role: 'assistant',
    content: reply.message,
    attachments: [],
    metadata: { studentsFound: reply.studentsFound },
  });

  return {
    message: reply.message,
    studentsFound: reply.studentsFound,
    conversationId: conversation.id,
  };
};

const handleVoiceFunction = async () => ({
  warning: 'Voice transcription is not implemented in local mode yet. Type your message to continue.',
});

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
  const pdfBytes = await buildReportCardPdf({
    student,
    term,
    academicYear,
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

export const createAppRuntime = async ({
  connectionString,
  useInMemoryDatabase = false,
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

      if (method === 'POST' && pathname === '/api/functions/ai-chat') {
        const data = await handleAiChatFunction(database, body);
        return { type: 'json', status: 200, body: { data } };
      }

      if (method === 'POST' && pathname === '/api/functions/voice-to-text') {
        const data = await handleVoiceFunction();
        return { type: 'json', status: 200, body: { data } };
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
