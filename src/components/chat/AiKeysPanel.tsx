import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, RotateCcw, Save } from 'lucide-react';
import {
  deleteProviderCredential,
  loadProviderCredentials,
  saveProviderCredential,
  type ProviderCredential,
  type ProviderCredentials,
} from '@/lib/settings';

/**
 * The school's own AI provider keys.
 *
 * One deployment serves many schools, and the provider keys are the platform's by default — so
 * every school spends the operator's budget, and a school with its own Anthropic account or its own
 * Ollama machine had no way to use it. A key set here overrides the platform's for this school
 * alone; clearing it hands the school back to the platform.
 *
 * The key is written, never read back: the server returns a masked preview and nothing else, so
 * there is no request in the app that can hand a stored key to a browser.
 */

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  google: 'Google Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (self-hosted)',
};

const inputClass =
  'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400';

const AiKeysPanel: React.FC = () => {
  const [state, setState] = useState<ProviderCredentials | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = useCallback(async (label: string, handler: () => Promise<ProviderCredentials | void>) => {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const next = await handler();
      if (next) setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void run('Loading', loadProviderCredentials);
  }, [run]);

  const draftFor = (entry: ProviderCredential) =>
    drafts[entry.provider] ?? { apiKey: '', baseUrl: entry.baseUrl };

  const setDraft = (provider: string, patch: Partial<{ apiKey: string; baseUrl: string }>) =>
    setDrafts(previous => ({
      ...previous,
      [provider]: { apiKey: '', baseUrl: '', ...previous[provider], ...patch },
    }));

  const save = (entry: ProviderCredential) => {
    const draft = draftFor(entry);
    return run(`save-${entry.provider}`, async () => {
      const next = await saveProviderCredential(entry.provider, draft.apiKey, draft.baseUrl);
      setDrafts(previous => ({ ...previous, [entry.provider]: { apiKey: '', baseUrl: draft.baseUrl } }));
      setNotice(`${PROVIDER_LABELS[entry.provider] || entry.provider} now uses this school's own settings.`);
      return next;
    });
  };

  const reset = (entry: ProviderCredential) =>
    run(`reset-${entry.provider}`, async () => {
      const next = await deleteProviderCredential(entry.provider);
      setDrafts(previous => ({ ...previous, [entry.provider]: { apiKey: '', baseUrl: '' } }));
      setNotice(`${PROVIDER_LABELS[entry.provider] || entry.provider} is back on the platform's settings.`);
      return next;
    });

  if (!state) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {error || 'Loading AI providers…'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Your school uses the platform's AI accounts unless you enter your own here. A key you enter is
          stored encrypted, used only by this school, and never shown again — only the last four characters.
        </p>
        {!state.secretsConfigured && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            The server has no encryption key configured, so API keys cannot be stored. Ask whoever runs
            the platform to set <code>SECRETS_KEY</code>. You can still set a self-hosted address below.
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      <div className="space-y-3">
        {state.providers.map(entry => {
          const draft = draftFor(entry);
          const label = PROVIDER_LABELS[entry.provider] || entry.provider;

          return (
            <div key={entry.provider} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-white flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-indigo-500" /> {label}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {entry.source === 'school' ? (
                      <>
                        Using this school's own settings
                        {entry.keyPreview && <> · key ending {entry.keyPreview.slice(-4)}</>}
                        {entry.updatedBy && <> · set by {entry.updatedBy}</>}
                      </>
                    ) : entry.needsKey ? (
                      entry.platformHasKey
                        ? "Using the platform's key"
                        : 'Not configured — enter a key to use this provider'
                    ) : (
                      `Using ${entry.platformBaseUrl || 'the platform address'}`
                    )}
                  </p>
                  {entry.keyUnreadable && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                      The stored key can no longer be decrypted — the server's encryption key changed.
                      Enter it again, or reset to the platform's.
                    </p>
                  )}
                </div>

                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                    entry.source === 'school'
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {entry.source === 'school' ? 'This school' : 'Platform'}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {entry.needsKey && (
                  <label className="block">
                    <span className="text-[11px] text-gray-600 dark:text-gray-300">API key</span>
                    <input
                      type="password"
                      value={draft.apiKey}
                      onChange={event => setDraft(entry.provider, { apiKey: event.target.value })}
                      className={inputClass}
                      placeholder={entry.keyPreview || 'Paste your key'}
                      disabled={!state.secretsConfigured}
                      autoComplete="off"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="text-[11px] text-gray-600 dark:text-gray-300">
                    Address {entry.needsKey && <span className="text-gray-400">(optional)</span>}
                  </span>
                  <input
                    type="text"
                    value={draft.baseUrl}
                    onChange={event => setDraft(entry.provider, { baseUrl: event.target.value })}
                    className={inputClass}
                    placeholder={entry.platformBaseUrl || 'https://…'}
                    autoComplete="off"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => save(entry)}
                  disabled={Boolean(busy) || (!draft.apiKey && !draft.baseUrl)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium disabled:opacity-50"
                >
                  {busy === `save-${entry.provider}` ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
                {entry.source === 'school' && (
                  <button
                    type="button"
                    onClick={() => reset(entry)}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Use the platform's
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AiKeysPanel;
