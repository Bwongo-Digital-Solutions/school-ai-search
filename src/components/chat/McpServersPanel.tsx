import React, { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, InlineNotification, Tag } from '@carbon/react';
import { Plug, TrashCan } from '@carbon/react/icons';
import { CardHeader, EmptyState, ErrorState, Field, ListSkeleton, WidgetCard } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callMcp } from '@/lib/teaching';
import styles from './panels.module.scss';
import type { McpServer, McpToolSummary } from '@/types/agent';

const emptyForm = () => ({ id: '', name: '', url: '', authToken: '', enabled: true });

/**
 * Registers the external MCP servers this school's assistant may draw tools from.
 *
 * Admin-only: connecting an MCP server hands a third party a tool surface inside the assistant, and
 * that is an administrator's decision. Teachers then pick which of the registered servers to bring
 * into a given chat message.
 *
 * The auth token is write-only. Reads come back masked, and leaving the field untouched when
 * editing keeps whatever is stored — so changing a URL never silently blanks its credential.
 */
const McpServersPanel: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { confirm, notify } = useNotifications();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string; tools?: McpToolSummary[] } | null>(null);

  const load = useCallback(async () => {
    // Nothing will ever be asked for, so nothing is pending. Without this the panel would sit on a
    // skeleton for a reader who is simply not allowed to see the list.
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await callMcp<{ servers: McpServer[] }>('list', {}, user);
      setServers(result.servers);
      setError(null);
    } catch (err) {
      console.error('Failed to load MCP servers:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = useCallback(async (label: string, handler: () => Promise<void>) => {
    setBusy(label);
    try {
      await handler();
    } catch (err: unknown) {
      notify.error(`${label} failed`, err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(null);
    }
  }, []);

  const save = useCallback(
    () =>
      runAction('Saving the MCP server', async () => {
        // An omitted authToken means "keep the stored one"; only send it when the admin typed
        // something, so editing a URL cannot wipe the credential.
        const payload: Record<string, unknown> = {
          id: form.id || undefined,
          name: form.name,
          url: form.url,
          enabled: form.enabled,
        };
        if (form.authToken) payload.authToken = form.authToken;

        await callMcp('save', payload, user);
        setForm(emptyForm());
        await load();
      }),
    [form, load, runAction, user],
  );

  const test = useCallback(
    (server: McpServer) =>
      runAction(`Connecting to ${server.name}`, async () => {
        const result = await callMcp<{ connected: boolean; tools?: McpToolSummary[]; connectionError?: string }>(
          'test',
          { id: server.id },
          user,
        );
        setTestResult({
          id: server.id,
          ok: result.connected,
          message: result.connected
            ? `Connected · ${result.tools?.length ?? 0} tools`
            : result.connectionError || 'Could not connect',
          tools: result.tools,
        });
        await load();
      }),
    [load, runAction, user],
  );

  if (!isAdmin) return null;

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title={form.id ? 'Edit MCP server' : 'Connect an MCP server'} />
        <div className={styles.section}>
          <p className={styles.note}>
            Tools from a connected server become available to teachers in the chat composer. Only
            connect servers you trust — their tool output reaches the assistant.
          </p>

          <div className={styles.grid2}>
            <Field
              label="Name"
              value={form.name}
              onChange={value => setForm({ ...form, name: value })}
              placeholder="ncdc-syllabus"
            />
            <Field
              label="Server URL"
              value={form.url}
              onChange={value => setForm({ ...form, url: value })}
              placeholder="https://mcp.example.org/rpc"
            />
            <Field
              label="Auth token"
              type="password"
              value={form.authToken}
              onChange={value => setForm({ ...form, authToken: value })}
              hint={form.id ? 'Leave blank to keep the stored token.' : 'Sent as a bearer token. Optional.'}
            />
            <Checkbox
              id="mcp-enabled"
              labelText="Enabled"
              checked={form.enabled}
              onChange={(_event, { checked }) => setForm({ ...form, enabled: checked })}
            />
          </div>

          <div className={styles.actions}>
            <Button
              kind="primary"
              size="sm"
              onClick={save}
              disabled={Boolean(busy) || !form.name.trim() || !form.url.trim()}
            >
              {form.id ? 'Update server' : 'Add server'}
            </Button>
            {form.id && (
              <Button kind="tertiary" size="sm" onClick={() => setForm(emptyForm())} disabled={Boolean(busy)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </WidgetCard>

      <WidgetCard>
        <CardHeader title="Connected servers">
          <Tag type="cool-gray" size="sm">{servers.length}</Tag>
        </CardHeader>
        {loading && servers.length === 0 ? (
          <ListSkeleton rowCount={3} />
        ) : error ? (
          <ErrorState headerTitle="MCP servers" error={error} onRetry={load} />
        ) : servers.length === 0 ? (
          <EmptyState
            headerTitle="MCP servers"
            displayText="connected servers"
            helperText="SchoolBot's own tools work without any of these — an MCP server only adds tools from elsewhere."
          />
        ) : (
          servers.map(server => (
            <div key={server.id} className={styles.serverRow}>
              <div className={styles.entryHead}>
                <div>
                  <p className={styles.entryTitle}>
                    {server.name}
                    {!server.enabled && (
                      <Tag type="cool-gray" size="sm">
                        Disabled
                      </Tag>
                    )}
                  </p>
                  <p className={styles.entrySub}>
                    {server.url}
                    {server.hasAuthToken ? ' · authenticated' : ' · no token'}
                    {server.discovered_tools.length > 0 && ` · ${server.discovered_tools.length} tools`}
                  </p>
                  {server.last_error && <p className={styles.failure}>{server.last_error}</p>}
                </div>

                <div className={styles.actions}>
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Plug}
                    onClick={() => test(server)}
                    disabled={Boolean(busy)}
                  >
                    Test
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() =>
                      setForm({
                        id: server.id,
                        name: server.name,
                        url: server.url,
                        authToken: '',
                        enabled: server.enabled,
                      })
                    }
                    disabled={Boolean(busy)}
                  >
                    Edit
                  </Button>
                  <Button
                    hasIconOnly
                    kind="danger--ghost"
                    size="sm"
                    renderIcon={TrashCan}
                    iconDescription={`Disconnect ${server.name}`}
                    tooltipPosition="left"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Disconnect this server?',
                          message: `“${server.name}” will stop providing tools to the assistant. Nothing else changes, and you can connect it again.`,
                          confirmLabel: 'Disconnect',
                          danger: true,
                        }))
                      ) {
                        return;
                      }
                      runAction('Removing the MCP server', async () => {
                        await callMcp('delete', { id: server.id }, user);
                        await load();
                      });
                    }}
                  />
                </div>
              </div>

              {testResult?.id === server.id && (
                <div className={styles.entryBody}>
                  <InlineNotification
                    kind={testResult.ok ? 'success' : 'error'}
                    title={testResult.message}
                    subtitle={
                      testResult.tools && testResult.tools.length > 0
                        ? testResult.tools.map(tool => tool.remoteName).join(', ')
                        : undefined
                    }
                    lowContrast
                    hideCloseButton
                  />
                </div>
              )}
            </div>
          ))
        )}
      </WidgetCard>
    </div>
  );
};

export default McpServersPanel;
