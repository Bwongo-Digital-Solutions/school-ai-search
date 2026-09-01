/**
 * Turns database rows into Meilisearch documents, and defines who may see each one.
 *
 * The `roles` array on every document is the security boundary for search. Copying student, fee and
 * attendance data into a second store means the index has to enforce the same access rules the
 * database does, or search becomes a way around them. Two things make that hold:
 *
 *   - every document declares the roles allowed to see it, and services/search.mjs filters every
 *     query by the requester's role before it reaches Meilisearch;
 *   - the browser never talks to Meilisearch directly, so no key exists that could skip the filter.
 *
 * Support staff appear in no `roles` array anywhere. They are limited to fee *status* through
 * /api/functions/fee-status, and search would be a way past that.
 */
import {
  addDocuments,
  createIndex,
  deleteAllDocuments,
  deleteDocuments,
  updateSettings,
  waitForTask,
} from './meili.mjs';
import { DEFAULT_TENANT } from '../db/tenants.mjs';
import { FINANCE_ROLES, TEACHING_ROLES } from '../auth/roles.mjs';

// Which roles an index's documents may be returned to. A role missing from every index gets zero
// hits with a 200 — indistinguishable from "nothing matched" — so these come from the shared lists.
const TEACHING = TEACHING_ROLES;
const ADMIN_ONLY = FINANCE_ROLES;

/**
 * The index definitions. `build` reads rows from Postgres — which stays the system of record — and
 * returns documents; a full reindex rebuilds every index from these.
 */
