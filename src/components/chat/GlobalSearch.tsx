import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  ClipboardCheck,
  Loader2,
  NotebookPen,
  Search,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callSearch } from '@/lib/teaching';
import type { SearchGroup, SearchResponse } from '@/types/search';

/** How each result type is labelled and which view opens when it is picked. */
const GROUP_META: Record<string, { label: string; icon: React.ElementType; view: string | null }> = {
  students: { label: 'Students', icon: Users, view: 'students' },
  curriculum: { label: 'Curriculum', icon: BookMarked, view: 'lessons' },
  lesson_plans: { label: 'Lesson plans', icon: NotebookPen, view: 'lessons' },
  exam_questions: { label: 'Exam questions', icon: ClipboardCheck, view: 'examiner' },
  fees: { label: 'Fees', icon: Wallet, view: 'finance' },
  attendance: { label: 'Attendance', icon: UserCheck, view: 'records' },
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
 */
const GlobalSearch: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { setActiveView } = useChatContext();

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
    (index: string) => {
      const view = GROUP_META[index]?.view;
      if (view) setActiveView(view as never);
      setOpen(false);
      setQuery('');
    },
    [setActiveView],
  );

  const totalHits = useMemo(
    () => groups.reduce((sum, group) => sum + group.hits.length, 0),
    [groups],
  );

  if (!canSearch) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        title="Search everything (Ctrl+K)"
      >
        <Search className="w-3.5 h-3.5" />
        <span>Search…</span>
        <kbd className="ml-1 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] font-sans">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        {/* shouldFilter=false: Meilisearch has already ranked these, and re-filtering client-side
            would drop typo-tolerant matches that do not literally contain the typed text. */}
        <CommandInput
          placeholder="Search students, curriculum, lesson plans, questions…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {loading && (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          )}

          {!loading && query.trim() && totalHits === 0 && (
            <CommandEmpty>No matches for “{query.trim()}”.</CommandEmpty>
          )}

          {!loading && !query.trim() && (
            <div className="px-4 py-6 text-xs text-gray-400">
              Type to search across students, the curriculum library, lesson plans, banked questions
              {isAdmin ? ', fees' : ''} and attendance.
            </div>
          )}

          {groups.map(group => {
            const meta = GROUP_META[group.index] || { label: group.index, icon: Search, view: null };
            const Icon = meta.icon;

            return (
              <CommandGroup key={group.index} heading={`${meta.label} (${group.total})`}>
                {group.hits.map(hit => (
                  <CommandItem
                    key={`${group.index}:${hit.id}`}
                    value={`${group.index}:${hit.id}`}
                    onSelect={() => openResult(group.index)}
                    className="flex items-start gap-2"
                  >
                    <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-800 dark:text-gray-100">{hit.title}</p>
                      {hit.subtitle && <p className="truncate text-[11px] text-gray-400">{hit.subtitle}</p>}
                      {hit.snippet && (
                        <p className="line-clamp-2 text-[11px] text-gray-400">{hit.snippet}</p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}

          {notice && (
            <p className="px-4 py-3 text-[11px] text-amber-600 dark:text-amber-400 border-t border-gray-100 dark:border-gray-700">
              {notice}
            </p>
          )}

          {!notice && engine === 'meilisearch' && totalHits > 0 && (
            <p className="px-4 py-2 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-700">
              Typo-tolerant search across {groups.length} categor{groups.length === 1 ? 'y' : 'ies'}.
            </p>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
};

export default GlobalSearch;
