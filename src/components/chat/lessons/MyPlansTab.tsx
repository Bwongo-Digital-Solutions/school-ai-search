import React, { useCallback, useEffect, useState } from 'react';
import { Copy, FileDown, Trash2 } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { callLessonPlanner, teachingDocumentUrl } from '@/lib/teaching';
import { downloadFromUrl } from '@/lib/download';
import { EmptyState, Panel, SecondaryButton, zebra } from '../fees/shared';
import { CitationList, StatusBadge, LESSON_STATUS_STYLES, TERM_OPTIONS } from './shared';
import type { LessonPlan } from '@/types/teaching';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
  refreshKey: number;
}

const STATUS_FILTER = [
  { value: '', label: 'Any status' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'delivered', label: 'Delivered' },
];

const MyPlansTab: React.FC<Props> = ({ runAction, onChanged, busy, refreshKey }) => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [filters, setFilters] = useState({ status: '', term: '', subjectName: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await callLessonPlanner<{ plans: LessonPlan[] }>('list', { status: filters.status, term: filters.term }, user);
      // Subject is filtered here rather than server-side: plans store a free-text subject name, so
      // a substring match is friendlier than the exact match the endpoint does.
      const needle = filters.subjectName.trim().toLowerCase();
      setPlans(
        needle
          ? result.plans.filter(plan => plan.subject_name.toLowerCase().includes(needle))
          : result.plans,
      );
    } catch (err) {
      console.error('Failed to load lesson plans:', err);
    }
  }, [filters, user]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const setStatus = useCallback(
    (plan: LessonPlan, status: string) =>
      runAction(`Marking the plan ${status}`, async () => {
        await callLessonPlanner('set_status', { id: plan.id, status }, user);
        await load();
        onChanged();
      }),
    [load, onChanged, runAction, user],
  );

  return (
    <div className="space-y-4">
      <Panel className="p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field
            label="Status"
            value={filters.status}
            onChange={value => setFilters({ ...filters, status: String(value ?? '') })}
            options={STATUS_FILTER}
          />
          <Field
            label="Term"
            value={filters.term}
            onChange={value => setFilters({ ...filters, term: String(value ?? '') })}
            options={TERM_OPTIONS}
          />
          <Field
            label="Subject"
            value={filters.subjectName}
            onChange={value => setFilters({ ...filters, subjectName: String(value ?? '') })}
            placeholder="Any subject"
          />
        </div>
      </Panel>

      <Panel>
        {plans.length === 0 ? (
          <EmptyState message="No lesson plans yet. Draft one from the Plan Builder." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {plans.map(plan => (
              <div key={plan.id} className={zebra}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}
                  className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{plan.title}</p>
                    <p className="text-[11px] text-gray-400">
                      {[plan.subject_name, plan.topic, plan.term, `${plan.duration_minutes} min`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <StatusBadge status={plan.status} styles={LESSON_STATUS_STYLES} />
                </button>

                {expandedId === plan.id && (
                  <div className="px-4 pb-4">
                    {plan.learning_outcomes.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                          Learning outcomes
                        </p>
                        <ul className="list-disc pl-4 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                          {plan.learning_outcomes.map((outcome, index) => (
                            <li key={index}>{outcome}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <CitationList citations={plan.refs} />

                    <div className="flex flex-wrap gap-2 mt-3">
                      {plan.status !== 'approved' && (
                        <SecondaryButton onClick={() => setStatus(plan, 'approved')} disabled={Boolean(busy)}>
                          Approve
                        </SecondaryButton>
                      )}
                      {plan.status === 'approved' && (
                        <SecondaryButton onClick={() => setStatus(plan, 'delivered')} disabled={Boolean(busy)}>
                          Mark delivered
                        </SecondaryButton>
                      )}
                      <SecondaryButton
                        onClick={() =>
                          runAction('Duplicating the lesson plan', async () => {
                            await callLessonPlanner('duplicate', { id: plan.id }, user);
                            await load();
                            onChanged();
                          })
                        }
                        disabled={Boolean(busy)}
                      >
                        <Copy className="w-4 h-4" /> Duplicate
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() =>
                          runAction('Building the lesson plan PDF', async () => {
                            await downloadFromUrl(
                              teachingDocumentUrl(`/api/lesson-plans/${plan.id}.pdf`, user),
                              `${plan.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`,
                            );
                          })
                        }
                        disabled={Boolean(busy)}
                      >
                        <FileDown className="w-4 h-4" /> PDF
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => {
                          if (!window.confirm(`Delete “${plan.title}”? This cannot be undone.`)) return;
                          runAction('Deleting the lesson plan', async () => {
                            await callLessonPlanner('delete', { id: plan.id }, user);
                            await load();
                            onChanged();
                          });
                        }}
                        disabled={Boolean(busy)}
                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </SecondaryButton>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

export default MyPlansTab;
