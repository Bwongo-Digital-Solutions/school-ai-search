import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, MessagesSquare, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callSearch } from '@/lib/teaching';
import { buildApiUrl } from '@/lib/supabase';
import { Panel, PrimaryButton } from './fees/shared';
import type { SearchStatus } from '@/types/search';

/**
 * Connecting LibreChat to this school's data, and rebuilding the search index.
 *
 * LibreChat consumes AI providers rather than exposing one, so it cannot be an entry in the model
 * picker. What it does support is MCP servers over streamable HTTP — which is exactly what this
 * deployment already serves at /api/mcp. So the connection runs the other way: LibreChat reaches
 * into SchoolBot, and its users get student records, fees, curriculum and the gradebook as tools.
 */
const LibreChatPanel: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reindexResult, setReindexResult] = useState<string>('');

  // Absolute, because the snippet is pasted into a LibreChat instance elsewhere — a relative path
  // would be meaningless there.
  const mcpUrl = new URL(buildApiUrl('/api/mcp'), window.location.origin).toString();

  const snippet = [
    'mcpServers:',
    '  schoolbot:',
    '    type: streamable-http',
    `    url: ${mcpUrl}`,
    '    headers:',
    "      Authorization: 'Bearer ${SCHOOLBOT_MCP_TOKEN}'",
    '    timeout: 30000',
  ].join('\n');

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await callSearch<SearchStatus>('status', {}, user));
    } catch {
      setStatus(null);
    }
  }, [user]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked outside a secure context; the snippet is on screen to copy by hand.
    }
  };

  const reindex = async () => {
    setBusy('Rebuilding the search index');
    setReindexResult('');
    try {
      const result = await callSearch<{ counts: Record<string, number>; total: number }>(
        'reindex',
        {},
        user,
      );
      setReindexResult(
        `Indexed ${result.total} records — ${Object.entries(result.counts)
          .map(([name, count]) => `${name}: ${count}`)
          .join(', ')}`,
      );
      await loadStatus();
    } catch (err) {
      setReindexResult(err instanceof Error ? err.message : 'Reindex failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
          <Search className="w-4 h-4 text-indigo-500" /> Global search
        </h3>

        {status?.configured ? (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-3">
            Meilisearch is connected. Staff can search everything with ⌘K.
          </p>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-3 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            Meilisearch is not configured, so ⌘K falls back to a basic student-name search. Set
            <code className="mx-1">MEILISEARCH_HOST</code> and <code className="mx-1">MEILISEARCH_API_KEY</code>
            to enable typo-tolerant search across students, curriculum, lesson plans, questions, fees and
            attendance.
          </p>
        )}

        <PrimaryButton onClick={reindex} disabled={Boolean(busy) || !status?.configured}>
          {busy ? 'Rebuilding…' : 'Rebuild search index'}
        </PrimaryButton>

        {reindexResult && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">{reindexResult}</p>
        )}
        <p className="text-[11px] text-gray-400 mt-2">
          Records are indexed as they change; rebuild after a bulk import, or if search looks out of date.
          Results are always scoped to the signed-in role — a teacher never sees fee records here.
        </p>
      </Panel>

      <Panel className="p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
          <MessagesSquare className="w-4 h-4 text-indigo-500" /> Connect LibreChat
        </h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          LibreChat can use this school's data as tools. Add the block below to your{' '}
          <code>librechat.yaml</code>, set <code>SCHOOLBOT_MCP_TOKEN</code> in its environment to a token
          from <code>MCP_SERVER_TOKENS</code>, and restart it. Its users can then ask about students, fees,
          the curriculum and the gradebook.
        </p>

        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 p-3 text-[11px] text-gray-700 dark:text-gray-300">
            {snippet}
          </pre>
          <button
            onClick={copySnippet}
            className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <p className="text-[11px] text-gray-400 mt-2">
          Each token maps to a role, so a teacher's LibreChat sees only the tools a teacher may use. Issue
          them with <code>MCP_SERVER_TOKENS</code>, for example{' '}
          <code>{'{"tok-admin":"admin","tok-teacher":"teacher"}'}</code>. Anyone holding a token can read
          what that role can read — treat them like passwords.
        </p>
      </Panel>
    </div>
  );
};

export default LibreChatPanel;
