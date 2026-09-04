import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineLoading, InlineNotification, TextInput } from '@carbon/react';
import {
  Finance,
  Building,
  CheckmarkFilled,
  Education,
  Mobile,
  WarningFilled,
} from '@carbon/react/icons';
import { callProvision, type AvailabilityResult, type SignupResult, type TenantStatus } from '@/lib/provision';
import styles from './public-pages.module.scss';

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
  { value: 'mtn_momo', label: 'MTN MoMo', icon: Mobile },
  { value: 'airtel_money', label: 'Airtel Money', icon: Mobile },
  { value: 'bank', label: 'Bank', icon: Finance },
];

type Stage = 'form' | 'pending' | 'active';

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
    <div className={styles.page}>
      <div className={styles.centred}>
        <div>
          <div className={styles.brand}>
            <span className={styles.brandMark}>
              <Education size={20} />
            </span>
            <span className={styles.brandName}>e-School</span>
          </div>

          <div className={styles.card}>
            {stage === 'form' && (
              <div className={styles.section}>
                <div>
                  <h1 className={styles.title}>Start your school</h1>
                  <p className={styles.lede}>
                    Create your school's own space, on its own address.
                  </p>
                </div>

                <TextInput
                  id="school-name"
                  labelText="School name"
                  placeholder="Kampala High School"
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                />

                <div>
                  <div className={styles.hostRow}>
                    <TextInput
                      id="subdomain"
                      className={styles.hostField}
                      labelText="Choose your web address"
                      placeholder="kampala-high"
                      value={subdomain}
                      onChange={e =>
                        setSubdomain(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())
                      }
                    />
                    <span className={styles.hostSuffix}>.{ROOT_DOMAIN}</span>
                  </div>

                  {/* Availability, live. Checked as they type rather than on submit, because a taken
                      name is the one thing that will send them back to this field. */}
                  <p className={styles.availability}>
                    {checking && <span className={styles.checking}>Checking…</span>}
                    {!checking && availability?.available && (
                      <span className={styles.available}>
                        <CheckmarkFilled size={16} /> {fullHost} is available
                      </span>
                    )}
                    {!checking && availability && !availability.available && (
                      <span className={styles.unavailable}>
                        <WarningFilled size={16} /> {availability.reason}
                      </span>
                    )}
                  </p>
                </div>

                <TextInput
                  id="contact-email"
                  type="email"
                  labelText="Administrator email"
                  placeholder="admin@school.ac.ug"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                />

                <div>
                  <p className={styles.note}>How you will pay</p>
                  <div className={styles.providers}>
                    {PROVIDERS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setProvider(value)}
                        className={`${styles.provider} ${provider === value ? styles.providerChosen : ''}`}
                        aria-pressed={provider === value}
                      >
                        <Icon size={20} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {provider === 'bank' ? (
                  <TextInput
                    id="bank-code"
                    labelText="Bank code"
                    placeholder="e.g. STANBIC"
                    value={bankCode}
                    onChange={e => setBankCode(e.target.value)}
                  />
                ) : (
                  <TextInput
                    id="phone"
                    labelText="Mobile money number"
                    placeholder="+256 7XX XXX XXX"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                  />
                )}

                {error && (
                  <InlineNotification
                    kind="error"
                    title="Could not continue"
                    subtitle={error}
                    onCloseButtonClick={() => setError('')}
                    lowContrast
                  />
                )}

                <Button
                  kind="primary"
                  renderIcon={Building}
                  onClick={submit}
                  disabled={!canSubmit || submitting}
                >
                  {submitting ? 'Starting…' : 'Continue to payment'}
                </Button>
              </div>
            )}

            {stage === 'pending' && signup && (
              <div className={`${styles.section} ${styles.centredText}`}>
                <div className={styles.spinner}>
                  <InlineLoading description="Waiting for your payment…" />
                </div>
                <h1 className={styles.title}>Complete your payment</h1>
                <p className={styles.lede}>
                  {signup.instructions || 'Approve the payment prompt on your phone.'}
                </p>
                <p className={styles.reference}>Reference: {signup.reference}</p>
                <p className={styles.note}>
                  This page opens your school automatically once the payment is confirmed. It will be at{' '}
                  {signup.subdomain}.{ROOT_DOMAIN}.
                </p>
              </div>
            )}

            {stage === 'active' && signup && (
              <div className={`${styles.section} ${styles.centredText}`}>
                <h1 className={styles.title}>Your school is ready</h1>
                <p className={styles.lede}>
                  Open it and create the first account — that one becomes the administrator.
                </p>
                <div>
                  <Button kind="primary" href={`https://${signup.subdomain}.${ROOT_DOMAIN}`}>
                    Go to {signup.subdomain}.{ROOT_DOMAIN}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className={styles.footer}>Powered by e-School · v{APP_VERSION}</footer>
    </div>
  );
};

export default TenantSignup;
