import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callDigitalExaminer } from '@/lib/teaching';
import { TablePager } from '@/components/common';
import { usePagedRows } from '@/hooks/usePagedRows';
import { DangerButton, EmptyState, GhostButton, Panel, PrimaryButton, SecondaryButton } from '../fees/shared';
import { QuestionCard } from './shared';
import type { ExamQuestion } from '@/types/teaching';
import styles from '../tabs.module.scss';
import { CheckmarkFilled, DocumentAdd, TrashCan } from '@carbon/react/icons';
import { Checkbox } from '@carbon/react';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
  refreshKey: number;
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
  onAssemble: () => void;
}

const STATUS_FILTER = [
  { value: '', label: 'Any status' },
  { value: 'draft', label: 'Awaiting review' },
  { value: 'approved', label: 'Approved' },
  { value: 'retired', label: 'Retired' },
];

/**
 * The reusable bank. Questions outlive the paper they were written for, so this is where a teacher
 * curates them across terms — and where a paper's questions are picked.
 */
const QuestionBankTab: React.FC<Props> = ({
  runAction,
  onChanged,
  busy,
  refreshKey,
  selectedIds,
  onToggleSelected,
  onAssemble,
}) => {
  const { confirm } = useNotifications();
  const { user } = useAuth();
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [filters, setFilters] = useState({ status: 'approved', topic: '', subjectName: '' });

  const load = useCallback(async () => {
    try {
      const result = await callDigitalExaminer<{ questions: ExamQuestion[] }>(
        'list_questions',
        { status: filters.status, topic: filters.topic },
        user,
      );
      setQuestions(result.questions);
    } catch (err) {
      console.error('Failed to load the question bank:', err);
    }
  }, [filters.status, filters.topic, user]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Subject is a free-text field on a question, so a substring match reads better here than the
  // exact match the endpoint applies.
  const visible = useMemo(() => {
    const needle = filters.subjectName.trim().toLowerCase();
    return needle ? questions.filter(question => question.subject_name.toLowerCase().includes(needle)) : questions;
  }, [filters.subjectName, questions]);

  // Ten a page, not the twenty-five the tables use: these are full question cards with a stem, the
  // options and a row of actions, so twenty-five is a scroll long enough to lose the filters at the
  // top of the screen.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(visible, 10);

  // Counted over the whole bank rather than the page. A selection survives paging — picking six
  // questions across three pages is the ordinary way to build a paper — so the marks total has to
  // count all six or it contradicts the number of questions beside it.
  const selectedMarks = useMemo(
    () => visible.filter(question => selectedIds.includes(question.id)).reduce((total, q) => total + q.marks, 0),
    [selectedIds, visible],
  );

  const setStatus = useCallback(
    (question: ExamQuestion, status: string) =>
      runAction(`Marking the question ${status}`, async () => {
        await callDigitalExaminer('set_question_status', { id: question.id, status }, user);
        await load();
        onChanged();
      }),
    [load, onChanged, runAction, user],
  );

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
            label="Topic"
            value={filters.topic}
            onChange={value => setFilters({ ...filters, topic: String(value ?? '') })}
            placeholder="Any topic"
 />
          <Field
            label="Subject"
            value={filters.subjectName}
            onChange={value => setFilters({ ...filters, subjectName: String(value ?? '') })}
            placeholder="Any subject"
 />
        </div>
      </Panel>

      {selectedIds.length > 0 && (
        <Panel className={styles.rowPadBrand}>
          <p className={styles.primary}>
            <span className={styles.strong}>{selectedIds.length}</span> selected · {selectedMarks} marks
          </p>
          <PrimaryButton onClick={onAssemble} disabled={Boolean(busy)}>
            <DocumentAdd size={16} /> Assemble into a paper
          </PrimaryButton>
        </Panel>
      )}

      {visible.length === 0 ? (
        <Panel>
          <EmptyState message="No questions match. Generate some from the Generate tab, or widen the filters — newly generated questions start as “Awaiting review”." />
        </Panel>
      ) : (
        <div className={styles.stackTight}>
          {pageRows.map(question => (
            <div key={question.id} className={styles.actions}>
              <Checkbox
                id={`select-${question.id}`}
                labelText=""
                checked={selectedIds.includes(question.id)}
                onChange={() => onToggleSelected(question.id)}
                disabled={question.status === 'retired'}
                title={
                  question.status === 'retired'
                    ? 'Retired questions cannot go on a paper'
                    : 'Select for a paper'
                }
              />
              <div className={styles.grow}>
                <QuestionCard
                  question={question}
                  actions={
                    <>
                      {question.status !== 'approved' && (
                        <SecondaryButton onClick={() => setStatus(question, 'approved')} disabled={Boolean(busy)}>
                          <CheckmarkFilled size={16} /> Approve
                        </SecondaryButton>
                      )}
                      {question.status !== 'retired' && (
                        <GhostButton
                          onClick={() => setStatus(question, 'retired')}
                          disabled={Boolean(busy)}

                        >
                          Retire
                        </GhostButton>
                      )}
                      <DangerButton
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: 'Delete this question?',
                              message: 'It is removed from the bank permanently. Papers already built keep their copy.',
                              confirmLabel: 'Delete',
                              danger: true,
                            }))
                          ) {
                            return;
                          }
                          runAction('Deleting the question', async () => {
                            await callDigitalExaminer('delete_question', { id: question.id }, user);
                            await load();
                            onChanged();
                          });
                        }}
                        disabled={Boolean(busy)}

                      >
                        <TrashCan size={16} />
                      </DangerButton>
                    </>
                  }
 />
              </div>
            </div>
          ))}
        </div>
      )}

      {visible.length > 0 && (
        <div className={styles.tableFoot}>
          <TablePager
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
            firstOnPage={firstOnPage}
            lastOnPage={lastOnPage}
            total={visible.length}
            noun="question"
          />
        </div>
      )}
    </div>
  );
};

export default QuestionBankTab;
