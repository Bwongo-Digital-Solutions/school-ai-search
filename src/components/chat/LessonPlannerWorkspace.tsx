import React, { useCallback, useEffect, useState } from 'react';
import { InlineLoading, Tab, TabList, Tabs } from '@carbon/react';
import { Book, Calendar, Education, MagicWand, Notebook } from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callLessonPlanner, loadCurriculumFrameworks } from '@/lib/teaching';
import { AccessDenied, PageHeader, StatRow, StatTile } from '@/components/common';
import styles from './workspace.module.scss';
import PlanBuilderTab from './lessons/PlanBuilderTab';
import MyPlansTab from './lessons/MyPlansTab';
import SchemeOfWorkTab from './lessons/SchemeOfWorkTab';
import type { CurriculumFramework, LessonPlan } from '@/types/teaching';

const SECTIONS = [
  { key: 'builder', label: 'Plan builder', icon: MagicWand },
  { key: 'plans', label: 'My plans', icon: Book },
  { key: 'scheme', label: 'Scheme of work', icon: Calendar },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const LessonPlannerWorkspace: React.FC = () => {
  const { notify } = useNotifications();
  const { user, isAdmin } = useAuth();
  const isTeachingStaff = isAdmin || user?.role === 'teacher';

  const [section, setSection] = useState<SectionKey>('builder');
  const [busy, setBusy] = useState<string | null>(null);
  const [frameworks, setFrameworks] = useState<CurriculumFramework[]>([]);
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  // Bumped after any mutation so the listing tab reloads without each tab owning a refresh channel.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadCurriculumFrameworks().then(setFrameworks);
  }, []);

  const loadPlans = useCallback(async () => {
    if (!isTeachingStaff) return;
    try {
      const result = await callLessonPlanner<{ plans: LessonPlan[] }>('list', {}, user);
      setPlans(result.plans);
    } catch (err) {
      console.error('Failed to load lesson plans:', err);
    }
  }, [isTeachingStaff, user]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const onChanged = useCallback(() => {
    setRefreshKey(key => key + 1);
    loadPlans();
  }, [loadPlans]);

  /**
   * Shared wrapper for every mutation on this screen, mirroring the fees workspace: one place that
   * shows progress and surfaces the server's message on failure.
   */
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
  }, []);

  // Defence in depth. Support staff never reach this component (AppLayout short-circuits them) and
  // the nav entry is hidden from them, but the screen must show nothing if it is somehow selected.
  if (!isTeachingStaff) {
    return (
      <AccessDenied
        title="Teaching staff only"
        message="Lesson planning is available to teachers and administrators."
      />
    );
  }

  const approved = plans.filter(plan => plan.status === 'approved').length;
  const drafts = plans.filter(plan => plan.status === 'draft').length;

  return (
    <div className={styles.screen}>
      <PageHeader title="Lesson planner" illustration={<Notebook size={32} />}>
        {busy && (
          <span className={styles.busy}>
            <InlineLoading description={`${busy}…`} />
          </span>
        )}
      </PageHeader>

      <div className={styles.controls}>
        <StatRow>
          <StatTile label="Lesson plans" value={String(plans.length)} icon={Book} />
          <StatTile
            label="Awaiting review"
            value={String(drafts)}
            icon={MagicWand}
            tone={drafts > 0 ? 'warning' : 'default'}
          />
          <StatTile label="Approved" value={String(approved)} icon={Education} tone="success" />
        </StatRow>

        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex(entry => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="Lesson planner sections" contained>
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>
                  {label}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      <div className={styles.body}>
        {section === 'builder' && (
          <PlanBuilderTab frameworks={frameworks} runAction={runAction} onChanged={onChanged} busy={busy} />
        )}
        {section === 'plans' && (
          <MyPlansTab runAction={runAction} onChanged={onChanged} busy={busy} refreshKey={refreshKey} />
        )}
        {section === 'scheme' && (
          <SchemeOfWorkTab frameworks={frameworks} runAction={runAction} onChanged={onChanged} busy={busy} />
        )}
      </div>
    </div>
  );
};

export default LessonPlannerWorkspace;
