import React, { useCallback, useState } from 'react';
import {
  Button,
  InlineNotification,
  PasswordInput,
  Select,
  SelectItem,
  Tag,
  TextInput,
} from '@carbon/react';
import { Add, Building, Renew, Security } from '@carbon/react/icons';
import { callProvision, type PlatformTenant } from '@/lib/provision';
import { CardHeader, WidgetCard } from '@/components/common';
import styles from './public-pages.module.scss';

/**
 * The platform operator's console: every school on eschool.ink, and the few actions that act on the
 * platform rather than inside one school.
 *
 * Authentication is the PLATFORM_OWNER_TOKEN set on the server, pasted here and held in React state
 * only — not in localStorage, where any script on the page could read it, and not in a cookie. Close
 * the tab and it is gone. That is a deliberate trade: this is an operator tool used occasionally,
 * and a credential that outlives the tab is a credential that can be stolen from it.
 *
 * Nothing here is reachable without that token: the server refuses every one of these actions
 * outright when it is absent, so this page is a form over a locked door rather than the lock.
 */

/** A school's subscription state, as a Carbon tag colour. */
const STATUS_TAGS: Record<string, 'green' | 'cyan' | 'magenta' | 'red'> = {
  active: 'green',
  pending: 'cyan',
  past_due: 'magenta',
  suspended: 'red',
};

