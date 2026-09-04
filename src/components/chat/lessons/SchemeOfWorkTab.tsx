import React, { useCallback, useMemo, useState } from 'react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callLessonPlanner, gradeOptionsFor } from '@/lib/teaching';
import { EmptyState, Panel, PrimaryButton } from '../fees/shared';
import { StatusBadge, LESSON_STATUS_STYLES, TERM_OPTIONS, currentAcademicYear } from './shared';
import type { CurriculumFramework, LessonPlan } from '@/types/teaching';
import styles from '../tabs.module.scss';
import { Ai, Calendar, Warning } from '@carbon/react/icons';

interface Props {
  frameworks: CurriculumFramework[];
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
}

interface SchemeResult {
  plans: LessonPlan[];
  failures: { topic: string; reason: string }[];
}

/**
 * Plans a whole term at once: one lesson per topic, in the order the teacher lists them.
 *
 * Generation runs a topic at a time on the server, so a topic the syllabus does not cover fails on
 * its own and is reported here rather than losing the rest of the term's work.
 */
const SchemeOfWorkTab: React.FC<Props> = ({ frameworks, runAction, onChanged, busy }) => {
  const { user } = useAuth();
  const { aiModels, selectedModelId } = useChatContext();

  const [form, setForm] = useState({
    curriculum: 'uganda-cbc-lower-secondary',
    subjectName: 'Biology',
    gradeLevel: '9',
    academicYear: currentAcademicYear(),
    term: 'Term 1',
    durationMinutes: 40,
  });
  const [topicText, setTopicText] = useState('');
  const [result, setResult] = useState<SchemeResult | null>(null);

  const framework = useMemo(
    () => frameworks.find(entry => entry.id === form.curriculum),
    [frameworks, form.curriculum],
  );

  const topics = useMemo(
    () => topicText.split('\n').map(line => line.trim()).filter(Boolean),
    [topicText],
  );

  const set = (key: keyof typeof form) => (value: unknown) =>
    setForm(previous => ({ ...previous, [key]: value }));

  const activeModel = aiModels.find(model => model.id === selectedModelId);
  const canGenerate = Boolean(activeModel && activeModel.provider !== 'local_rules' && activeModel.configured);

  const generate = useCallback(
    () =>
      runAction(`Planning ${topics.length} lessons`, async () => {
        const response = await callLessonPlanner<SchemeResult>(
          'scheme_of_work',
          { ...form, topics, modelId: selectedModelId },
          user,
        );
        setResult(response);
        onChanged();
      }),
    [form, onChanged, runAction, selectedModelId, topics, user],
  );

  return (
    <div className={styles.split}>
      <Panel className={styles.padFit}>
        <h3 className={styles.subheading}>
          <Calendar size={16} /> Term scope
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
          <Field label="Subject" value={form.subjectName} onChange={set('subjectName')} />
          <div className={styles.grid2}>
            <Field label="Academic year" value={form.academicYear} onChange={set('academicYear')} />
            <Field
              label="Term"
              value={form.term}
              onChange={set('term')}
              options={TERM_OPTIONS.filter(option => option.value)}
 />
          </div>
          <Field
            label="Lesson length (minutes)"
            type="number"
            min={15}
            max={200}
            value={form.durationMinutes}
            onChange={set('durationMinutes')}
 />
          <Field
            label="Topics"
            type="textarea"
            value={topicText}
            onChange={value => setTopicText(String(value ?? ''))}
            hint={`One topic per line, in teaching order. ${topics.length} listed (maximum 20).`}
 />
        </div>

        <PrimaryButton
          className={styles.fullWidth}
          onClick={generate}
          disabled={Boolean(busy) || topics.length === 0 || topics.length > 20 || !canGenerate}
        >
          <Ai size={16} /> Plan the term
        </PrimaryButton>

        {!canGenerate && (
          <p className={styles.warn}>
            Pick a configured AI model in the chat composer first.
          </p>
        )}
        {topics.length > 0 && canGenerate && (
          <p className={styles.note}>
            This drafts {topics.length} full lesson{topics.length === 1 ? '' : 's'} and may take a minute.
          </p>
        )}
      </Panel>

      <Panel className={styles.pad}>
        {!result ? (
          <EmptyState message="List the topics for the term, one per line, and press “Plan the term”. Each topic becomes its own lesson plan you can then edit." />
        ) : (
          <div className={styles.stack}>
            <div>
              <p className={styles.subheading}>
                {result.plans.length} lesson{result.plans.length === 1 ? '' : 's'} drafted
              </p>
              <p className={styles.note}>Open My Plans to edit, approve and export them.</p>
            </div>

            <ol className={styles.stackTight}>
              {result.plans.map((plan, index) => (
                <li
                  key={plan.id}
                  className={styles.boxRow}
                >
                  <span className={styles.index}>
                    {index + 1}
                  </span>
                  <div className={styles.grow}>
                    <p className={styles.strong}>{plan.title}</p>
                    <p className={styles.note}>
                      {plan.topic} · {plan.activities.length} stages · {plan.refs.length} source
                      {plan.refs.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <StatusBadge status={plan.status} styles={LESSON_STATUS_STYLES} />
                </li>
              ))}
            </ol>

            {result.failures.length > 0 && (
              <div className={styles.calloutWarn}>
                <p className={styles.calloutTitle}>
                  <Warning size={16} />
                  {result.failures.length} topic{result.failures.length === 1 ? '' : 's'} could not be planned
                </p>
                <ul className={styles.stackTight}>
                  {result.failures.map(failure => (
                    <li key={failure.topic}>
                      <span className={styles.strong}>{failure.topic}:</span> {failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
};

export default SchemeOfWorkTab;
