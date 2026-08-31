/** One result from the global search, already shaped for display by the backend. */
export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  raw?: Record<string, unknown>;
}

/** Results for one index, e.g. all matching students. */
export interface SearchGroup {
  index: string;
  total: number;
  processingTimeMs?: number;
  hits: SearchHit[];
}

export interface SearchResponse {
  /** Which engine answered — 'meilisearch', or 'postgres' when it is unconfigured or unreachable. */
  engine: 'meilisearch' | 'postgres';
  groups: SearchGroup[];
  /** Set when the results are degraded, explaining why rather than silently returning less. */
  notice?: string;
}

export interface SearchStatus {
  configured: boolean;
  engine: string;
  /** The indexes this role may query. Scoped server-side; support staff get none. */
  indexes: string[];
}
