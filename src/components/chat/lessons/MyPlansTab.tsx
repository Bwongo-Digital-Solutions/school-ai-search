import React, { useCallback, useEffect, useState } from 'react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callLessonPlanner, teachingDocumentUrl } from '@/lib/teaching';
import { downloadFromUrl } from '@/lib/download';
import { TablePager } from '@/components/common';
import { usePagedRows } from '@/hooks/usePagedRows';
import { DangerButton, EmptyState, Panel, SecondaryButton, zebra } from '../fees/shared';
import { CitationList, StatusBadge, LESSON_STATUS_STYLES, TERM_OPTIONS } from './shared';
import type { LessonPlan } from '@/types/teaching';
import styles from '../tabs.module.scss';
import { Copy, DocumentDownload, TrashCan } from '@carbon/react/icons';

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
  const { confirm } = useNotifications();
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

  // A teacher plans every lesson of every week, and nothing here is ever archived — a year in, this
  // is hundreds of rows even with the filters above applied.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(plans, 25);

  return (
    <div className={styles.stack}>
      <Panel className={styles.padTight}>
        <div className={styles.grid3}>
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
          <div className={styles.rows}>
            {pageRows.map(plan => (
              <div key={plan.id} className={zebra}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}
                  className={styles.expandRow}
                >
                  <div className={styles.rowMain}>
                    <p className={styles.strong}>{plan.title}</p>
                    <p className={styles.note}>
                      {[plan.subject_name, plan.topic, plan.term, `${plan.duration_minutes} min`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <StatusBadge status={plan.status} styles={LESSON_STATUS_STYLES} />
                </button>

                {expandedId === plan.id && (
                  <div className={styles.padBody}>
                    {plan.learning_outcomes.length > 0 && (
                      <div >
                        <p className={styles.label}>
                          Learning outcomes
                        </p>
                        <ul className={styles.bullets}>
                          {plan.learning_outcomes.map((outcome, index) => (
                            <li key={index}>{outcome}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <CitationList citations={plan.refs} />

                    <div className={styles.actions}>
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
                        <Copy size={16} /> Duplicate
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
                        <DocumentDownload size={16} /> PDF
                      </SecondaryButton>
                      <DangerButton
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: 'Delete this lesson plan?',
                              message: `“${plan.title}” will be removed. This cannot be undone.`,
                              confirmLabel: 'Delete',
                              danger: true,
                            }))
                          ) {
                            return;
                          }
                          runAction('Deleting the lesson plan', async () => {
                            await callLessonPlanner('delete', { id: plan.id }, user);
                            await load();
                            onChanged();
                          });
                        }}
                        disabled={Boolean(busy)}

                      >
                        <TrashCan size={16} /> Delete
                      </DangerButton>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {plans.length > 0 && (
          <div className={styles.tableFoot}>
            <TablePager
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              firstOnPage={firstOnPage}
              lastOnPage={lastOnPage}
              total={plans.length}
              noun="plan"
            />
          </div>
        )}
      </Panel>
    </div>
  );
};

export default MyPlansTab;
