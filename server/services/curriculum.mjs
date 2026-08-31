/**
 * The curriculum library: what teachers upload, what ships bundled, and what the RAG layer ranks.
 *
 * Reached through POST /api/functions/curriculum. Follows the fees.mjs convention — the role gate
 * sits ahead of the action table so no handler can be reached without passing it, and requesterRole
 * is supplied by the browser, matching the deployment-perimeter assumption the rest of the app
 * already makes.
 *
 * Reads are open to teaching staff, writes too: a teacher curating their own subject's materials is
 * the point of the feature. Deleting a bundled 'seed' document is admin-only, so one teacher cannot
 * remove the outlines every other teacher is planning against.
 */
import {
  ingestDocument,
  reindexDocuments,
  retrieveCurriculum,
} from '../rag/retriever.mjs';
import { isEmbeddingConfigured, resolveEmbeddingModel } from '../rag/embeddings.mjs';
import { getPublicCurriculumFrameworks } from './curriculum-frameworks.mjs';
import { requireRole, resolveActor } from '../auth/actor.mjs';

const TEACHING_ROLES = ['admin', 'teacher'];

// A syllabus PDF converted to text runs long, but a single document past this is almost certainly
// an accident (a whole textbook, or a binary pasted as text) and would take minutes to chunk.
const MAX_DOCUMENT_CHARS = Number(process.env.RAG_MAX_DOCUMENT_CHARS || 2_000_000);

const trimmed = (value) => String(value ?? '').trim();

const listDocuments = async ({ database, body }) => {
  const conditions = [];
  const values = [];

  if (body.curriculum) {
    values.push(trimmed(body.curriculum).toLowerCase());
    conditions.push(`curriculum = $${values.length}`);
  }
  if (body.subject) {
    values.push(trimmed(body.subject));
    conditions.push(`subject = $${values.length}`);
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  // Two plain queries merged in Node rather than one join. Postgres would let a GROUP BY on the
  // primary key carry the other columns along, and would happily take a correlated subquery, but
  // pg-mem — which backs the test suite and the Vercel demo — supports neither: the first silently
  // returns NULL for every ungrouped column, the second throws. Grouping only by the grouping
  // column works everywhere.
  const { rows } = await database.query(
    `
      SELECT id, title, curriculum, subject, grade_level, academic_year, term,
             source_type, mime_type, uploaded_by, created_at
      FROM curriculum_documents
      ${clause}
      ORDER BY created_at DESC
      LIMIT 200
    `,
    values,
  );

  const { rows: counts } = await database.query(
    `
      SELECT document_id, COUNT(*)::int AS chunk_count, COUNT(embedding)::int AS embedded_count
      FROM curriculum_chunks
      GROUP BY document_id
    `,
  );

  const countsById = new Map(counts.map((row) => [row.document_id, row]));
  const model = resolveEmbeddingModel();

  return {
    documents: rows.map((row) => ({
      ...row,
      chunk_count: countsById.get(row.id)?.chunk_count ?? 0,
      embedded_count: countsById.get(row.id)?.embedded_count ?? 0,
    })),
    embedding: {
      configured: isEmbeddingConfigured(),
      model: model ? `${model.provider}/${model.model}` : null,
    },
  };
};

const uploadDocument = async ({ database, body, actor, httpClient }) => {
  const title = trimmed(body.title);
  const content = String(body.content ?? '');

  if (!title) return { error: 'A document title is required' };
  if (!content.trim()) return { error: 'The document has no readable text to index' };
  if (content.length > MAX_DOCUMENT_CHARS) {
    return { error: `The document is too large to index (limit ${MAX_DOCUMENT_CHARS.toLocaleString()} characters)` };
  }

  const result = await ingestDocument(database, {
    title,
    content,
    curriculum: trimmed(body.curriculum),
    subject: trimmed(body.subject),
    gradeLevel: body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel),
    academicYear: trimmed(body.academicYear),
    term: trimmed(body.term),
    sourceType: 'upload',
    sourceUri: trimmed(body.sourceUri),
    mimeType: trimmed(body.mimeType) || 'text/markdown',
    uploadedBy: actor.email || actor.name,
    httpClient,
  });

  return { document: result };
};

const deleteDocument = async ({ database, body, actor }) => {
  const id = trimmed(body.documentId);
  if (!id) return { error: 'A documentId is required' };

  const { rows } = await database.query('SELECT id, source_type, title FROM curriculum_documents WHERE id = $1', [id]);
  const document = rows[0];
  if (!document) return { error: 'Document not found' };

  // Removing a bundled outline affects every teacher, so it is an administrator's call.
  if (document.source_type === 'seed' && actor.role !== 'admin') {
    return { error: 'Only an administrator can remove a bundled curriculum outline' };
  }

  // Chunks cascade.
  await database.query('DELETE FROM curriculum_documents WHERE id = $1', [id]);
  return { deleted: { id, title: document.title } };
};

const search = async ({ database, body, httpClient }) => {
  const citations = await retrieveCurriculum(database, {
    query: trimmed(body.query),
    curriculum: trimmed(body.curriculum),
    subject: trimmed(body.subject),
    gradeLevel: body.gradeLevel == null || body.gradeLevel === '' ? null : Number(body.gradeLevel),
    topic: trimmed(body.topic),
    limit: Number(body.limit) || 8,
    httpClient,
  });

  return { citations };
};

/**
 * Backfills embeddings a batch at a time. Batched rather than one-shot so a large corpus does not
 * hold an HTTP request open; the client re-runs while `remaining` is above zero.
 */
const reindex = async ({ database, body, httpClient }) => {
  if (!isEmbeddingConfigured()) {
    return {
      error:
        'No embedding provider is configured. Set OPENAI_API_KEY, GOOGLE_GEMINI_API_KEY, ' +
        'MISTRAL_API_KEY or OLLAMA_BASE_URL to enable semantic search. Keyword search works regardless.',
    };
  }

  return reindexDocuments(database, {
    documentId: trimmed(body.documentId) || null,
    batchSize: Number(body.batchSize) || 64,
    httpClient,
  });
};

const frameworks = async () => ({ frameworks: getPublicCurriculumFrameworks() });

const ACTIONS = {
  list_documents: listDocuments,
  upload_document: uploadDocument,
  delete_document: deleteDocument,
  search,
  reindex,
  frameworks,
};

export const CURRICULUM_ACTIONS = Object.keys(ACTIONS);

export const handleCurriculumFunction = async (database, body = {}, httpClient = fetch, { actor: authenticated, tenantId } = {}) => {
  // The actor comes from the request's session when there was a request to authenticate, and from
  // the body only for an internal call that never had one. See resolveActor.
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, TEACHING_ROLES);
  if (refusal) return refusal;

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported curriculum action: ${body.action}` };

  return handler({ database, body, actor, httpClient, tenantId });
};
