import React, { useCallback, useEffect, useState } from 'react';
import { Button, InlineNotification } from '@carbon/react';
import { Chat, Checkmark, Copy, Search } from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { callSearch } from '@/lib/teaching';
import { buildApiUrl } from '@/lib/supabase';
import { CardHeader, WidgetCard } from '@/components/common';
import styles from './panels.module.scss';
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
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="Global search" />
        <div className={styles.section}>
          {status?.configured ? (
            <p className={styles.blurb}>
              Meilisearch is connected. Staff can search everything with ⌘K.
            </p>
          ) : (
            <InlineNotification
              kind="warning"
              title="Meilisearch is not configured"
              subtitle="⌘K falls back to a basic student-name search. Set MEILISEARCH_HOST and MEILISEARCH_API_KEY to enable typo-tolerant search across students, curriculum, lesson plans, questions, fees and attendance."
              lowContrast
              hideCloseButton
            />
          )}

          <div className={styles.actions}>
            <Button
              kind="primary"
              size="md"
              renderIcon={Search}
              onClick={reindex}
              disabled={Boolean(busy) || !status?.configured}
            >
              {busy ? 'Rebuilding…' : 'Rebuild search index'}
            </Button>
          </div>

          {reindexResult && <p className={styles.blurb}>{reindexResult}</p>}

          <p className={styles.note}>
            Records are indexed as they change; rebuild after a bulk import, or if search looks out of
            date. Results are always scoped to the signed-in role — a teacher never sees fee records here.
          </p>
        </div>
      </WidgetCard>

      <WidgetCard>
        <CardHeader title="Connect LibreChat">
          <Chat size={16} className={styles.headerIcon} />
        </CardHeader>
        <div className={styles.section}>
          <p className={styles.blurb}>
            LibreChat can use this school's data as tools. Add the block below to your{' '}
            <code>librechat.yaml</code>, set <code>SCHOOLBOT_MCP_TOKEN</code> in its environment to a
            token from <code>MCP_SERVER_TOKENS</code>, and restart it. Its users can then ask about
            students, fees, the curriculum and the gradebook.
          </p>

          <div className={styles.snippet}>
            <pre className={styles.snippetBody}>{snippet}</pre>
            <Button
              className={styles.copyButton}
              kind="ghost"
              size="sm"
              renderIcon={copied ? Checkmark : Copy}
              onClick={copySnippet}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p className={styles.note}>
            Each token maps to a role, so a teacher's LibreChat sees only the tools a teacher may use.
            Issue them with <code>MCP_SERVER_TOKENS</code>, for example{' '}
            <code>{'{"tok-admin":"admin","tok-teacher":"teacher"}'}</code>. Anyone holding a token can
            read what that role can read — treat them like passwords.
          </p>
        </div>
      </WidgetCard>
    </div>
  );
};

export default LibreChatPanel;
