/**
 * Curriculum retrieval: ingest documents into chunks, and rank chunks against a query.
 *
 * The ranking is hybrid by design. Metadata (curriculum, subject, grade) narrows the candidate set
 * in SQL first — a Biology S2 question has no business retrieving IGCSE Economics — and only then
 * does scoring run in Node over that shortlist. With one school's corpus the shortlist is small
 * enough that a full scan costs less than the round trip, which is what lets this work without
 * pgvector and therefore keeps the pg-mem test path and the Vercel demo intact.
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { chunkDocument } from './chunker.mjs';
import { embedQuery, embedTexts, isEmbeddingConfigured } from './embeddings.mjs';
import { cosineSimilarity, fuseRankings, rankLexical } from './lexical.mjs';

const DEFAULT_LIMIT = Number(process.env.RAG_RETRIEVE_LIMIT || 8);

// Ceiling on rows pulled into Node for scoring. Well above a single subject-and-grade slice of any
// realistic school corpus, but a hard stop against a pathological filter matching everything.
const CANDIDATE_LIMIT = Number(process.env.RAG_CANDIDATE_LIMIT || 600);

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

const contentHash = (text) => createHash('sha256').update(String(text || '')).digest('hex');

const parseEmbedding = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Chunks a document, embeds it if a provider is configured, and writes both rows.
 *
 * Idempotent on content: re-ingesting an identical document (same title, curriculum and body)
 * replaces the previous version rather than duplicating it, so a teacher re-uploading a corrected
 * scheme of work does not double every chunk in the index.
 */
export const ingestDocument = async (
  database,
  {
    title,
    content,
    curriculum,
    subject = '',
    gradeLevel = null,
    academicYear = '',
    term = '',
    sourceType = 'upload',
    sourceUri = '',
    mimeType = 'text/markdown',
    uploadedBy = '',
    httpClient = fetch,
    // Seeding passes false: embedding the bundled outlines would fire an API call per chunk on
    // every fresh database — including each newly provisioned tenant — for content that ranks
    // perfectly well lexically. Uploads embed inline, where the teacher is already waiting on a
    // result. reindexDocuments() backfills the rest on demand.
    embed = true,
  },
) => {
  const normalisedCurriculum = normalizeKey(curriculum);
  const normalisedSubject = String(subject || '').trim();
  const hash = contentHash(content);

  const existing = await database.query(
    'SELECT id, content_hash FROM curriculum_documents WHERE title = $1 AND curriculum = $2 LIMIT 1',
    [title, normalisedCurriculum],
  );

  if (existing.rows[0]?.content_hash === hash) {
    return { documentId: existing.rows[0].id, chunkCount: 0, unchanged: true, embedded: false };
  }

  // Chunks cascade on delete, so removing the old document row clears its index in one statement.
  if (existing.rows[0]) {
    await database.query('DELETE FROM curriculum_documents WHERE id = $1', [existing.rows[0].id]);
  }

  const chunks = chunkDocument(content);
  const documentId = randomUUID();

  await database.query(
    `
      INSERT INTO curriculum_documents (
        id, title, curriculum, subject, grade_level, academic_year, term,
        source_type, source_uri, mime_type, content_hash, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      documentId,
      title,
      normalisedCurriculum,
      normalisedSubject,
      gradeLevel,
      academicYear,
      term,
      sourceType,
      sourceUri,
      mimeType,
      hash,
      uploadedBy,
    ],
  );

  const embedded = embed
    ? await embedTexts({ texts: chunks.map((chunk) => chunk.content), httpClient })
    : null;

  for (const [index, chunk] of chunks.entries()) {
    await database.query(
      `
        INSERT INTO curriculum_chunks (
          id, document_id, chunk_index, heading, content, token_count,
          embedding, embedding_model, curriculum, subject, grade_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        randomUUID(),
        documentId,
        chunk.chunkIndex,
        chunk.heading,
        chunk.content,
        chunk.tokenCount,
        embedded ? JSON.stringify(embedded.vectors[index]) : null,
        embedded ? embedded.model : null,
        normalisedCurriculum,
        normalisedSubject,
        gradeLevel,
      ],
    );
  }

  return {
    documentId,
    chunkCount: chunks.length,
    unchanged: false,
    embedded: Boolean(embedded),
  };
};

/**
 * Pulls the metadata-filtered candidate set.
 *
 * Subject and grade are soft filters: a chunk carrying no subject (a general study-skills document,
 * say) stays eligible for every subject rather than being excluded, and the same for grade. Being
 * strict here empties the candidate set on partially-tagged corpora, which reads to the user as
 * "retrieval is broken" rather than "your upload lacks metadata".
 */
