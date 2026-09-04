import React, { useEffect, useState } from 'react';
import { Button, InlineNotification, Tab, TabList, Tabs, Tag } from '@carbon/react';
import { Education, Plug, Save, Search, Settings as SettingsIcon, Password } from '@carbon/react/icons';
import McpServersPanel from './McpServersPanel';
import AiKeysPanel from './AiKeysPanel';
import LibreChatPanel from './LibreChatPanel';
import IntegrationsPanel from './IntegrationsPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useLicence } from '@/contexts/LicenceContext';
import { changePlan, fetchPlanView, type PlanTier } from '@/lib/licence';
import { useSettings } from '@/contexts/SettingsContext';
import { useNotifications } from '@/contexts/NotificationContext';
import {
  AccessDenied,
  CardHeader,
  ColorPicker,
  Field,
  ImagePicker,
  PageHeader,
  WidgetCard,
} from '@/components/common';
import {
  GRADING_COUNTRY_OPTIONS,
  SCHOOL_LEVEL_OPTIONS,
  saveSchoolSettings,
  type SchoolSettings,
} from '@/lib/settings';
import styles from './settings-panel.module.scss';

const TABS = [
  { key: 'branding', label: 'Branding', icon: SettingsIcon },
  { key: 'mcp', label: 'MCP servers', icon: Plug },
  { key: 'search', label: 'Search & LibreChat', icon: Search },
  { key: 'ai-keys', label: 'AI providers', icon: Password },
  { key: 'integrations', label: 'Integrations', icon: Plug },
] as const;

const BLURB: Record<(typeof TABS)[number]['key'], string> = {
  branding:
    'The school identity used across report cards, receipts, statements, ID cards and the app header.',
  mcp: 'Connect external MCP servers so the assistant can use their tools.',
  search: 'Global search across the school, and connecting LibreChat to this data.',
  'ai-keys': "Use your school's own AI accounts instead of the platform's.",
  integrations:
    "The systems your school already runs — its Moodle, and one business system — so they open from here.",
};

/* Cheapest first, matching TIERS on the server. Used only to tell an upgrade from a downgrade, so
   the confirmation can say which one is about to happen. */
const TIER_ORDER = ['essential', 'standard', 'professional', 'enterprise'];

