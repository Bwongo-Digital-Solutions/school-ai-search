import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, GraduationCap, Loader2, Phone, Landmark as Bank, Building2 } from 'lucide-react';
import { callProvision, type AvailabilityResult, type SignupResult, type TenantStatus } from '@/lib/provision';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/**
 * The root domain schools get a subdomain under.
 *
 * VITE_TENANT_ROOT_DOMAIN is a build-time substitution, so a value baked into an old bundle would
 * go on advertising the wrong domain long after the deployment moved. The browser's own hostname is
 * the more trustworthy source, so it is used whenever the page is served from a real domain, and
 * the build-time value only fills in for localhost.
 */
const rootDomainFromHost = () => {
  if (typeof window === 'undefined') return '';

  const hostname = window.location.hostname;
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return '';

  const parts = hostname.split('.');
  // apply.eschool.ink -> eschool.ink; eschool.ink -> eschool.ink.
  return parts.length > 2 ? parts.slice(1).join('.') : hostname;
};

const ROOT_DOMAIN =
  rootDomainFromHost() || (import.meta.env.VITE_TENANT_ROOT_DOMAIN as string) || 'eschool.ink';

const PROVIDERS = [
  { value: 'mtn_momo', label: 'MTN MoMo', icon: Phone },
  { value: 'airtel_money', label: 'Airtel Money', icon: Phone },
  { value: 'bank', label: 'Bank', icon: Bank },
];

type Stage = 'form' | 'pending' | 'active';

const inputClass =
  'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400';

const TenantSignup: React.FC = () => {
  const [stage, setStage] = useState<Stage>('form');
  const [schoolName, setSchoolName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [provider, setProvider] = useState('mtn_momo');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [signup, setSignup] = useState<SignupResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Live subdomain availability, debounced.
  useEffect(() => {
    setAvailability(null);
    const value = subdomain.trim().toLowerCase();
    if (value.length < 3) return;
    setChecking(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setAvailability(await callProvision<AvailabilityResult>('availability', { subdomain: value }));
      } catch (err) {
        setAvailability({ available: false, reason: err instanceof Error ? err.message : 'Could not check' });
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [subdomain]);

  const fullHost = useMemo(() => `${subdomain.trim().toLowerCase() || 'your-school'}.${ROOT_DOMAIN}`, [subdomain]);

  const canSubmit =
    schoolName.trim() &&
    availability?.available &&
    contactEmail.trim() &&
    (provider === 'bank' ? bankCode.trim() : phoneNumber.trim());

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const result = await callProvision<SignupResult>('signup', {
        subdomain: subdomain.trim().toLowerCase(),
        schoolName: schoolName.trim(),
        contactEmail: contactEmail.trim(),
        provider,
        phoneNumber: phoneNumber.trim() || undefined,
        bankCode: bankCode.trim() || undefined,
      });
      setSignup(result);
      setStage('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Poll the tenant status while the payment is pending; flip to active when it lands.
  const poll = useCallback(async () => {
    if (!signup) return;
    try {
      const { tenant } = await callProvision<TenantStatus>('status', { subdomain: signup.subdomain });
      if (tenant?.status === 'active') setStage('active');
    } catch {
      // keep polling
    }
  }, [signup]);

  useEffect(() => {
    if (stage !== 'pending') return;
    const timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, [stage, poll]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-indigo-50 to-white dark:from-gray-900 dark:to-gray-950">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-2 justify-center mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-800 dark:text-white">e-School</span>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            {stage === 'form' && (
              <div className="p-6 space-y-4">
                <div>
                  <h1 className="text-lg font-bold text-gray-800 dark:text-white">Start your school</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Create your school's private, subscription-based space.</p>
                </div>

                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">School name</span>
                  <input value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder="Kampala High School" className={inputClass} />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Choose your web address</span>
                  <div className="flex items-center gap-1">
                    <input
                      value={subdomain}
                      onChange={e => setSubdomain(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
                      placeholder="kampala-high"
                      className={`${inputClass} rounded-r-none`}
                    />
                    <span className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 border border-l-0 border-gray-200 dark:border-gray-600 rounded-lg rounded-l-none whitespace-nowrap">
                      .{ROOT_DOMAIN}
                    </span>
                  </div>
                  <div className="h-4 mt-1 text-xs">
                    {checking && <span className="text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> checking…</span>}
                    {!checking && availability?.available && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {fullHost} is available</span>}
                    {!checking && availability && !availability.available && <span className="text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {availability.reason}</span>}
                  </div>
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Admin email</span>
                  <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="admin@school.ac.ug" className={inputClass} />
                </label>

                <div>
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Payment method</span>
                  <div className="grid grid-cols-3 gap-2">
                    {PROVIDERS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setProvider(value)}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                          provider === value
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                            : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {provider === 'bank' ? (
                  <label className="block">
                    <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Bank code</span>
                    <input value={bankCode} onChange={e => setBankCode(e.target.value)} placeholder="e.g. STANBIC" className={inputClass} />
                  </label>
                ) : (
                  <label className="block">
                    <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Mobile money number</span>
                    <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+256 7XX XXX XXX" className={inputClass} />
                  </label>
                )}

                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
                  </div>
                )}

                <button
                  onClick={submit}
                  disabled={!canSubmit || submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                  {submitting ? 'Starting…' : 'Continue to payment'}
                </button>
              </div>
            )}

            {stage === 'pending' && signup && (
              <div className="p-6 text-center space-y-3">
                <Loader2 className="w-10 h-10 text-indigo-500 mx-auto animate-spin" />
                <h1 className="text-lg font-bold text-gray-800 dark:text-white">Complete your payment</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">{signup.instructions || 'Approve the payment prompt on your phone.'}</p>
                <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-3 py-2">
                  Reference: <span className="font-mono">{signup.reference}</span>
                </div>
                <p className="text-xs text-gray-400">
                  This page activates automatically once your payment is confirmed. Your school will be at{' '}
                  <span className="font-medium text-gray-600 dark:text-gray-300">{signup.subdomain}.{ROOT_DOMAIN}</span>.
                </p>
              </div>
            )}

            {stage === 'active' && signup && (
              <div className="p-6 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <h1 className="text-lg font-bold text-gray-800 dark:text-white">Your school is ready!</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">Open your school and create the first (admin) account.</p>
                <a
                  href={`https://${signup.subdomain}.${ROOT_DOMAIN}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:shadow-lg"
                >
                  Go to {signup.subdomain}.{ROOT_DOMAIN}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="text-center text-[11px] text-gray-400 py-3">Powered by e-School · v{APP_VERSION}</footer>
    </div>
  );
};

export default TenantSignup;
