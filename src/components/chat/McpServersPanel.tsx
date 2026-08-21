import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plug, PlugZap, Trash2, XCircle } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { callMcp } from '@/lib/teaching';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './fees/shared';
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
  const [servers, setServers] = useState<McpServer[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string; tools?: McpToolSummary[] } | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const result = await callMcp<{ servers: McpServer[] }>('list', {}, user);
      setServers(result.servers);
    } catch (err) {
      console.error('Failed to load MCP servers:', err);
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
      alert(`${label} failed: ${err instanceof Error ? err.message : 'Unexpected error'}`);
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
        const result = await callMcp<{ connected: boolean; tools?: McpToolSummary[]; error?: string }>(
          'test',
          { id: server.id },
          user,
        );
        setTestResult({
          id: server.id,
          ok: result.connected,
          message: result.connected ? `Connected · ${result.tools?.length ?? 0} tools` : result.error || 'Failed',
          tools: result.tools,
        });
        await load();
      }),
    [load, runAction, user],
  );

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
          <Plug className="w-4 h-4 text-indigo-500" />
          {form.id ? 'Edit MCP server' : 'Connect an MCP server'}
        </h3>
        <p className="text-[11px] text-gray-400 mb-3">
          Tools from a connected server become available to teachers in the chat composer. Only connect servers
          you trust — their tool output reaches the assistant.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label="Name"
            value={form.name}
            onChange={value => setForm({ ...form, name: String(value ?? '') })}
            placeholder="ncdc-syllabus"
          />
          <Field
            label="Server URL"
            value={form.url}
            onChange={value => setForm({ ...form, url: String(value ?? '') })}
            placeholder="https://mcp.example.org/rpc"
          />
          <Field
            label="Auth token"
            type="password"
            value={form.authToken}
            onChange={value => setForm({ ...form, authToken: String(value ?? '') })}
            hint={form.id ? 'Leave blank to keep the stored token.' : 'Sent as a bearer token. Optional.'}
          />
          <label className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={event => setForm({ ...form, enabled: event.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">Enabled</span>
          </label>
        </div>

        <div className="flex gap-2 mt-3">
          <PrimaryButton onClick={save} disabled={Boolean(busy) || !form.name.trim() || !form.url.trim()}>
            {form.id ? 'Update server' : 'Add server'}
          </PrimaryButton>
          {form.id && (
            <SecondaryButton onClick={() => setForm(emptyForm())} disabled={Boolean(busy)}>
              Cancel
            </SecondaryButton>
          )}
        </div>
      </Panel>

      <Panel>
        {servers.length === 0 ? (
          <EmptyState message="No MCP servers connected. SchoolBot's own tools work without any of these — an MCP server only adds tools from elsewhere." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {servers.map(server => (
              <div key={server.id} className={`px-4 py-3 ${zebra}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate flex items-center gap-2">
                      {server.name}
                      {!server.enabled && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500">
                          disabled
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {server.url}
                      {server.hasAuthToken ? ' · authenticated' : ' · no token'}
                      {server.discovered_tools.length > 0 && ` · ${server.discovered_tools.length} tools`}
                    </p>
                    {server.last_error && (
                      <p className="text-[11px] text-red-500 mt-0.5 flex items-center gap-1">
                        <XCircle className="w-3 h-3 shrink-0" /> {server.last_error}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <SecondaryButton onClick={() => test(server)} disabled={Boolean(busy)}>
                      <PlugZap className="w-4 h-4" /> Test
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() =>
                        setForm({ id: server.id, name: server.name, url: server.url, authToken: '', enabled: server.enabled })
                      }
                      disabled={Boolean(busy)}
                    >
                      Edit
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() => {
                        if (!window.confirm(`Disconnect “${server.name}”?`)) return;
                        runAction('Removing the MCP server', async () => {
                          await callMcp('delete', { id: server.id }, user);
                          await load();
                        });
                      }}
                      disabled={Boolean(busy)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </SecondaryButton>
                  </div>
                </div>

                {testResult?.id === server.id && (
                  <div
                    className={`mt-2 text-[11px] flex items-start gap-1.5 ${
                      testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    )}
                    <span>
                      {testResult.message}
                      {testResult.tools && testResult.tools.length > 0 && (
                        <span className="block text-gray-400">
                          {testResult.tools.map(tool => tool.remoteName).join(', ')}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

export default McpServersPanel;
