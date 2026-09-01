import React, { useCallback, useEffect, useState } from 'react';
import { Button, InlineLoading, InlineNotification, PasswordInput, Tag, TextInput } from '@carbon/react';
import { Application, Checkmark, Education, Plug } from '@carbon/react/icons';
import { useNotifications } from '@/contexts/NotificationContext';
import {
  disableIntegration,
  loadIntegrations,
  saveIntegration,
  testIntegration,
  type Integration,
  type IntegrationList,
} from '@/lib/integrations';
import { CardHeader, WidgetCard } from '@/components/common';
import styles from './panels.module.scss';

/**
 * The systems a school already runs, recorded so the app can reach them.
 *
 * Schools rarely arrive with nothing: a Moodle their teachers use, and often an ERP the accountant
 * reconciles in. This does not replace either. It records where they are and keeps the credentials
 * safely, so they are one click away instead of one bookmark away.
 */
const IntegrationsPanel: React.FC = () => {
  const { notify } = useNotifications();
  const [state, setState] = useState<IntegrationList | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { baseUrl: string; apiToken: string; username: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await loadIntegrations());
    } catch (err) {
      notify.error('Could not load the connected systems', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const draftFor = (entry: Integration) =>
    drafts[entry.provider] ?? { baseUrl: entry.baseUrl, apiToken: '', username: entry.username };

  const setDraft = (provider: string, patch: Partial<{ baseUrl: string; apiToken: string; username: string }>) =>
    setDrafts((previous) => ({
      ...previous,
      [provider]: { baseUrl: '', apiToken: '', username: '', ...previous[provider], ...patch },
    }));

  const run = async (label: string, work: () => Promise<IntegrationList>) => {
    setBusy(label);
    try {
      setState(await work());
    } catch (err) {
      notify.error(`${label} failed`, err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return (
      <div className={styles.loading}>
        <InlineLoading description="Loading the connected systems…" />
      </div>
    );
  }

  const section = (kind: 'elearning' | 'erp') => state.integrations.filter((entry) => entry.kind === kind);

  const card = (entry: Integration) => {
    const draft = draftFor(entry);
    return (
      <div key={entry.provider} className={styles.entry}>
        <div className={styles.entryHead}>
          <div>
            <p className={styles.entryTitle}>
              {entry.kind === 'elearning' ? <Education size={16} /> : <Application size={16} />}
              {entry.label}
            </p>
            <p className={styles.entrySub}>
              {entry.enabled && entry.baseUrl ? entry.baseUrl : 'Not connected'}
              {entry.hasToken && ` · token ending ${entry.tokenPreview.slice(-4)}`}
              {entry.updatedBy && ` · set by ${entry.updatedBy}`}
            </p>
          </div>
          <Tag type={entry.enabled && entry.baseUrl ? 'green' : 'cool-gray'} size="sm">
            {entry.enabled && entry.baseUrl ? 'Connected' : 'Off'}
          </Tag>
        </div>

        <div className={styles.entryBody}>
          {entry.tokenUnreadable && (
            <p className={styles.warn}>
              The stored token can no longer be decrypted — the server's encryption key changed.
              Enter it again.
            </p>
          )}
          {entry.lastError && !entry.tokenUnreadable && (
            <p className={styles.warn}>Last check: {entry.lastError}</p>
          )}

          <div className={styles.grid2}>
            <TextInput
              id={`url-${entry.provider}`}
              labelText="Address"
              placeholder={`https://${entry.provider}.school.ac.ug`}
              value={draft.baseUrl}
              onChange={(event) => setDraft(entry.provider, { baseUrl: event.target.value })}
            />
            <PasswordInput
              id={`token-${entry.provider}`}
              labelText="API token (optional)"
              placeholder={entry.hasToken ? entry.tokenPreview : 'Leave blank if not needed'}
              helperText={entry.hasToken ? 'Leave blank to keep the stored token.' : undefined}
              value={draft.apiToken}
              onChange={(event) => setDraft(entry.provider, { apiToken: event.target.value })}
              disabled={!state.secretsConfigured}
              showPasswordLabel="Show token"
              hidePasswordLabel="Hide token"
            />
          </div>

          <div className={styles.actions}>
            <Button
              kind="primary"
              size="sm"
              renderIcon={Checkmark}
              disabled={Boolean(busy) || !draft.baseUrl.trim()}
              onClick={() =>
                run('Saving', () =>
                  saveIntegration({
                    provider: entry.provider,
                    baseUrl: draft.baseUrl,
                    username: draft.username,
                    // Omitted entirely when untouched, so saving the address never blanks a token.
                    ...(draft.apiToken ? { apiToken: draft.apiToken } : {}),
                    enabled: true,
                  }),
                )
              }
            >
              {entry.enabled && entry.baseUrl ? 'Save' : 'Connect'}
            </Button>

            {entry.baseUrl && (
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Plug}
                disabled={Boolean(busy)}
                onClick={async () => {
                  setBusy('Testing');
                  try {
                    const result = await testIntegration(entry.provider);
                    setState(result);
                    if (result.connected) notify.success(`${entry.label} answered`);
                    else notify.warning(`${entry.label} did not answer`, result.connectionError);
                  } catch (err) {
                    notify.error('Test failed', err instanceof Error ? err.message : undefined);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Test
              </Button>
            )}

            {entry.enabled && entry.baseUrl && (
              <Button
                kind="danger--ghost"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => run('Disconnecting', () => disableIntegration(entry.provider))}
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.stack}>
      {!state.secretsConfigured && (
        <InlineNotification
          kind="warning"
          title="No encryption key on the server"
          subtitle="API tokens cannot be stored until whoever runs the platform sets SECRETS_KEY. An address can still be saved without one."
          lowContrast
          hideCloseButton
        />
      )}

      <WidgetCard>
        <CardHeader title="E-Learning" />
        <div className={styles.section}>
          <p className={styles.blurb}>
            Your school's Moodle. Once connected it appears in the side menu and opens inside the
            app, so teachers move between the two without signing in twice as often.
          </p>
        </div>
        {section('elearning').map(card)}
      </WidgetCard>

      <WidgetCard>
        <CardHeader title="ERP" />
        <div className={styles.section}>
          <p className={styles.blurb}>
            One business system at a time — connecting a second stands the first down, so the menu
            never offers two and leaves you to guess which is real.
          </p>
        </div>
        {section('erp').map(card)}
      </WidgetCard>
    </div>
  );
};

export default IntegrationsPanel;
