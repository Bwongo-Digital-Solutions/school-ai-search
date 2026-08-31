/**
 * Meilisearch REST client.
 *
 * Raw fetch with an injectable httpClient, matching services/llm-models.mjs and agent/mcp-client.mjs
 * — no new dependency, and every call is testable without a network.
 *
 * Meilisearch is optional everywhere. With MEILISEARCH_HOST unset (the default, and the state of
 * every existing deployment) `isSearchConfigured()` is false and callers fall back to the SQL
 * search. Nothing in the app may hard-depend on this being up.
 */

const HOST = () => (process.env.MEILISEARCH_HOST || '').replace(/\/$/, '');

const REQUEST_TIMEOUT_MS = Number(process.env.MEILISEARCH_TIMEOUT_MS || 10000);

export const isSearchConfigured = () => Boolean(HOST());

const headers = () => ({
  'Content-Type': 'application/json',
  ...(process.env.MEILISEARCH_API_KEY ? { Authorization: `Bearer ${process.env.MEILISEARCH_API_KEY}` } : {}),
});

/**
 * One request. Throws on a non-2xx so callers can decide whether to degrade or surface it —
 * search degrades, indexing surfaces.
 */
const request = async (path, { method = 'GET', body, httpClient = fetch } = {}) => {
  if (!isSearchConfigured()) {
    throw new Error('MEILISEARCH_HOST is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await httpClient(`${HOST()}${path}`, {
      method,
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data?.message || `Meilisearch ${method} ${path} failed with ${response.status}`);
  }

  return data;
};

/**
 * Queries several indexes in one round trip, returning a result set per query.
 *
 * This is what makes "one search box, results grouped by type" a single request rather than six.
 */
export const multiSearch = async (queries, { httpClient = fetch } = {}) => {
  const data = await request('/multi-search', { method: 'POST', body: { queries }, httpClient });
  return data.results || [];
};

export const createIndex = async (uid, { httpClient = fetch } = {}) => {
  try {
    return await request('/indexes', { method: 'POST', body: { uid, primaryKey: 'id' }, httpClient });
  } catch (error) {
    // Already existing is the expected outcome on every run after the first.
    if (/index_already_exists|already exists/i.test(error.message)) return null;
    throw error;
  }
};

/** Sets which fields are searched, which can be filtered on, and which can be sorted. */
export const updateSettings = (uid, settings, { httpClient = fetch } = {}) =>
  request(`/indexes/${encodeURIComponent(uid)}/settings`, { method: 'PATCH', body: settings, httpClient });

export const addDocuments = (uid, documents, { httpClient = fetch } = {}) =>
  request(`/indexes/${encodeURIComponent(uid)}/documents?primaryKey=id`, {
    method: 'POST',
    body: documents,
    httpClient,
  });

export const deleteDocuments = (uid, ids, { httpClient = fetch } = {}) =>
  request(`/indexes/${encodeURIComponent(uid)}/documents/delete-batch`, {
    method: 'POST',
    body: ids,
    httpClient,
  });

export const deleteAllDocuments = (uid, { httpClient = fetch } = {}) =>
  request(`/indexes/${encodeURIComponent(uid)}/documents`, { method: 'DELETE', httpClient });

export const getStats = ({ httpClient = fetch } = {}) => request('/stats', { httpClient });

/**
 * Waits for an enqueued task to finish.
 *
 * Indexing is asynchronous: addDocuments returns a taskUid immediately and the documents become
 * searchable later. A reindex that returned before the work completed would report counts nobody
 * could yet search, so the reindex path waits and the incremental path does not.
 */
export const waitForTask = async (taskUid, { httpClient = fetch, timeoutMs = 30000 } = {}) => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const task = await request(`/tasks/${taskUid}`, { httpClient });

    if (task.status === 'succeeded') return task;
    if (task.status === 'failed' || task.status === 'canceled') {
      throw new Error(task.error?.message || `Meilisearch task ${taskUid} ${task.status}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Meilisearch task ${taskUid} did not finish within ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};
