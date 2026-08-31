import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, CalendarRange, GraduationCap, Loader2, NotebookPen, Shield, Wand2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callLessonPlanner, loadCurriculumFrameworks } from '@/lib/teaching';
import StatTile from '@/components/common/StatTile';
import PlanBuilderTab from './lessons/PlanBuilderTab';
import MyPlansTab from './lessons/MyPlansTab';
import SchemeOfWorkTab from './lessons/SchemeOfWorkTab';
import type { CurriculumFramework, LessonPlan } from '@/types/teaching';

const SECTIONS = [
  { key: 'builder', label: 'Plan Builder', icon: Wand2 },
  { key: 'plans', label: 'My Plans', icon: BookOpen },
  { key: 'scheme', label: 'Scheme of Work', icon: CalendarRange },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const LessonPlannerWorkspace: React.FC = () => {
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
      alert(`${label} failed: ${err instanceof Error ? err.message : 'Unexpected error'}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // Defence in depth. Support staff never reach this component (AppLayout short-circuits them) and
  // the nav entry is hidden from them, but the screen must show nothing if it is somehow selected.
  if (!isTeachingStaff) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900 p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-purple-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Teaching Staff Only</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The Lesson Planner is available to teachers and administrators.
          </p>
        </div>
      </div>
    );
  }

  const approved = plans.filter(plan => plan.status === 'approved').length;
  const drafts = plans.filter(plan => plan.status === 'draft').length;

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <NotebookPen className="w-6 h-6 text-indigo-500" />
              Lesson Planner
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Draft lessons and schemes of work from your school's curriculum library.
            </p>
          </div>
          {busy && (
            <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy}…
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <StatTile label="Lesson plans" value={String(plans.length)} icon={BookOpen} />
          <StatTile label="Awaiting review" value={String(drafts)} icon={Wand2} tone={drafts > 0 ? 'warning' : 'default'} />
          <StatTile label="Approved" value={String(approved)} icon={GraduationCap} tone="success" />
        </div>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                section === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
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