const fetchCandidates = async (database, { curriculum, subject, gradeLevel }) => {
  const conditions = [];
  const values = [];

  if (curriculum) {
    values.push(normalizeKey(curriculum));
    conditions.push(`curriculum = $${values.length}`);
  }
  if (subject) {
    values.push(String(subject).trim());
    conditions.push(`(subject = $${values.length} OR subject = '')`);
  }
  if (gradeLevel != null && gradeLevel !== '') {
    values.push(Number(gradeLevel));
    conditions.push(`(grade_level = $${values.length} OR grade_level IS NULL)`);
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await database.query(
    `
      SELECT id, document_id, chunk_index, heading, content, token_count,
             embedding, embedding_model, curriculum, subject, grade_level
      FROM curriculum_chunks${clause}
      LIMIT ${CANDIDATE_LIMIT}
    `,
    values,
  );

  return rows;
};

/**
 * Retrieves the chunks most relevant to `query`, as citation-shaped records.
 *
 * Returns [] rather than throwing when the corpus is empty or the query is blank — every caller
 * treats retrieval as best-effort grounding, and a lesson plan generated without citations is
 * still worth producing.
 */
export const retrieveCurriculum = async (
  database,
  { query, curriculum, subject, gradeLevel, topic, limit = DEFAULT_LIMIT, httpClient = fetch } = {},
) => {
  const searchText = [query, topic].filter(Boolean).join(' ').trim();
  if (!searchText) return [];

  let candidates;
  try {
    candidates = await fetchCandidates(database, { curriculum, subject, gradeLevel });
  } catch {
    // The corpus tables may not exist on a database that predates this feature.
    return [];
  }

  if (candidates.length === 0) return [];

  const lexicalRanking = rankLexical(candidates, searchText);
  const rankings = [lexicalRanking];

  if (isEmbeddingConfigured()) {
    const embeddedQuery = await embedQuery({ query: searchText, httpClient });
    if (embeddedQuery) {
      const semantic = candidates
        .map((chunk) => {
          const vector = parseEmbedding(chunk.embedding);
          // Only compare against chunks embedded by the same model — mixing vector spaces produces
          // similarities that look valid and rank nonsense.
          if (!vector || chunk.embedding_model !== embeddedQuery.model) return null;
          return { chunk, score: cosineSimilarity(embeddedQuery.vector, vector) };
        })
        .filter((entry) => entry && entry.score > 0)
        .sort((left, right) => right.score - left.score);

      if (semantic.length > 0) {
        rankings.push(semantic);
      }
    }
  }

  const fused =
    rankings.length > 1
      ? fuseRankings(rankings, { limit })
      : lexicalRanking.slice(0, limit);

  const documentIds = [...new Set(fused.map((entry) => entry.chunk.document_id))];
  const titles = new Map();

  if (documentIds.length > 0) {
    const placeholders = documentIds.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await database.query(
      `SELECT id, title, source_type FROM curriculum_documents WHERE id IN (${placeholders})`,
      documentIds,
    );
    for (const row of rows) {
      titles.set(row.id, row);
    }
  }

  return fused.map((entry, index) => ({
    citationIndex: index + 1,
    chunkId: entry.chunk.id,
    documentId: entry.chunk.document_id,
    title: titles.get(entry.chunk.document_id)?.title || 'Untitled document',
    sourceType: titles.get(entry.chunk.document_id)?.source_type || 'upload',
    heading: entry.chunk.heading,
    content: entry.chunk.content,
    curriculum: entry.chunk.curriculum,
    subject: entry.chunk.subject,
    gradeLevel: entry.chunk.grade_level,
    score: Number(entry.score.toFixed(6)),
  }));
};

/**
 * Backfills embeddings for chunks that have none, or that were embedded by a different model.
 *
 * This is the companion to seeding without embeddings: a school that later configures an embedding
 * provider runs this once and the bundled outlines become semantically searchable, without having
 * paid for it on every cold boot. Returns counts rather than throwing — a partially embedded corpus
 * is still fully searchable lexically.
 */
export const reindexDocuments = async (database, { documentId = null, batchSize = 64, httpClient = fetch } = {}) => {
  const values = [];
  let clause = 'WHERE embedding IS NULL';

  if (documentId) {
    values.push(documentId);
    clause = `WHERE document_id = $${values.length}`;
  }

  const { rows } = await database.query(
    `SELECT id, content FROM curriculum_chunks ${clause} ORDER BY document_id, chunk_index LIMIT ${Number(batchSize)}`,
    values,
  );

  if (rows.length === 0) {
    return { embedded: 0, remaining: 0, configured: isEmbeddingConfigured() };
  }

  const embedded = await embedTexts({ texts: rows.map((row) => row.content), httpClient });
  if (!embedded) {
    return { embedded: 0, remaining: rows.length, configured: false };
  }

  for (const [index, row] of rows.entries()) {
    await database.query('UPDATE curriculum_chunks SET embedding = $1, embedding_model = $2 WHERE id = $3', [
      JSON.stringify(embedded.vectors[index]),
      embedded.model,
      row.id,
    ]);
  }

  const { rows: pending } = await database.query(
    'SELECT COUNT(*)::int AS count FROM curriculum_chunks WHERE embedding IS NULL',
  );

  return { embedded: rows.length, remaining: pending[0]?.count ?? 0, configured: true };
};

/**
 * Formats retrieved chunks for a system prompt. Numbering here is what the model is told to cite
 * with, and it matches the citationIndex the UI renders, so [2] in an answer resolves to the same
 * source the reader sees.
 */
export const formatCitationsForPrompt = (citations) => {
  if (!Array.isArray(citations) || citations.length === 0) {
    return 'No curriculum sources matched this request. Say so rather than inventing syllabus content.';
  }

  return citations
    .map((citation) =>
      [
        `[${citation.citationIndex}] ${citation.title}${citation.heading ? ` — ${citation.heading}` : ''}`,
        citation.content,
      ].join('\n'),
    )
    .join('\n\n');
};

/** Strips chunk bodies for storage in a metadata column, keeping enough to render a source chip. */
export const toStoredCitations = (citations) =>
  (citations || []).map((citation) => ({
    citationIndex: citation.citationIndex,
    chunkId: citation.chunkId,
    documentId: citation.documentId,
    title: citation.title,
    heading: citation.heading,
    snippet: String(citation.content || '').slice(0, 240),
  }));