const SettingsPanel: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { entitlements, refreshLicence } = useLicence();
  const { settings, refreshSettings } = useSettings();
  const { notify, confirm } = useNotifications();
  const [form, setForm] = useState<SchoolSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Derived from TABS rather than restated, so adding a tab is one edit.
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('branding');

  // Keep the form in sync when the global settings load/refresh.
  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const [planChangeable, setPlanChangeable] = useState(true);
  const [changingPlan, setChangingPlan] = useState('');

  /* Whether this deployment can act on a change at all is a server question — the plan may be
     pinned in the environment, where nothing on this screen can move it — so it is asked rather
     than assumed. A failure leaves the buttons live: the server refuses in words if it must. */
  useEffect(() => {
    fetchPlanView()
      .then(view => setPlanChangeable(view.changeable))
      .catch(() => setPlanChangeable(true));
  }, []);

  const changeTier = async (plan: PlanTier, label: string) => {
    const dropping = TIER_ORDER.indexOf(plan) < TIER_ORDER.indexOf(entitlements.plan);
    const ok = await confirm({
      title: `Move this school to ${label}?`,
      message: dropping
        ? `The screens ${label} does not include stop working immediately, for everyone signed in. There is no grace period and nothing is refunded automatically.`
        : `${label} switches on straight away for everyone signed in. Nothing is charged here — billing is handled separately.`,
      confirmLabel: dropping ? `Downgrade to ${label}` : `Upgrade to ${label}`,
      danger: dropping,
    });
    if (!ok) return;

    setChangingPlan(plan);
    try {
      await changePlan(plan);
      await refreshLicence();
      notify.success(`Now on ${label}`, 'It takes effect within a minute for everyone signed in.');
    } catch (err) {
      notify.error('The plan could not be changed', err instanceof Error ? err.message : undefined);
    } finally {
      setChangingPlan('');
    }
  };

  if (!isAdmin) {
    return (
      <AccessDenied
        title="Administrators only"
        message="School settings decide how every report card, receipt and ID card looks, so only administrators can change them."
      />
    );
  }

  const set = (key: keyof SchoolSettings) => (value: string) => {
    setForm(current => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const selectedLevel = SCHOOL_LEVEL_OPTIONS.find(option => option.value === form.school_level);

  const save = async () => {
    setSaving(true);
    try {
      await saveSchoolSettings(form, user);
      await refreshSettings();
      setSaved(true);
    } catch (err) {
      notify.error('Could not save the settings', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.screen}>
      <PageHeader title="School settings" illustration={<SettingsIcon size={32} />} />

      <div className={styles.controls}>
        <p className={styles.blurb}>{BLURB[tab]}</p>
        <div className={styles.tabs}>
          <Tabs
            selectedIndex={TABS.findIndex(entry => entry.key === tab)}
            onChange={({ selectedIndex }) => setTab(TABS[selectedIndex].key)}
          >
            <TabList aria-label="Settings sections" contained>
              {TABS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>
                  {label}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      <div className={styles.body}>
        {tab === 'search' && <LibreChatPanel />}
        {tab === 'mcp' && <McpServersPanel />}
        {tab === 'ai-keys' && <AiKeysPanel />}
        {tab === 'integrations' && <IntegrationsPanel />}

        {tab === 'branding' && (
          <div className={styles.branding}>
            <WidgetCard>
              <CardHeader title="Identity" />
              <div className={styles.section}>
                <div className={styles.grid2}>
                  <Field
                    label="School name"
                    value={form.school_name}
                    onChange={set('school_name')}
                    placeholder="e.g. Kampala High School"
                  />
                  <Field
                    label="Tagline"
                    value={form.tagline}
                    onChange={set('tagline')}
                    placeholder="e.g. Knowledge is power"
                  />
                </div>
                <Field
                  label="Address"
                  value={form.address}
                  onChange={set('address')}
                  placeholder="e.g. P.O. Box 123, Kampala, Uganda"
                />
                <div className={styles.grid2}>
                  <Field
                    label="Contact phone"
                    value={form.contact_phone}
                    onChange={set('contact_phone')}
                    placeholder="+256 …"
                  />
                  <Field
                    label="Contact email"
                    type="email"
                    value={form.contact_email}
                    onChange={set('contact_email')}
                    placeholder="info@school.ac.ug"
                  />
                </div>
              </div>
            </WidgetCard>

            <WidgetCard>
              <CardHeader title="Academic level and grading">
                <Education size={16} className={styles.headerIcon} />
              </CardHeader>
              <div className={styles.section}>
                <div className={styles.grid2}>
                  <Field
                    label="School level"
                    value={form.school_level}
                    onChange={set('school_level')}
                    options={SCHOOL_LEVEL_OPTIONS}
                  />
                  <Field
                    label="Examination system"
                    value={form.grading_country}
                    onChange={set('grading_country')}
                    options={GRADING_COUNTRY_OPTIONS}
                  />
                </div>

                {/* The consequence of the choice, shown before it is saved. */}
                <p className={styles.consequence}>
                  <span className={styles.consequenceLabel}>Report cards will grade on: </span>
                  {selectedLevel?.grades}
                </p>
                <p className={styles.note}>
                  Set this once — every report card follows it, so nobody has to choose a scale per
                  student. A secondary school gets both O-Level and A-Level scales automatically; each
                  student's own class decides which applies.
                </p>
              </div>
            </WidgetCard>

            <WidgetCard>
              <CardHeader title="Appearance" />
              <div className={styles.section}>
                <ColorPicker
                  label="Theme colour"
                  value={form.theme_color}
                  onChange={set('theme_color')}
                  hint="Colours the app header and the headings on every generated document."
                />
                <ImagePicker
                  label="School logo"
                  value={form.logo}
                  onChange={set('logo')}
                  shape="logo"
                  hint="Appears on report cards, receipts, statements and ID cards."
                />
              </div>
            </WidgetCard>

            {/* The school changes its own tier here, without an operator in the loop. Two things
                this does not do, and they are the price of that: nothing is charged (billing is the
                control plane's business and is not wired to this), and a downgrade takes effect at
                once with no proration. Both are said out loud rather than discovered. */}
            <WidgetCard>
              <CardHeader title="Plan">
                <Tag type="blue" size="sm">{entitlements.planLabel}</Tag>
              </CardHeader>
              <div className={styles.section}>
                <p className={styles.blurb}>
                  {entitlements.deploymentLabel}
                  {entitlements.deployment === 'onsite' && !entitlements.ownModel
                    && ' · no model of your own is configured, so the AI features stay off whatever the tier'}
                </p>

                <div className={styles.planTiers}>
                  {entitlements.tiers.map(tier => {
                    const included = Object.values(entitlements.features).filter(f => f.tier === tier.value);
                    const current = tier.value === entitlements.plan;
                    return (
                      <div key={tier.value} className={`${styles.planTier} ${current ? styles.planTierCurrent : ''}`}>
                        <div className={styles.planRow}>
                          <strong>{tier.label}</strong>
                          {current
                            ? <Tag type="blue" size="sm">Current</Tag>
                            : (
                              <Button
                                kind="tertiary"
                                size="sm"
                                disabled={!planChangeable || Boolean(changingPlan)}
                                onClick={() => changeTier(tier.value, tier.label)}
                              >
                                {changingPlan === tier.value
                                  ? 'Changing…'
                                  : TIER_ORDER.indexOf(tier.value) > TIER_ORDER.indexOf(entitlements.plan)
                                    ? 'Upgrade'
                                    : 'Downgrade'}
                              </Button>
                            )}
                        </div>
                        <p className={styles.note}>
                          {included.map(f => f.label).join(' · ') || '—'}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <p className={styles.note}>
                  Each tier includes everything in the ones above it. A change takes effect within a
                  minute, for everyone signed in — a downgrade removes those screens straight away.
                  {!planChangeable && ' This deployment pins its plan in its configuration, so it cannot be changed here.'}
                </p>
              </div>
            </WidgetCard>

            {saved && (
              <InlineNotification
                kind="success"
                title="Saved"
                subtitle="Documents and the app header now use this branding."
                onCloseButtonClick={() => setSaved(false)}
                lowContrast
              />
            )}

            <div className={styles.actions}>
              <Button kind="primary" renderIcon={Save} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel;
