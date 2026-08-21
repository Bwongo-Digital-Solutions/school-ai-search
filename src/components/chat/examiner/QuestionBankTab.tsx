import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FilePlus2, Trash2 } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { callDigitalExaminer } from '@/lib/teaching';
import { EmptyState, Panel, PrimaryButton, SecondaryButton } from '../fees/shared';
import { QuestionCard } from './shared';
import type { ExamQuestion } from '@/types/teaching';

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
        <Panel className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-indigo-200 dark:border-indigo-800">
          <p className="text-sm text-gray-700 dark:text-gray-200">
            <span className="font-semibold">{selectedIds.length}</span> selected · {selectedMarks} marks
          </p>
          <PrimaryButton onClick={onAssemble} disabled={Boolean(busy)}>
            <FilePlus2 className="w-4 h-4" /> Assemble into a paper
          </PrimaryButton>
        </Panel>
      )}

      {visible.length === 0 ? (
        <Panel>
          <EmptyState message="No questions match. Generate some from the Generate tab, or widen the filters — newly generated questions start as “Awaiting review”." />
        </Panel>
      ) : (
        <div className="space-y-3">
          {visible.map(question => (
            <div key={question.id} className="flex gap-3">
              <label className="pt-4 shrink-0">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(question.id)}
                  onChange={() => onToggleSelected(question.id)}
                  disabled={question.status === 'retired'}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                  title={question.status === 'retired' ? 'Retired questions cannot go on a paper' : 'Select for a paper'}
                />
              </label>
              <div className="flex-1 min-w-0">
                <QuestionCard
                  question={question}
                  actions={
                    <>
                      {question.status !== 'approved' && (
                        <SecondaryButton onClick={() => setStatus(question, 'approved')} disabled={Boolean(busy)}>
                          <CheckCircle2 className="w-4 h-4" /> Approve
                        </SecondaryButton>
                      )}
                      {question.status !== 'retired' && (
                        <SecondaryButton
                          onClick={() => setStatus(question, 'retired')}
                          disabled={Boolean(busy)}
                          className="text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        >
                          Retire
                        </SecondaryButton>
                      )}
                      <SecondaryButton
                        onClick={() => {
                          if (!window.confirm('Delete this question permanently?')) return;
                          runAction('Deleting the question', async () => {
                            await callDigitalExaminer('delete_question', { id: question.id }, user);
                            await load();
                            onChanged();
                          });
                        }}
                        disabled={Boolean(busy)}
                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4" />
                      </SecondaryButton>
                    </>
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuestionBankTab;
