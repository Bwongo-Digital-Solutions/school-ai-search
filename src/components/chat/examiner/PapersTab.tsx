import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, FileDown, FileText, Send, Trash2 } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { callDigitalExaminer, teachingDocumentUrl } from '@/lib/teaching';
import { downloadFromUrl } from '@/lib/download';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from '../fees/shared';
import { currentAcademicYear } from '../lessons/shared';
import type { ExamQuestion, GeneratedPaper } from '@/types/teaching';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
  refreshKey: number;
  pendingQuestionIds: string[];
  onAssembled: () => void;
}

const slugify = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');

/**
 * Assembles selected questions into a paper, then publishes it into the school's real exam records.
 *
 * Publishing writes an exams row (and an exam_schedules row when a date and class are given), so the
 * gradebook, timetable and report cards see it like any other exam.
 */
const PapersTab: React.FC<Props> = ({ runAction, onChanged, busy, refreshKey, pendingQuestionIds, onAssembled }) => {
  const { user } = useAuth();
  const [papers, setPapers] = useState<GeneratedPaper[]>([]);
  const [expanded, setExpanded] = useState<{ paper: GeneratedPaper; questions: ExamQuestion[] } | null>(null);

  const [assembleForm, setAssembleForm] = useState({
    title: '',
    subjectName: '',
    gradeLevel: '',
    academicYear: currentAcademicYear(),
    term: 'Term 1',
    assessmentType: 'test',
    durationMinutes: 45,
    instructions: 'Answer all questions in the spaces provided.',
  });

  const [publishForm, setPublishForm] = useState({ examDate: '', startTime: '09:00', endTime: '10:30', room: '', classId: '' });

  const load = useCallback(async () => {
    try {
      const result = await callDigitalExaminer<{ papers: GeneratedPaper[] }>('list_papers', {}, user);
      setPapers(result.papers);
    } catch (err) {
      console.error('Failed to load papers:', err);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const assemble = useCallback(
    () =>
      runAction('Assembling the paper', async () => {
        await callDigitalExaminer(
          'assemble_paper',
          { ...assembleForm, questionIds: pendingQuestionIds },
          user,
        );
        setAssembleForm(previous => ({ ...previous, title: '' }));
        await load();
        onAssembled();
        onChanged();
      }),
    [assembleForm, load, onAssembled, onChanged, pendingQuestionIds, runAction, user],
  );

  const open = useCallback(
    (paper: GeneratedPaper) =>
      runAction('Opening the paper', async () => {
        if (expanded?.paper.id === paper.id) {
          setExpanded(null);
          return;
        }
        const result = await callDigitalExaminer<{ paper: GeneratedPaper; questions: ExamQuestion[] }>(
          'get_paper',
          { id: paper.id },
          user,
        );
        setExpanded(result);
      }),
    [expanded, runAction, user],
  );

  const publish = useCallback(
    (paper: GeneratedPaper) =>
      runAction('Publishing the paper', async () => {
        await callDigitalExaminer('publish_paper', { id: paper.id, ...publishForm }, user);
        await load();
        onChanged();
      }),
    [load, onChanged, publishForm, runAction, user],
  );

  return (
    <div className="space-y-4">
      {pendingQuestionIds.length > 0 && (
        <Panel className="p-4 border-indigo-200 dark:border-indigo-800">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-500" />
            Assemble {pendingQuestionIds.length} selected question{pendingQuestionIds.length === 1 ? '' : 's'}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Paper title"
              value={assembleForm.title}
              onChange={value => setAssembleForm({ ...assembleForm, title: String(value ?? '') })}
              placeholder="S2 Biology — Term 1 Test"
            />
            <Field
              label="Subject"
              value={assembleForm.subjectName}
              onChange={value => setAssembleForm({ ...assembleForm, subjectName: String(value ?? '') })}
            />
            <Field
              label="Grade level"
              type="number"
              value={assembleForm.gradeLevel}
              onChange={value => setAssembleForm({ ...assembleForm, gradeLevel: String(value ?? '') })}
            />
            <Field
              label="Duration (minutes)"
              type="number"
              min={5}
              value={assembleForm.durationMinutes}
              onChange={value => setAssembleForm({ ...assembleForm, durationMinutes: Number(value) })}
            />
          </div>
          <div className="mt-2">
            <Field
              label="Instructions to candidates"
              type="textarea"
              value={assembleForm.instructions}
              onChange={value => setAssembleForm({ ...assembleForm, instructions: String(value ?? '') })}
            />
          </div>
          <PrimaryButton className="mt-3" onClick={assemble} disabled={Boolean(busy) || !assembleForm.title.trim()}>
            <FileText className="w-4 h-4" /> Create paper
          </PrimaryButton>
          <p className="text-[11px] text-gray-400 mt-2">
            Total marks are summed from the questions themselves, so the printed total always matches the paper.
          </p>
        </Panel>
      )}

      <Panel>
        {papers.length === 0 ? (
          <EmptyState message="No papers yet. Select approved questions in the Question Bank and assemble them into a paper." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {papers.map(paper => (
              <div key={paper.id} className={zebra}>
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => open(paper)} className="text-left min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{paper.title}</p>
                    <p className="text-[11px] text-gray-400">
                      {[
                        paper.subject_name,
                        `${paper.question_ids.length} questions`,
                        `${paper.total_marks} marks`,
                        `${paper.duration_minutes} min`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        paper.status === 'published'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      {paper.status === 'published' ? <CalendarCheck className="w-2.5 h-2.5" /> : null}
                      {paper.status === 'published' ? 'Published' : 'Draft'}
                    </span>

                    <SecondaryButton
                      onClick={() =>
                        runAction('Building the question paper', async () => {
                          await downloadFromUrl(
                            teachingDocumentUrl(`/api/papers/${paper.id}.pdf`, user),
                            `${slugify(paper.title)}.pdf`,
                          );
                        })
                      }
                      disabled={Boolean(busy)}
                    >
                      <FileDown className="w-4 h-4" /> Paper
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() =>
                        runAction('Building the marking scheme', async () => {
                          await downloadFromUrl(
                            teachingDocumentUrl(`/api/papers/${paper.id}/marking-scheme.pdf`, user),
                            `${slugify(paper.title)}-marking-scheme.pdf`,
                          );
                        })
                      }
                      disabled={Boolean(busy)}
                    >
                      <FileDown className="w-4 h-4" /> Scheme
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() => {
                        if (!window.confirm(`Delete “${paper.title}”? The questions stay in the bank.`)) return;
                        runAction('Deleting the paper', async () => {
                          await callDigitalExaminer('delete_paper', { id: paper.id }, user);
                          await load();
                          onChanged();
                        });
                      }}
                      disabled={Boolean(busy)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </SecondaryButton>
                  </div>
                </div>

                {expanded?.paper.id === paper.id && (
                  <div className="px-4 pb-4">
                    <ol className="space-y-2 mb-4">
                      {expanded.questions.map((question, index) => (
                        <li key={question.id} className="text-xs text-gray-600 dark:text-gray-300 flex gap-2">
                          <span className="font-semibold text-indigo-500 shrink-0">{index + 1}.</span>
                          <span className="flex-1">{question.stem}</span>
                          <span className="text-gray-400 shrink-0">[{question.marks}]</span>
                        </li>
                      ))}
                    </ol>

                    {paper.status === 'draft' ? (
                      <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-2">
                          Publish into the school's exam records
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                          <Field
                            label="Exam date"
                            type="date"
                            value={publishForm.examDate}
                            onChange={value => setPublishForm({ ...publishForm, examDate: String(value ?? '') })}
                          />
                          <Field
                            label="Class id"
                            value={publishForm.classId}
                            onChange={value => setPublishForm({ ...publishForm, classId: String(value ?? '') })}
                            hint="Optional"
                          />
                          <Field
                            label="Start"
                            value={publishForm.startTime}
                            onChange={value => setPublishForm({ ...publishForm, startTime: String(value ?? '') })}
                          />
                          <Field
                            label="End"
                            value={publishForm.endTime}
                            onChange={value => setPublishForm({ ...publishForm, endTime: String(value ?? '') })}
                          />
                          <Field
                            label="Room"
                            value={publishForm.room}
                            onChange={value => setPublishForm({ ...publishForm, room: String(value ?? '') })}
                          />
                        </div>
                        <PrimaryButton className="mt-3" onClick={() => publish(paper)} disabled={Boolean(busy)}>
                          <Send className="w-4 h-4" /> Publish
                        </PrimaryButton>
                        <p className="text-[11px] text-gray-400 mt-2">
                          Every question must be approved first. Publishing creates a real exam the gradebook and
                          timetable can see.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        Published{paper.published_at ? ` on ${String(paper.published_at).slice(0, 10)}` : ''} · exam id{' '}
                        <code className="text-gray-500">{paper.exam_id}</code>
                      </p>
                    )}
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

export default PapersTab;
