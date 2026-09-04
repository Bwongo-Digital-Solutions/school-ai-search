import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineLoading, Modal, Search as CarbonSearch } from '@carbon/react';
import {
  Book,
  Money,
  Notebook,
  Search,
  TaskComplete,
  UserFollow,
  UserMultiple,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callSearch } from '@/lib/teaching';
import type { SearchGroup, SearchHit, SearchResponse } from '@/types/search';
import styles from './global-search.module.scss';

/**
 * How each result type is labelled, which screen opens it, and how to find the record there.
 *
 * `studentIdFrom` is what turns "switch to the fees screen" into "open this student's ledger".
 * A fee or attendance document carries the student it belongs to; a student result is the student.
 * Curriculum, lesson plans and questions have no per-record destination yet, so they open their
 * screen — which is still where the answer is.
 */
const GROUP_META: Record<
  string,
  {
    label: string;
    icon: React.ElementType;
    view: string | null;
    studentIdFrom?: (hit: SearchHit) => string | undefined;
  }
> = {
  students: {
    label: 'Students',
    icon: UserMultiple,
    // The student's own file, not the roster filtered down to one row. Opening a search result
    // should answer the question that prompted the search, not leave it one more click away.
    view: 'student',
    studentIdFrom: (hit) => hit.id,
  },
  curriculum: { label: 'Curriculum', icon: Book, view: 'lessons' },
  lesson_plans: { label: 'Lesson plans', icon: Notebook, view: 'lessons' },
  exam_questions: { label: 'Exam questions', icon: TaskComplete, view: 'examiner' },
  fees: {
    label: 'Fees',
    icon: Money,
    view: 'finance',
    studentIdFrom: (hit) => hit.raw?.student_id as string | undefined,
  },
  attendance: {
    label: 'Attendance',
    icon: UserFollow,
    view: 'records',
    studentIdFrom: (hit) => hit.raw?.student_id as string | undefined,
  },
};

// Long enough that a normal typist does not fire a request per keystroke, short enough to still
// feel instant — Meilisearch itself answers in single-digit milliseconds.
const DEBOUNCE_MS = 180;

/**
 * Global search across students, curriculum, lesson plans, questions, fees and attendance.
 *
 * Opens on ⌘K / Ctrl-K. Every query goes through the backend, which is the only place the signed-in
 * role is known — results are scoped to what that role may see, so a teacher never sees fee records
 * here even though they are indexed.
 *
 * Built from Carbon's Modal and Search rather than a command-palette library: the results are
 * already ranked by Meilisearch, so the only thing a palette component would add is client-side
 * re-filtering, which would drop the typo-tolerant matches that are the point of using it.
 */
const GlobalSearch: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { openRecord } = useChatContext();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [engine, setEngine] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Guards against a slow early request landing after a faster later one and overwriting it.
  const requestRef = useRef(0);

  const canSearch = isAdmin || user?.role === 'teacher';

  useEffect(() => {
    if (!canSearch) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(previous => !previous);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSearch]);

  useEffect(() => {
    if (!open) return undefined;

    const text = query.trim();
    if (!text) {
      setGroups([]);
      setNotice('');
      return undefined;
    }

    const token = ++requestRef.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const result = await callSearch<SearchResponse>('query', { query: text }, user);
        // Ignore a response that a newer keystroke has already superseded.
        if (token !== requestRef.current) return;
        setGroups(result.groups || []);
        setEngine(result.engine || '');
        setNotice(result.notice || '');
      } catch (err) {
        if (token !== requestRef.current) return;
        setGroups([]);
        setNotice(err instanceof Error ? err.message : 'Search failed.');
      } finally {
        if (token === requestRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [open, query, user]);

  const openResult = useCallback(
    (index: string, hit: SearchHit) => {
      const meta = GROUP_META[index];
      if (!meta?.view) return;
      openRecord({
        view: meta.view as never,
        studentId: meta.studentIdFrom?.(hit),
        query: hit.title,
      });
      setOpen(false);
      setQuery('');
    },
    [openRecord],
  );

  const totalHits = useMemo(
    () => groups.reduce((sum, group) => sum + group.hits.length, 0),
    [groups],
  );

  if (!canSearch) return null;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        title="Search everything (Ctrl+K)"
      >
        <Search size={16} />
        <span>Search…</span>
        <kbd className={styles.shortcut}>⌘K</kbd>
      </button>

      {open && (
        <Modal
          open
          passiveModal
          className={styles.modal}
          modalHeading="Search"
          onRequestClose={() => setOpen(false)}
          size="md"
        >
          <div className={styles.searchRow}>
            <CarbonSearch
              id="global-search"
              autoFocus
              size="lg"
              labelText="Search everything"
              placeholder="Students, curriculum, lesson plans, questions…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
            />
          </div>

          <div className={styles.results}>
            {loading && (
              <div className={styles.message}>
                <InlineLoading description="Searching…" />
              </div>
            )}

            {!loading && !query.trim() && (
              <p className={styles.message}>
                Type to search across students, the curriculum library, lesson plans, banked
                questions{isAdmin ? ', fees' : ''} and attendance.
              </p>
            )}

            {!loading && query.trim() && totalHits === 0 && (
              <p className={styles.message}>No matches for “{query.trim()}”.</p>
            )}

            {!loading &&
              groups.map((group) => {
                const meta = GROUP_META[group.index] || {
                  label: group.index,
                  icon: Search,
                  view: null,
                };
                const Icon = meta.icon;

                return (
                  <div key={group.index}>
                    <p className={styles.groupHeading}>
                      {meta.label} ({group.total})
                    </p>
                    {group.hits.map((hit) => (
                      <button
                        key={`${group.index}:${hit.id}`}
                        type="button"
                        className={styles.hit}
                        onClick={() => openResult(group.index, hit)}
                      >
                        <Icon size={16} />
                        <span className={styles.hitText}>
                          <span className={styles.hitTitle}>{hit.title}</span>
                          {hit.subtitle && <span className={styles.hitSub}>{hit.subtitle}</span>}
                          {hit.snippet && <span className={styles.hitSnippet}>{hit.snippet}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}

            {notice && <p className={`${styles.foot} ${styles.footWarning}`}>{notice}</p>}

            {!notice && engine === 'meilisearch' && totalHits > 0 && (
              <p className={styles.foot}>
                Typo-tolerant search across {groups.length} categor
                {groups.length === 1 ? 'y' : 'ies'}.
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default GlobalSearch;
