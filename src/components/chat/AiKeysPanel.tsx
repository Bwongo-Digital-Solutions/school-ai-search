import React, { useCallback, useEffect, useState } from 'react';
import { Button, InlineLoading, InlineNotification, PasswordInput, Tag, TextInput } from '@carbon/react';
import { Password, Reset, Save } from '@carbon/react/icons';
import { CardHeader, WidgetCard } from '@/components/common';
import styles from './panels.module.scss';
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
      <div className={styles.loading}>
        <InlineLoading description={error || 'Loading AI providers…'} />
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="Whose AI account this school uses" />
        <div className={styles.section}>
          <p className={styles.blurb}>
            Your school uses the platform's AI accounts unless you enter your own here. A key you enter is
            stored encrypted, used only by this school, and never shown again — only its last four
            characters.
          </p>

          {!state.secretsConfigured && (
            <InlineNotification
              kind="warning"
              title="No encryption key on the server"
              subtitle="API keys cannot be stored until whoever runs the platform sets SECRETS_KEY. You can still set a self-hosted address below."
              lowContrast
              hideCloseButton
            />
          )}
        </div>
      </WidgetCard>

      {error && (
        <InlineNotification
          kind="error"
          title="Something went wrong"
          subtitle={error}
          onCloseButtonClick={() => setError('')}
          lowContrast
        />
      )}
      {notice && (
        <InlineNotification
          kind="success"
          title={notice}
          onCloseButtonClick={() => setNotice('')}
          lowContrast
        />
      )}

      {state.providers.map(entry => {
        const draft = draftFor(entry);
        const label = PROVIDER_LABELS[entry.provider] || entry.provider;

        return (
          <div key={entry.provider} className={styles.entry}>
            <div className={styles.entryHead}>
              <div>
                <p className={styles.entryTitle}>
                  <Password size={16} /> {label}
                </p>
                <p className={styles.entrySub}>
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
              </div>

              <Tag type={entry.source === 'school' ? 'blue' : 'cool-gray'} size="sm">
                {entry.source === 'school' ? 'This school' : 'Platform'}
              </Tag>
            </div>

            <div className={styles.entryBody}>
              {entry.keyUnreadable && (
                <p className={styles.warn}>
                  The stored key can no longer be decrypted — the server's encryption key changed. Enter
                  it again, or reset to the platform's.
                </p>
              )}

              <div className={styles.grid2}>
                {entry.needsKey && (
                  <PasswordInput
                    id={`key-${entry.provider}`}
                    labelText="API key"
                    placeholder={entry.keyPreview || 'Paste your key'}
                    value={draft.apiKey}
                    onChange={event => setDraft(entry.provider, { apiKey: event.target.value })}
                    disabled={!state.secretsConfigured}
                    autoComplete="off"
                    showPasswordLabel="Show key"
                    hidePasswordLabel="Hide key"
                  />
                )}
                <TextInput
                  id={`url-${entry.provider}`}
                  labelText={entry.needsKey ? 'Address (optional)' : 'Address'}
                  placeholder={entry.platformBaseUrl || 'https://…'}
                  value={draft.baseUrl}
                  onChange={event => setDraft(entry.provider, { baseUrl: event.target.value })}
                  autoComplete="off"
                />
              </div>

              <div className={styles.actions}>
                <Button
                  kind="primary"
                  size="sm"
                  renderIcon={Save}
                  onClick={() => save(entry)}
                  disabled={Boolean(busy) || (!draft.apiKey && !draft.baseUrl)}
                >
                  {busy === `save-${entry.provider}` ? 'Saving…' : 'Save'}
                </Button>
                {entry.source === 'school' && (
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Reset}
                    onClick={() => reset(entry)}
                    disabled={Boolean(busy)}
                  >
                    Use the platform's
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AiKeysPanel;
