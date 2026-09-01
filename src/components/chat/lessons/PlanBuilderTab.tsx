import React, { useCallback, useMemo, useState } from 'react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callLessonPlanner, gradeOptionsFor, teachingDocumentUrl } from '@/lib/teaching';
import { downloadFromUrl } from '@/lib/download';
import { EmptyState, Panel, PrimaryButton, SecondaryButton } from '../fees/shared';
import { CitationList, StatusBadge, LESSON_STATUS_STYLES, TERM_OPTIONS, currentAcademicYear } from './shared';
import type { CurriculumFramework, LessonPlan } from '@/types/teaching';
import styles from '../tabs.module.scss';
import { Ai, DocumentDownload, MagicWand, Save, Time } from '@carbon/react/icons';

interface Props {
  frameworks: CurriculumFramework[];
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
}

/**
 * The fine-tuning form: curriculum, year, subject, topic and lesson length go in, a full draft
 * comes back. The draft is editable in place, because a generated plan is a starting point a
 * teacher adapts to their class, not something to accept or discard whole.
 */
const PlanBuilderTab: React.FC<Props> = ({ frameworks, runAction, onChanged, busy }) => {
  const { user } = useAuth();
  const { aiModels, selectedModelId } = useChatContext();

  const [form, setForm] = useState({
    curriculum: 'uganda-cbc-lower-secondary',
    subjectName: 'Biology',
    gradeLevel: '9',
    topic: '',
    subtopic: '',
    durationMinutes: 40,
    academicYear: currentAcademicYear(),
    term: 'Term 1',
    lessonDate: '',
    period: '',
  });
  const [plan, setPlan] = useState<LessonPlan | null>(null);

  const framework = useMemo(
    () => frameworks.find(entry => entry.id === form.curriculum),
    [frameworks, form.curriculum],
  );

  const set = (key: keyof typeof form) => (value: unknown) =>
    setForm(previous => ({ ...previous, [key]: value }));

  // The Local Rules engine cannot generate; steer the teacher to a real model before they try.
  const activeModel = aiModels.find(model => model.id === selectedModelId);
  const canGenerate = Boolean(activeModel && activeModel.provider !== 'local_rules' && activeModel.configured);

  const generate = useCallback(
    () =>
      runAction('Drafting the lesson plan', async () => {
        const result = await callLessonPlanner<{ plan: LessonPlan }>(
          'generate',
          { ...form, modelId: selectedModelId },
          user,
        );
        setPlan(result.plan);
        onChanged();
      }),
    [form, onChanged, runAction, selectedModelId, user],
  );

  const saveEdits = useCallback(
    () =>
      runAction('Saving the lesson plan', async () => {
        if (!plan) return;
        const result = await callLessonPlanner<{ plan: LessonPlan }>(
          'save',
          {
            id: plan.id,
            title: plan.title,
            topic: plan.topic,
            subtopic: plan.subtopic,
            curriculum: plan.curriculum,
            subjectName: plan.subject_name,
            gradeLevel: plan.grade_level,
            academicYear: plan.academic_year,
            term: plan.term,
            durationMinutes: plan.duration_minutes,
            lessonDate: plan.lesson_date,
            period: plan.period,
            competencies: plan.competencies,
            learningOutcomes: plan.learning_outcomes,
            materials: plan.materials,
            activities: plan.activities,
            assessment: plan.assessment,
            differentiation: plan.differentiation,
            homework: plan.homework,
          },
          user,
        );
        setPlan(result.plan);
        onChanged();
      }),
    [onChanged, plan, runAction, user],
  );

  const approve = useCallback(
    () =>
      runAction('Approving the lesson plan', async () => {
        if (!plan) return;
        const result = await callLessonPlanner<{ plan: LessonPlan }>(
          'set_status',
          { id: plan.id, status: 'approved' },
          user,
        );
        setPlan(result.plan);
        onChanged();
      }),
    [onChanged, plan, runAction, user],
  );

  const totalMinutes = (plan?.activities || []).reduce((total, activity) => total + Number(activity.minutes || 0), 0);

  return (
    <div className={styles.split}>
      <Panel className={styles.padFit}>
        <h3 className={styles.subheading}>
          <MagicWand size={16} /> Lesson details
        </h3>

        <div className={styles.stackTight}>
          <Field
            label="Curriculum"
            value={form.curriculum}
            onChange={set('curriculum')}
            options={frameworks.map(entry => ({ value: entry.id, label: entry.label }))}
 />
          <Field
            label="Year / class"
            value={form.gradeLevel}
            onChange={set('gradeLevel')}
            options={gradeOptionsFor(framework)}
 />
          <Field label="Subject" value={form.subjectName} onChange={set('subjectName')} placeholder="Biology" />
          <Field
            label="Topic"
            value={form.topic}
            onChange={set('topic')}
            placeholder="Photosynthesis"
            hint="The syllabus topic this lesson covers."
 />
          <Field label="Focus (optional)" value={form.subtopic} onChange={set('subtopic')} placeholder="Limiting factors" />
          <Field
            label="Lesson length (minutes)"
            type="number"
            min={15}
            max={200}
            value={form.durationMinutes}
            onChange={set('durationMinutes')}
 />

          <div className={styles.grid2}>
            <Field label="Academic year" value={form.academicYear} onChange={set('academicYear')} />
            <Field
              label="Term"
              value={form.term}
              onChange={set('term')}
              options={TERM_OPTIONS.filter(option => option.value)}
 />
          </div>

          <div className={styles.grid2}>
            <Field label="Date (optional)" type="date" value={form.lessonDate} onChange={set('lessonDate')} />
            <Field label="Period (optional)" value={form.period} onChange={set('period')} placeholder="Period 3" />
          </div>
        </div>

        <PrimaryButton
          className={styles.fullWidth}
          onClick={generate}
          disabled={Boolean(busy) || !form.topic.trim() || !canGenerate}
        >
          <Ai size={16} /> Draft this lesson
        </PrimaryButton>

        {!canGenerate && (
          <p className={styles.warn}>
            Pick a configured AI model in the chat composer first — the Local Rules engine can only search
            student records.
          </p>
        )}
      </Panel>

      <Panel className={styles.pad}>
        {!plan ? (
          <EmptyState message="Fill in the lesson details and press “Draft this lesson”. The plan is written from your school's curriculum library, and every draft cites the syllabus passages it came from." />
        ) : (
          <div>
            <div className={styles.betweenTopRule}>
              <div className={styles.rowMain}>
                {/* The plan's title is edited in place, where it reads as the heading it is —
                    a labelled field above it would say "Title" over something that already says so. */}
                <input
                  value={plan.title}
                  onChange={event => setPlan({ ...plan, title: event.target.value })}
                  className={styles.inlineTitle}
                  aria-label="Lesson plan title"
                />
                <p className={styles.note}>
                  {plan.subject_name} · {plan.topic} · {plan.duration_minutes} minutes
                </p>
              </div>
              <div className={styles.actions}>
                <StatusBadge status={plan.status} styles={LESSON_STATUS_STYLES} />
                {totalMinutes !== plan.duration_minutes && (
                  <span className={styles.warn}>
                    <Time size={16} /> stages total {totalMinutes} min
                  </span>
                )}
              </div>
            </div>

            <div className={styles.stack}>
              <EditableList
                label="Learning outcomes"
                items={plan.learning_outcomes}
                onChange={items => setPlan({ ...plan, learning_outcomes: items })}
 />
              <EditableList
                label="Competencies"
                items={plan.competencies}
                onChange={items => setPlan({ ...plan, competencies: items })}
 />
              <EditableList
                label="Teaching aids"
                items={plan.materials}
                onChange={items => setPlan({ ...plan, materials: items })}
 />

              <div>
                <p className={styles.label}>
                  Lesson sequence
                </p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr className={styles.thead}>
                        <th className={styles.th}>Stage</th>
                        <th>Teacher does</th>
                        <th>Learners do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.activities.map((activity, index) => (
                        <tr key={index} className={styles.tdTop}>
                          <td className={styles.tdStrong}>
                            {activity.stage}
                            <span className={styles.label}>{activity.minutes} min</span>
                          </td>
                          <td className={styles.td}>
                            {activity.teacherActivity || activity.teacher_activity}
                          </td>
                          <td className={styles.td}>
                            {activity.learnerActivity || activity.learner_activity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {plan.assessment.length > 0 && (
                <div>
                  <p className={styles.label}>Assessment</p>
                  <ul className={styles.stackTight}>
                    {plan.assessment.map((entry, index) => (
                      <li key={index}>
                        <span className={styles.strong}>{entry.method}:</span> {entry.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Field
                label="Differentiation"
                type="textarea"
                value={plan.differentiation}
                onChange={value => setPlan({ ...plan, differentiation: String(value ?? '') })}
 />
              <Field
                label="Homework"
                type="textarea"
                value={plan.homework}
                onChange={value => setPlan({ ...plan, homework: String(value ?? '') })}
 />

              <CitationList citations={plan.refs} />
            </div>

            <div className={styles.actionsRule}>
              <PrimaryButton onClick={saveEdits} disabled={Boolean(busy)}>
                <Save size={16} /> Save changes
              </PrimaryButton>
              {plan.status !== 'approved' && (
                <SecondaryButton onClick={approve} disabled={Boolean(busy)}>
                  Approve
                </SecondaryButton>
              )}
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
                <DocumentDownload size={16} /> Export PDF
              </SecondaryButton>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
};

/** A list of short strings edited as one textarea, one item per line. */
const EditableList = ({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) => (
  <Field
    label={label}
    type="textarea"
    value={(items || []).join('\n')}
    onChange={value =>
      onChange(
        String(value ?? '')
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean),
      )
    }
    hint="One per line."
 />
);

export default PlanBuilderTab;
