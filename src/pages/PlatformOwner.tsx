import React, { useCallback, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { callProvision, type PlatformTenant } from '@/lib/provision';

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

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  pending: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  past_due: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800',
  suspended: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
};

const STATUSES = ['active', 'past_due', 'suspended', 'pending'] as const;

const inputClass =
  'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400';

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="w-6 h-6 text-indigo-500" />
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white">Platform administration</h1>
          </div>

          <form
            onSubmit={event => {
              event.preventDefault();
              if (token.trim()) load(token.trim());
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5 mb-1">
                <KeyRound className="w-3.5 h-3.5" /> Operator token
              </span>
              <input
                type="password"
                value={token}
                onChange={event => setToken(event.target.value)}
                className={inputClass}
                placeholder="PLATFORM_OWNER_TOKEN"
                autoFocus
              />
            </label>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!token.trim() || Boolean(busy)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Continue
            </button>

            <p className="text-[11px] text-gray-500 dark:text-gray-400 pt-1">
              The token is the one set as <code>PLATFORM_OWNER_TOKEN</code> on the server. It is kept in this tab
              only and is gone when you close it.
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-500" />
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white">
              Schools on the platform
              <span className="ml-2 text-sm font-normal text-gray-500">{tenants.length}</span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load(token)}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'Loading schools' ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={sweep}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 disabled:opacity-50"
              title="Move lapsed subscriptions to past due, and past due beyond the grace window to suspended"
            >
              Run subscription sweep
            </button>
          </div>
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

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
          {tenants.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400 text-center">
              No schools yet. Create the first one below.
            </p>
          ) : (
            tenants.map(tenant => (
              <div key={tenant.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                    {tenant.school_name || tenant.subdomain}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {tenant.subdomain} · {tenant.contact_email || 'no contact email'} · paid to{' '}
                    {formatDate(tenant.current_period_end)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      STATUS_STYLES[tenant.status] || STATUS_STYLES.pending
                    }`}
                  >
                    {tenant.status.replace('_', ' ')}
                  </span>
                  <select
                    value={tenant.status}
                    onChange={event => setStatus(tenant.subdomain, event.target.value)}
                    disabled={Boolean(busy)}
                    className="text-[11px] bg-transparent border border-gray-200 dark:border-gray-600 rounded-md px-1.5 py-1 text-gray-600 dark:text-gray-300"
                  >
                    {STATUSES.map(status => (
                      <option key={status} value={status}>
                        {status.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-indigo-500" /> Add a school
          </h2>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-[11px] text-gray-600 dark:text-gray-300">Subdomain</span>
              <input
                value={form.subdomain}
                onChange={event => setForm({ ...form, subdomain: event.target.value })}
                className={inputClass}
                placeholder="kampala-high"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-gray-600 dark:text-gray-300">School name</span>
              <input
                value={form.schoolName}
                onChange={event => setForm({ ...form, schoolName: event.target.value })}
                className={inputClass}
                placeholder="Kampala High School"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-gray-600 dark:text-gray-300">Contact email</span>
              <input
                value={form.contactEmail}
                onChange={event => setForm({ ...form, contactEmail: event.target.value })}
                className={inputClass}
                placeholder="head@school.ac.ug"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={create}
            disabled={!form.subdomain.trim() || Boolean(busy)}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy === 'Creating the school' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create and activate
          </button>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
            Creates the school's database and starts a subscription period, without taking a payment. The first
            account created at the school's own address becomes its administrator.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PlatformOwner;
