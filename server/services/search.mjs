/**
 * Global search across students, teaching content, fees and attendance.
 *
 * Reached through POST /api/functions/search, following the ACTIONS-map convention of fees.mjs and
 * curriculum.mjs.
 *
 * Two properties matter here more than anything else:
 *
 *   1. The role filter is applied *here*, server-side, and the caller cannot widen it. Every
 *      document carries a `roles` array (see search/indexer.mjs) and every query is constrained to
 *      the requester's role. Search must not become a way around the gates on the database.
 *   2. Meilisearch is optional. Unconfigured — the default — search falls back to the SQL query the
 *      app already used, and reports which engine answered. No existing deployment changes
 *      behaviour by upgrading.
 */
import { INDEXES, indexesForRole, reindexAll } from '../search/indexer.mjs';
import { isSearchConfigured, multiSearch } from '../search/meili.mjs';

// Support staff are deliberately absent: they may see fee status through /api/functions/fee-status
// and nothing else, and a search box would be a way past that.
const SEARCH_ROLES = ['admin', 'teacher'];

const trimmed = (value) => String(value ?? '').trim();

const HIT_LIMIT = Number(process.env.SEARCH_HIT_LIMIT || 5);

/**
 * The fallback when Meilisearch is not configured: the students-only SQL search the app already
 * had. Substring matching, no typo tolerance — which is exactly why Meilisearch is worth running —
 * but it keeps the feature working everywhere.
 */
const searchPostgres = async (database, query) => {
  const like = `%${query.toLowerCase()}%`;
  const { rows } = await database.query(
    `SELECT id, student_id, first_name, last_name, grade_level, class_section, status
     FROM students
     WHERE LOWER(first_name) LIKE $1 OR LOWER(last_name) LIKE $1
        OR LOWER(student_id) LIKE $1 OR LOWER(COALESCE(email, '')) LIKE $1
     ORDER BY last_name
     LIMIT $2`,
    [like, HIT_LIMIT * 2],
  );

  return {
    engine: 'postgres',
    groups: [
      {
        index: 'students',
        total: rows.length,
        hits: rows.map((row) => ({
          id: row.id,
          kind: 'student',
          title: `${row.first_name} ${row.last_name}`,
          subtitle: `${row.student_id} · Grade ${row.grade_level}-${row.class_section} · ${row.status}`,
        })),
      },
    ],
    // Said plainly so the UI can tell the user why results look basic, rather than implying the
    // search is as good as it gets.
    notice: 'Meilisearch is not configured, so this is a basic student-name search.',
  };
};

/** Turns a Meilisearch hit into the { title, subtitle } shape the palette renders. */
const presentHit = (index, hit) => {
  const base = { id: hit.id, kind: hit.kind, raw: hit };

  switch (index) {
    case 'students':
      return {
        ...base,
        title: hit.full_name,
        subtitle: [hit.student_id, `Grade ${hit.grade_level}-${hit.class_section}`, hit.status]
          .filter(Boolean)
          .join(' · '),
      };
    case 'curriculum':
      return {
        ...base,
        title: [hit.title, hit.heading].filter(Boolean).join(' — '),
        subtitle: [hit.subject, hit.curriculum].filter(Boolean).join(' · '),
        snippet: String(hit.content || '').slice(0, 160),
      };
    case 'lesson_plans':
      return {
        ...base,
        title: hit.title,
        subtitle: [hit.subject_name, hit.topic, hit.term, hit.status].filter(Boolean).join(' · '),
      };
    case 'exam_questions':
      return {
        ...base,
        title: String(hit.stem || '').slice(0, 120),
        subtitle: [hit.subject_name, hit.topic, hit.difficulty, `${hit.marks} mark(s)`, hit.status]
          .filter(Boolean)
          .join(' · '),
      };
    case 'fees':
      return {
        ...base,
        title: `${hit.student_name} — ${hit.reference || hit.description}`,
        subtitle: [hit.kind_detail, `${hit.currency} ${hit.amount}`, hit.status].filter(Boolean).join(' · '),
      };
    case 'attendance':
      return {
        ...base,
        title: `${hit.student_name} — ${hit.status}`,
        subtitle: [hit.attendance_date, hit.reason].filter(Boolean).join(' · '),
      };
    default:
      return { ...base, title: hit.id, subtitle: index };
  }
};

const query = async ({ database, body, actor, httpClient }) => {
  const text = trimmed(body.query);
  if (!text) return { engine: isSearchConfigured() ? 'meilisearch' : 'postgres', groups: [] };

  if (!isSearchConfigured()) {
    return searchPostgres(database, text);
  }

  // The role decides which indexes are queried at all AND constrains every one of them. Both are
  // needed: the index list stops a teacher reaching the fees index, and the filter stops a document
  // that should not have been in a shared index from surfacing.
  const allowed = indexesForRole(actor.role);
  const requested = Array.isArray(body.indexes) && body.indexes.length > 0
    ? allowed.filter((name) => body.indexes.includes(name))
    : allowed;

  if (requested.length === 0) {
    return { engine: 'meilisearch', groups: [] };
  }

  const queries = requested.map((name) => ({
    indexUid: name,
    q: text,
    limit: Number(body.limit) || HIT_LIMIT,
    filter: `roles = ${actor.role}`,
    attributesToHighlight: INDEXES[name].searchableAttributes,
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
  }));

  try {
    const results = await multiSearch(queries, { httpClient });

    return {
      engine: 'meilisearch',
      groups: results
        .map((result) => ({
          index: result.indexUid,
          total: result.estimatedTotalHits ?? result.hits.length,
          processingTimeMs: result.processingTimeMs,
          hits: (result.hits || []).map((hit) => presentHit(result.indexUid, hit)),
        }))
        .filter((group) => group.hits.length > 0),
    };
  } catch (error) {
    // An unreachable search server degrades to the SQL search rather than leaving the user with
    // nothing; the notice tells them why the results look thinner than usual.
    console.warn('Meilisearch query failed, falling back to Postgres:', error instanceof Error ? error.message : error);
    const fallback = await searchPostgres(database, text);
    return { ...fallback, notice: 'The search service is unreachable, so this is a basic student-name search.' };
  }
};

const reindex = async ({ database, actor, httpClient }) => {
  if (actor.role !== 'admin') return { error: 'Only an administrator can rebuild the search index' };
  if (!isSearchConfigured()) {
    return {
      error:
        'Meilisearch is not configured. Set MEILISEARCH_HOST (and MEILISEARCH_API_KEY) to enable ' +
        'global search; the app works without it using the basic student search.',
    };
  }

  const counts = await reindexAll(database, { httpClient });
  return { counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
};

const status = async ({ actor }) => ({
  configured: isSearchConfigured(),
  engine: isSearchConfigured() ? 'meilisearch' : 'postgres',
  indexes: indexesForRole(actor.role),
});

const ACTIONS = { query, reindex, status };

export const SEARCH_ACTIONS = Object.keys(ACTIONS);

export const handleSearchFunction = async (database, body = {}, httpClient = fetch) => {
  if (!SEARCH_ROLES.includes(body.requesterRole)) return { error: 'Unauthorized' };

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported search action: ${body.action}` };

  const actor = {
    email: trimmed(body.actorEmail),
    name: trimmed(body.actorName),
    role: body.requesterRole,
  };

  return handler({ database, body, actor, httpClient });
};