export const INDEXES = {
  students: {
    roles: TEACHING,
    searchableAttributes: ['full_name', 'student_id', 'email', 'parent_name', 'subjects', 'notes'],
    filterableAttributes: ['roles', 'grade_level', 'class_section', 'status', 'lifecycle_status'],
    sortableAttributes: ['last_name', 'grade_level'],
    build: async (database) => {
      const { rows } = await database.query(
        `SELECT id, student_id, first_name, last_name, email, parent_name, grade_level,
                class_section, status, lifecycle_status, subjects, notes
         FROM students`,
      );
      return rows.map((row) => ({
        id: row.id,
        kind: 'student',
        roles: TEACHING,
        full_name: `${row.first_name} ${row.last_name}`,
        last_name: row.last_name,
        student_id: row.student_id,
        email: row.email,
        parent_name: row.parent_name,
        grade_level: row.grade_level,
        class_section: row.class_section,
        status: row.status,
        lifecycle_status: row.lifecycle_status,
        subjects: Array.isArray(row.subjects) ? row.subjects : [],
        notes: row.notes,
      }));
    },
  },

  curriculum: {
    roles: TEACHING,
    searchableAttributes: ['title', 'heading', 'content'],
    filterableAttributes: ['roles', 'curriculum', 'subject', 'grade_level', 'source_type'],
    build: async (database) => {
      const { rows } = await database.query(
        `SELECT c.id, c.heading, c.content, c.curriculum, c.subject, c.grade_level,
                d.title, d.source_type, d.id AS document_id
         FROM curriculum_chunks c
         JOIN curriculum_documents d ON d.id = c.document_id`,
      );
      return rows.map((row) => ({
        id: row.id,
        kind: 'curriculum',
        roles: TEACHING,
        document_id: row.document_id,
        title: row.title,
        heading: row.heading,
        // Trimmed: the palette shows a snippet, and whole passages would bloat the index for no gain.
        content: String(row.content || '').slice(0, 1200),
        curriculum: row.curriculum,
        subject: row.subject,
        grade_level: row.grade_level,
        source_type: row.source_type,
      }));
    },
  },

  lesson_plans: {
    roles: TEACHING,
    searchableAttributes: ['title', 'topic', 'subtopic', 'subject_name', 'outcomes', 'competencies'],
    filterableAttributes: ['roles', 'subject_name', 'grade_level', 'term', 'academic_year', 'status'],
    build: async (database) => {
      const { rows } = await database.query(
        `SELECT id, title, topic, subtopic, subject_name, grade_level, term, academic_year,
                status, learning_outcomes, competencies
         FROM lesson_plans`,
      );
      return rows.map((row) => ({
        id: row.id,
        kind: 'lesson_plan',
        roles: TEACHING,
        title: row.title,
        topic: row.topic,
        subtopic: row.subtopic,
        subject_name: row.subject_name,
        grade_level: row.grade_level,
        term: row.term,
        academic_year: row.academic_year,
        status: row.status,
        outcomes: Array.isArray(row.learning_outcomes) ? row.learning_outcomes : [],
        competencies: Array.isArray(row.competencies) ? row.competencies : [],
      }));
    },
  },

  exam_questions: {
    roles: TEACHING,
    searchableAttributes: ['stem', 'topic', 'subtopic', 'subject_name', 'command_word'],
    filterableAttributes: [
      'roles',
      'subject_name',
      'grade_level',
      'difficulty',
      'status',
      'curriculum',
      'question_type',
    ],
    build: async (database) => {
      const { rows } = await database.query(
        `SELECT id, stem, topic, subtopic, subject_name, grade_level, difficulty, status,
                curriculum, question_type, command_word, marks
         FROM exam_questions`,
      );
      return rows.map((row) => ({
        id: row.id,
        kind: 'exam_question',
        roles: TEACHING,
        stem: row.stem,
        topic: row.topic,
        subtopic: row.subtopic,
        subject_name: row.subject_name,
        grade_level: row.grade_level,
        difficulty: row.difficulty,
        status: row.status,
        curriculum: row.curriculum,
        question_type: row.question_type,
        command_word: row.command_word,
        marks: row.marks,
      }));
    },
  },

  // Admin only, because the ledger is: handleFeesFunction gates every fees action to admins, and an
  // index that answered a teacher's query about invoices would quietly undo that.
  fees: {
    roles: ADMIN_ONLY,
    searchableAttributes: ['student_name', 'reference', 'description'],
    filterableAttributes: ['roles', 'student_id', 'kind_detail', 'status', 'academic_year', 'term'],
    build: async (database) => {
      const [invoices, payments] = await Promise.all([
        database.query(
          `SELECT i.id, i.invoice_number, i.status, i.total_amount, i.balance_due, i.currency,
                  i.academic_year, i.term, i.issued_at, i.student_id,
                  s.first_name, s.last_name
           FROM invoices i JOIN students s ON s.id = i.student_id`,
        ),
        database.query(
          `SELECT p.id, p.amount, p.currency, p.payment_method, p.reference, p.paid_at, p.student_id,
                  r.receipt_number, s.first_name, s.last_name
           FROM payments p
           JOIN students s ON s.id = p.student_id
           LEFT JOIN receipts r ON r.payment_id = p.id`,
        ),
      ]);

      // Meilisearch only accepts alphanumerics, hyphens and underscores in a document id — a colon
      // is rejected outright — so invoices and payments are namespaced with a hyphen.
      return [
        ...invoices.rows.map((row) => ({
          id: `invoice-${row.id}`,
          kind: 'fee',
          kind_detail: 'invoice',
          roles: ADMIN_ONLY,
          student_id: row.student_id,
          student_name: `${row.first_name} ${row.last_name}`,
          reference: row.invoice_number,
          description: [row.term, row.academic_year].filter(Boolean).join(' ') || 'Invoice',
          amount: Number(row.total_amount),
          balance_due: Number(row.balance_due),
          currency: row.currency,
          status: row.status,
          academic_year: row.academic_year,
          term: row.term,
          date: row.issued_at,
        })),
        ...payments.rows.map((row) => ({
          id: `payment-${row.id}`,
          kind: 'fee',
          kind_detail: 'payment',
          roles: ADMIN_ONLY,
          student_id: row.student_id,
          student_name: `${row.first_name} ${row.last_name}`,
          reference: row.receipt_number || row.reference || '',
          description: row.payment_method || 'Payment',
          amount: Number(row.amount),
          currency: row.currency,
          status: 'paid',
          date: row.paid_at,
        })),
      ];
    },
  },

  attendance: {
    roles: TEACHING,
    searchableAttributes: ['student_name', 'reason', 'status'],
    filterableAttributes: ['roles', 'student_id', 'status', 'attendance_date'],
    build: async (database) => {
      const { rows } = await database.query(
        `SELECT a.id, a.attendance_date, a.status, a.reason, a.marked_by, a.student_id,
                s.first_name, s.last_name
         FROM attendance_records a JOIN students s ON s.id = a.student_id`,
      );
      return rows.map((row) => ({
        id: row.id,
        kind: 'attendance',
        roles: TEACHING,
        student_id: row.student_id,
        student_name: `${row.first_name} ${row.last_name}`,
        attendance_date: row.attendance_date instanceof Date
          ? row.attendance_date.toISOString().slice(0, 10)
          : String(row.attendance_date || '').slice(0, 10),
        status: row.status,
        reason: row.reason,
        marked_by: row.marked_by,
      }));
    },
  },
};

export const INDEX_NAMES = Object.keys(INDEXES);

