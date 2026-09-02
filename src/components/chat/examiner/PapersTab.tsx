import React, { useCallback, useEffect, useState } from 'react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callDigitalExaminer, teachingDocumentUrl } from '@/lib/teaching';
import { downloadFromUrl } from '@/lib/download';
import { TablePager } from '@/components/common';
import { usePagedRows } from '@/hooks/usePagedRows';
import { DangerButton, EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from '../fees/shared';
import { currentAcademicYear } from '../lessons/shared';
import type { ExamQuestion, GeneratedPaper } from '@/types/teaching';
import styles from '../tabs.module.scss';
import { Calendar, Document, DocumentDownload, Send, TrashCan } from '@carbon/react/icons';
import { Tag } from '@carbon/react';

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
  const { confirm } = useNotifications();
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

  // Papers are never retired — every test and exam a teacher has ever assembled stays here — so this
  // is the list in the examiner that grows without end.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(papers, 25);

  return (
    <div className={styles.stack}>
      {pendingQuestionIds.length > 0 && (
        <Panel className={styles.padBrand}>
          <h3 className={styles.subheading}>
            <Document size={16} />
            Assemble {pendingQuestionIds.length} selected question{pendingQuestionIds.length === 1 ? '' : 's'}
          </h3>
          <div className={styles.grid4}>
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
          <div >
            <Field
              label="Instructions to candidates"
              type="textarea"
              value={assembleForm.instructions}
              onChange={value => setAssembleForm({ ...assembleForm, instructions: String(value ?? '') })}
 />
          </div>
          <PrimaryButton onClick={assemble} disabled={Boolean(busy) || !assembleForm.title.trim()}>
            <Document size={16} /> Create paper
          </PrimaryButton>
          <p className={styles.note}>
            Total marks are summed from the questions themselves, so the printed total always matches the paper.
          </p>
        </Panel>
      )}

      <Panel>
        {papers.length === 0 ? (
          <EmptyState message="No papers yet. Select approved questions in the Question Bank and assemble them into a paper." />
        ) : (
          <div className={styles.rows}>
            {pageRows.map(paper => (
              <div key={paper.id} className={zebra}>
                <div className={styles.rowPadBetween}>
                  <button type="button" onClick={() => open(paper)} className={styles.grow}>
                    <p className={styles.strong}>{paper.title}</p>
                    <p className={styles.note}>
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

                  <div className={styles.actions}>
                    <Tag
                      type={paper.status === 'published' ? 'green' : 'cool-gray'}
                      size="sm"
                      renderIcon={paper.status === 'published' ? Calendar : undefined}
                    >
                      {paper.status === 'published' ? 'Published' : 'Draft'}
                    </Tag>

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
                      <DocumentDownload size={16} /> Paper
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
                      <DocumentDownload size={16} /> Scheme
                    </SecondaryButton>
                    <DangerButton
                      onClick={async () => {
                        if (
                          !(await confirm({
                            title: 'Delete this paper?',
                            message: `“${paper.title}” will be removed. Its questions stay in the bank.`,
                            confirmLabel: 'Delete',
                            danger: true,
                          }))
                        ) {
                          return;
                        }
                        runAction('Deleting the paper', async () => {
                          await callDigitalExaminer('delete_paper', { id: paper.id }, user);
                          await load();
                          onChanged();
                        });
                      }}
                      disabled={Boolean(busy)}

                    >
                      <TrashCan size={16} />
                    </DangerButton>
                  </div>
                </div>

                {expanded?.paper.id === paper.id && (
                  <div className={styles.padBody}>
                    <ol className={styles.stackTight}>
                      {expanded.questions.map((question, index) => (
                        <li key={question.id} className={styles.noteRow}>
                          <span className={styles.index}>{index + 1}.</span>
                          <span className={styles.grow}>{question.stem}</span>
                          <span >[{question.marks}]</span>
                        </li>
                      ))}
                    </ol>

                    {paper.status === 'draft' ? (
                      <div className={styles.callout}>
                        <p className={styles.label}>
                          Publish into the school's exam records
                        </p>
                        <div className={styles.grid4}>
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
                        <PrimaryButton onClick={() => publish(paper)} disabled={Boolean(busy)}>
                          <Send size={16} /> Publish
                        </PrimaryButton>
                        <p className={styles.note}>
                          Every question must be approved first. Publishing creates a real exam the gradebook and
                          timetable can see.
                        </p>
                      </div>
                    ) : (
                      <p className={styles.positive}>
                        Published{paper.published_at ? ` on ${String(paper.published_at).slice(0, 10)}` : ''} · exam id{' '}
                        <code className={styles.note}>{paper.exam_id}</code>
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {papers.length > 0 && (
          <div className={styles.tableFoot}>
            <TablePager
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              firstOnPage={firstOnPage}
              lastOnPage={lastOnPage}
              total={papers.length}
              noun="paper"
            />
          </div>
        )}
      </Panel>
    </div>
  );
};

export default PapersTab;