const STATUSES = ['active', 'past_due', 'suspended', 'pending'] as const;

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const PlatformOwner: React.FC = () => {
  const [token, setToken] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ subdomain: '', schoolName: '', contactEmail: '' });

  const run = useCallback(
    async (label: string, handler: () => Promise<string | void>) => {
      setBusy(label);
      setError('');
      setNotice('');
      try {
        const message = await handler();
        if (message) setNotice(message);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const load = useCallback(
    (candidate: string) =>
      run('Loading schools', async () => {
        const data = await callProvision<{ tenants: PlatformTenant[] }>('list', {}, candidate);
        setTenants(data.tenants || []);
        setUnlocked(true);
      }),
    [run],
  );

  const create = useCallback(
    () =>
      run('Creating the school', async () => {
        const data = await callProvision<{ tenant: PlatformTenant }>('create', form, token);
        setForm({ subdomain: '', schoolName: '', contactEmail: '' });
        const list = await callProvision<{ tenants: PlatformTenant[] }>('list', {}, token);
        setTenants(list.tenants || []);
        return `${data.tenant.subdomain} is live. Open it and create the first (administrator) account.`;
      }),
    [form, run, token],
  );

  const setStatus = useCallback(
    (subdomain: string, status: string) =>
      run('Updating the school', async () => {
        await callProvision('set_status', { subdomain, status }, token);
        const list = await callProvision<{ tenants: PlatformTenant[] }>('list', {}, token);
        setTenants(list.tenants || []);
        return `${subdomain} is now ${status.replace('_', ' ')}.`;
      }),
    [run, token],
  );

  const sweep = useCallback(
    () =>
      run('Running the sweep', async () => {
        const data = await callProvision<{ checked: number; pastDue: number; suspended: number }>('sweep', {}, token);
        const list = await callProvision<{ tenants: PlatformTenant[] }>('list', {}, token);
        setTenants(list.tenants || []);
        return `Checked ${data.checked}: ${data.pastDue} moved to past due, ${data.suspended} suspended.`;
      }),
    [run, token],
  );

  if (!unlocked) {
    return (
      <div className={styles.page}>
        <div className={styles.centred}>
          <div className={`${styles.card} ${styles.cardNarrow}`}>
            <form
              className={styles.section}
              onSubmit={event => {
                event.preventDefault();
                if (token.trim()) load(token.trim());
              }}
            >
              <h1 className={styles.consoleTitle}>
                <Security size={20} /> Platform administration
              </h1>

              <PasswordInput
                id="owner-token"
                labelText="Operator token"
                placeholder="PLATFORM_OWNER_TOKEN"
                value={token}
                onChange={event => setToken(event.target.value)}
                showPasswordLabel="Show token"
                hidePasswordLabel="Hide token"
                autoFocus
              />

              {error && (
                <InlineNotification
                  kind="error"
                  title="Could not sign in"
                  subtitle={error}
                  onCloseButtonClick={() => setError('')}
                  lowContrast
                />
              )}

              <Button
                kind="primary"
                type="submit"
                renderIcon={Security}
                disabled={!token.trim() || Boolean(busy)}
              >
                Continue
              </Button>

              <p className={styles.note}>
                The token is the one set as <code>PLATFORM_OWNER_TOKEN</code> on the server. It is kept
                in this tab only and is gone when you close it.
              </p>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.console}>
      <div className={styles.consoleInner}>
        <div className={styles.consoleHead}>
          <h1 className={styles.consoleTitle}>
            <Security size={20} /> Schools on the platform
            <Tag type="cool-gray" size="sm">
              {tenants.length}
            </Tag>
          </h1>

          <div className={styles.tenantActions}>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Renew}
              onClick={() => load(token)}
              disabled={Boolean(busy)}
            >
              Refresh
            </Button>
            <Button
              kind="tertiary"
              size="sm"
              onClick={sweep}
              disabled={Boolean(busy)}
              title="Move lapsed subscriptions to past due, and past due beyond the grace window to suspended"
            >
              Run subscription sweep
            </Button>
          </div>
        </div>

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

        <WidgetCard>
          <CardHeader title="Schools" />
          {tenants.length === 0 ? (
            <p className={`${styles.note} ${styles.section}`}>
              No schools yet. Create the first one below.
            </p>
          ) : (
            tenants.map(tenant => (
              <div key={tenant.id} className={styles.tenantRow}>
                <div>
                  <p className={styles.tenantName}>{tenant.school_name || tenant.subdomain}</p>
                  <p className={styles.tenantMeta}>
                    {tenant.subdomain} · {tenant.contact_email || 'no contact email'} · paid to{' '}
                    {formatDate(tenant.current_period_end)}
                  </p>
                </div>

                <div className={styles.tenantActions}>
                  <Tag type={STATUS_TAGS[tenant.status] ?? 'cool-gray'} size="sm">
                    {tenant.status.replace('_', ' ')}
                  </Tag>
                  <Select
                    id={`status-${tenant.id}`}
                    className={styles.statusPicker}
                    labelText="Status"
                    hideLabel
                    size="sm"
                    value={tenant.status}
                    disabled={Boolean(busy)}
                    onChange={event => setStatus(tenant.subdomain, event.target.value)}
                  >
                    {STATUSES.map(status => (
                      <SelectItem key={status} value={status} text={status.replace('_', ' ')} />
                    ))}
                  </Select>
                </div>
              </div>
            ))
          )}
        </WidgetCard>

        <WidgetCard>
          <CardHeader title="Add a school">
            <Building size={16} />
          </CardHeader>
          <div className={styles.section}>
            <div className={styles.grid3}>
              <TextInput
                id="new-subdomain"
                labelText="Subdomain"
                placeholder="kampala-high"
                value={form.subdomain}
                onChange={event => setForm({ ...form, subdomain: event.target.value })}
              />
              <TextInput
                id="new-name"
                labelText="School name"
                placeholder="Kampala High School"
                value={form.schoolName}
                onChange={event => setForm({ ...form, schoolName: event.target.value })}
              />
              <TextInput
                id="new-email"
                type="email"
                labelText="Contact email"
                placeholder="head@school.ac.ug"
                value={form.contactEmail}
                onChange={event => setForm({ ...form, contactEmail: event.target.value })}
              />
            </div>

            <div>
              <Button
                kind="primary"
                renderIcon={Add}
                onClick={create}
                disabled={!form.subdomain.trim() || Boolean(busy)}
              >
                {busy === 'Creating the school' ? 'Creating…' : 'Create and activate'}
              </Button>
            </div>

            <p className={styles.note}>
              Creates the school's database and starts a subscription period, without taking a payment.
              The first account created at the school's own address becomes its administrator.
            </p>
          </div>
        </WidgetCard>
      </div>
    </div>
  );
};

export default PlatformOwner;
