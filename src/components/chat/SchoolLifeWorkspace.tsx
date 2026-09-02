import React, { useCallback, useEffect, useState } from 'react';
import { InlineLoading, Tab, TabList, Tabs } from '@carbon/react';
import { Events, Group, ListChecked, Warning } from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { AccessDenied, PageHeader, StatRow, StatTile } from '@/components/common';
import { clubsApi, requirementsApi } from '@/lib/schoolLife';
import styles from './workspace.module.scss';
import ClubsTab from './schoolLife/ClubsTab';
import RequirementsTab from './schoolLife/RequirementsTab';
import OutstandingTab from './schoolLife/OutstandingTab';

const SECTIONS = [
  { key: 'clubs', label: 'Clubs', icon: Events },
  { key: 'requirements', label: 'Requirements', icon: ListChecked },
  { key: 'outstanding', label: 'Still owing', icon: Warning },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

/**
 * Clubs and school requirements, on one screen.
 *
 * They are one screen because they are one moment: a child arrives, and the desk asks what they are
 * joining and what they have brought. Splitting them into two entries in the rail would make the
 * person doing that job navigate twice for one conversation.
 *
 * Reading is open to anyone who holds the roster; publishing the lists is the office's job, and the
 * `canEdit` flag below is only what the browser draws — every action is gated again on the server.
 */
const SchoolLifeWorkspace: React.FC = () => {
  const { notify } = useNotifications();
  const { canSeeStudents, isPrivileged } = useAuth();

  const [section, setSection] = useState<SectionKey>('clubs');
  const [busy, setBusy] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ clubs: number; members: number; items: number; owing: number } | null>(null);

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

  const loadCounts = useCallback(async () => {
    if (!canSeeStudents) return;
    try {
      const [clubs, catalogue, owing] = await Promise.all([
        clubsApi.list(),
        requirementsApi.catalogue(),
        requirementsApi.outstanding(),
      ]);
      setCounts({
        clubs: clubs.clubs.length,
        members: clubs.clubs.reduce((total, club) => total + Number(club.member_count || 0), 0),
        items: catalogue.items.length,
        owing: owing.students.length,
      });
    } catch (err) {
      // The band is a summary, not the screen. A failure here leaves the tabs perfectly usable.
      console.error('Could not load the school life summary:', err);
    }
  }, [canSeeStudents]);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  if (!canSeeStudents) {
    return (
      <AccessDenied
        title="Not available to your role"
        message="Clubs and school requirements are part of a student's record, so they are open to the staff who hold the roster."
      />
    );
  }

  return (
    <div className={styles.screen}>
      <PageHeader title="School life" illustration={<Events size={32} />}>
        {busy && (
          <span className={styles.busy}>
            <InlineLoading description={`${busy}…`} />
          </span>
        )}
      </PageHeader>

      <div className={styles.controls}>
        {counts && (
          <StatRow>
            <StatTile label="Clubs" value={counts.clubs} icon={Events} />
            <StatTile label="Club places taken" value={counts.members} icon={Group} />
            <StatTile label="Items on the lists" value={counts.items} icon={ListChecked} />
            <StatTile
              label="Students still owing"
              value={counts.owing}
              icon={Warning}
              tone={counts.owing > 0 ? 'warning' : 'default'}
            />
          </StatRow>
        )}

        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex(entry => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="School life sections" contained>
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>{label}</Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      <div className={styles.body}>
        {section === 'clubs' && (
          <ClubsTab runAction={runAction} canEdit={isPrivileged} onChanged={loadCounts} />
        )}
        {section === 'requirements' && (
          <RequirementsTab runAction={runAction} canEdit={isPrivileged} />
        )}
        {section === 'outstanding' && <OutstandingTab runAction={runAction} />}
      </div>
    </div>
  );
};

export default SchoolLifeWorkspace;
