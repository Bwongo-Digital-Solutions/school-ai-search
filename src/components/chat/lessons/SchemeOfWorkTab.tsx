import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, Sparkles } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callLessonPlanner, gradeOptionsFor } from '@/lib/teaching';
import { EmptyState, Panel, PrimaryButton } from '../fees/shared';
import { StatusBadge, LESSON_STATUS_STYLES, TERM_OPTIONS, currentAcademicYear } from './shared';
import type { CurriculumFramework, LessonPlan } from '@/types/teaching';

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
    <div className="grid gap-4 lg:grid-cols-[340px,1fr]">
      <Panel className="p-4 h-fit">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-indigo-500" /> Term scope
        </h3>

        <div className="space-y-3">
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
          <div className="grid grid-cols-2 gap-2">
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
          className="w-full mt-4 justify-center"
          onClick={generate}
          disabled={Boolean(busy) || topics.length === 0 || topics.length > 20 || !canGenerate}
        >
          <Sparkles className="w-4 h-4" /> Plan the term
        </PrimaryButton>

        {!canGenerate && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            Pick a configured AI model in the chat composer first.
          </p>
        )}
        {topics.length > 0 && canGenerate && (
          <p className="text-[11px] text-gray-400 mt-2">
            This drafts {topics.length} full lesson{topics.length === 1 ? '' : 's'} and may take a minute.
          </p>
        )}
      </Panel>

      <Panel className="p-4">
        {!result ? (
          <EmptyState message="List the topics for the term, one per line, and press “Plan the term”. Each topic becomes its own lesson plan you can then edit." />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-white">
                {result.plans.length} lesson{result.plans.length === 1 ? '' : 's'} drafted
              </p>
              <p className="text-xs text-gray-400">Open My Plans to edit, approve and export them.</p>
            </div>

            <ol className="space-y-2">
              {result.plans.map((plan, index) => (
                <li
                  key={plan.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-700"
                >
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[11px] font-semibold flex items-center justify-center">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-white">{plan.title}</p>
                    <p className="text-[11px] text-gray-400">
                      {plan.topic} · {plan.activities.length} stages · {plan.refs.length} source
                      {plan.refs.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <StatusBadge status={plan.status} styles={LESSON_STATUS_STYLES} />
                </li>
              ))}
            </ol>

            {result.failures.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {result.failures.length} topic{result.failures.length === 1 ? '' : 's'} could not be planned
                </p>
                <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-300">
                  {result.failures.map(failure => (
                    <li key={failure.topic}>
                      <span className="font-medium">{failure.topic}:</span> {failure.reason}
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
