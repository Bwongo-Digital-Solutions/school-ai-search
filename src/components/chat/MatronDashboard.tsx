import React, { useCallback, useEffect, useState } from 'react';
import { InlineLoading, Select, SelectItem, Tab, TabList, Tabs, Tag } from '@carbon/react';
import {
  Home,
  ListChecked,
  Moon,
  Purchase,
  Sun,
  UserMultiple,
  Warning,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { AccessDenied, PageHeader, StatRow, StatTile } from '@/components/common';
import { todayIso } from '@/lib/format';
import { matronApi, type MatronDashboardData } from '@/lib/schoolLife';
import styles from './workspace.module.scss';
import DormRollTab from './matron/DormRollTab';
import SickBayTab from './matron/SickBayTab';
import BedsTab from './matron/BedsTab';
import WelfareTab from './matron/WelfareTab';

const SECTIONS = [
  { key: 'roll', label: 'Roll call', icon: UserMultiple },
  { key: 'sickbay', label: 'Sick bay', icon: Purchase },
  { key: 'beds', label: 'Beds', icon: Home },
  { key: 'welfare', label: 'Welfare', icon: ListChecked },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

/**
 * The matron's screen.
 *
 * She could already scan a card and see a dormitory; what she could not do was work from her own
 * list. These four are what a matron actually does across an evening — the head count, the sick
 * bay, the beds, and noticing who arrived without their bedding.
 *
 * Open to the matron by her designation, and to an administrator or head teacher because somebody
 * has to cover the dormitories when she is off. The server checks the same thing again through
 * `requirePost`; this is only what the browser draws.
 */
const MatronDashboard: React.FC = () => {
  const { notify } = useNotifications();
  const { isMatron, isPrivileged } = useAuth();

  const [section, setSection] = useState<SectionKey>('roll');
  const [busy, setBusy] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [check, setCheck] = useState<'morning' | 'night'>('night');
  const [summary, setSummary] = useState<MatronDashboardData | null>(null);

  const mayOpen = isMatron || isPrivileged;

  const runAction = useCallback(async (label: string, handler: () => Promise<void>) => {
    setBusy(label);
    try {
      await handler();
    } catch (err: unknown) {
      console.error(`${label} failed:`, err);
      notify.error(`${label} failed`, err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const loadSummary = useCallback(async () => {
    if (!mayOpen) return;
    try {
      setSummary(await matronApi.dashboard(date, check));
    } catch (err) {
      // The band is a summary; a failure here leaves every tab below perfectly usable.
      console.error('Could not load the dormitory summary:', err);
    }
  }, [mayOpen, date, check]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  if (!mayOpen) {
    return (
      <AccessDenied
        title="Not available to your role"
        message="The dormitory screens — the roll call, the sick bay and the beds — belong to the matron."
      />
    );
  }

  return (
    <div className={styles.screen}>
      <PageHeader title="Dormitories" illustration={<Home size={32} />}>
        {busy && (
          <span className={styles.busy}>
            <InlineLoading description={`${busy}…`} />
          </span>
        )}
        <Tag type="teal" size="sm" renderIcon={Home}>Matron</Tag>
      </PageHeader>

      <div className={styles.controls}>
        {summary && (
          <StatRow>
            <StatTile label="Boarders" value={summary.boarders} icon={UserMultiple} />
            <StatTile
              label="Not yet marked"
              value={summary.roll.unmarked}
              icon={Warning}
              tone={summary.roll.unmarked > 0 ? 'warning' : 'success'}
            />
            <StatTile
              label="In the sick bay"
              value={summary.in_sick_bay}
              icon={Purchase}
              tone={summary.in_sick_bay > 0 ? 'warning' : 'default'}
            />
            <StatTile label="Signed out at the gate" value={summary.signed_out} icon={ListChecked} />
            <StatTile
              label="Owing requirements"
              value={summary.owing_requirements}
              icon={Warning}
              tone={summary.owing_requirements > 0 ? 'warning' : 'default'}
            />
            <StatTile label="Beds free" value={summary.beds_free} icon={Home} />
          </StatRow>
        )}

        {/* The date and which check are set once, here, because every tab below is about the same
            night. Putting them on the roll call alone would leave the band above disagreeing. */}
        <div className={styles.toolbar}>
          <Select
            id="matron-date"
            labelText="Night"
            size="sm"
            className={styles.filter}
            value={date}
            onChange={event => setDate(event.target.value)}
          >
            {[0, 1, 2, 3, 4, 5, 6].map(back => {
              const day = new Date();
              day.setDate(day.getDate() - back);
              const iso = day.toISOString().slice(0, 10);
              return (
                <SelectItem
                  key={iso}
                  value={iso}
                  text={back === 0 ? `Today · ${iso}` : iso}
                />
              );
            })}
          </Select>
          <Select
            id="matron-check"
            labelText="Check"
            size="sm"
            className={styles.filter}
            value={check}
            onChange={event => setCheck(event.target.value as 'morning' | 'night')}
          >
            <SelectItem value="night" text="Night" />
            <SelectItem value="morning" text="Morning" />
          </Select>
          <span className={styles.note}>
            {check === 'night' ? <Moon size={16} /> : <Sun size={16} />}
          </span>
        </div>

        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex(entry => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="Dormitory sections" contained>
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>{label}</Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      <div className={styles.body}>
        {section === 'roll' && (
          <DormRollTab runAction={runAction} date={date} check={check} onChanged={loadSummary} />
        )}
        {section === 'sickbay' && <SickBayTab runAction={runAction} onChanged={loadSummary} />}
        {section === 'beds' && <BedsTab runAction={runAction} onChanged={loadSummary} />}
        {section === 'welfare' && <WelfareTab runAction={runAction} onChanged={loadSummary} />}
      </div>
    </div>
  );
};

export default MatronDashboard;