/**
 * The Meilisearch index a school's documents live in.
 *
 * One deployment now serves many schools, and index uids used to be the bare names below — so every
 * school wrote into the same six indexes. Because both the incremental sync and the full rebuild
 * clear an index before refilling it from *one* database, an ordinary attendance mark in one school
 * replaced another school's documents wholesale, and those documents then passed the `roles` filter
 * cleanly. Namespacing the uid is what keeps two schools apart.
 *
 * `__` separates the two parts because a tenant id is a DNS label and can never contain one, so
 * `a-b__c` can only ever mean tenant `a-b`, index `c`. The default tenant keeps the bare names, so
 * a single-school deployment upgrading to this needs no reindex and sees no change.
 */
export const indexUidFor = (tenantId, name) =>
  !tenantId || tenantId === DEFAULT_TENANT ? name : `${tenantId}__${name}`;

/**
 * Meilisearch accepts only alphanumerics, hyphens and underscores in a document id, and rejects the
 * whole batch when one is malformed. Database ids are UUIDs so they pass, but any index that
 * synthesises a composite id has to keep to the same charset — this is what catches one that does
 * not, at the point of indexing rather than as an opaque task failure.
 */
export const isValidDocumentId = (id) => /^[a-zA-Z0-9_-]+$/.test(String(id));

/** Which indexes a role may query at all. Support staff get none. */
export const indexesForRole = (role) =>
  INDEX_NAMES.filter((name) => INDEXES[name].roles.includes(role));

const BATCH = Number(process.env.MEILISEARCH_BATCH || 500);

/**
 * Rebuilds every index from Postgres.
 *
 * Clears each index first so rows deleted while search was unconfigured do not linger — the whole
 * point of a reindex is that the result matches the database exactly.
 */
export const reindexAll = async (database, { httpClient = fetch, tenantId = DEFAULT_TENANT } = {}) => {
  const counts = {};

  for (const [name, definition] of Object.entries(INDEXES)) {
    const uid = indexUidFor(tenantId, name);
    await createIndex(uid, { httpClient });
    await updateSettings(
      uid,
      {
        searchableAttributes: definition.searchableAttributes,
        filterableAttributes: definition.filterableAttributes,
        ...(definition.sortableAttributes ? { sortableAttributes: definition.sortableAttributes } : {}),
      },
      { httpClient },
    );

    const cleared = await deleteAllDocuments(uid, { httpClient });
    await waitForTask(cleared.taskUid, { httpClient });

    let documents = [];
    try {
      documents = await definition.build(database);
    } catch (error) {
      // A table that does not exist yet on an older database should not abort the whole reindex.
      console.warn(`Skipped indexing ${name}:`, error instanceof Error ? error.message : error);
      counts[name] = 0;
      continue;
    }

    for (let start = 0; start < documents.length; start += BATCH) {
      const task = await addDocuments(uid, documents.slice(start, start + BATCH), { httpClient });
      await waitForTask(task.taskUid, { httpClient });
    }

    counts[name] = documents.length;
  }

  return counts;
};

// Which index a mutation on a given table should refresh.
const TABLE_TO_INDEX = {
  students: 'students',
  curriculum_chunks: 'curriculum',
  lesson_plans: 'lesson_plans',
  exam_questions: 'exam_questions',
  invoices: 'fees',
  payments: 'fees',
  attendance_records: 'attendance',
};

/**
 * Refreshes one index after a write, so search does not go stale between reindexes.
 *
 * Deliberately never throws: a search index falling behind must not fail the payment or the
 * attendance mark that triggered it. Postgres remains the source of truth, and a reindex repairs
 * anything missed.
 */
export const syncTable = async (database, table, { httpClient = fetch, tenantId = DEFAULT_TENANT } = {}) => {
  const name = TABLE_TO_INDEX[table];
  if (!name) return;

  const uid = indexUidFor(tenantId, name);

  try {
    const documents = await INDEXES[name].build(database);
    await deleteAllDocuments(uid, { httpClient });
    for (let start = 0; start < documents.length; start += BATCH) {
      await addDocuments(uid, documents.slice(start, start + BATCH), { httpClient });
    }
  } catch (error) {
    console.warn(`Search index ${name} not updated:`, error instanceof Error ? error.message : error);
  }
};

/** Removes specific documents, mirroring a delete so retention holds. */
export const removeFromIndex = async (table, ids, { httpClient = fetch, tenantId = DEFAULT_TENANT } = {}) => {
  const name = TABLE_TO_INDEX[table];
  if (!name || ids.length === 0) return;

  const uid = indexUidFor(tenantId, name);

  try {
    await deleteDocuments(uid, ids, { httpClient });
  } catch (error) {
    console.warn(`Search index ${uid} delete failed:`, error instanceof Error ? error.message : error);
  }
};
