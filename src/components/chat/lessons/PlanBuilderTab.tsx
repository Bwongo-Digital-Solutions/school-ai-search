import React, { useCallback, useMemo, useState } from 'react';
import { Clock, FileDown, Save, Sparkles, Wand2 } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callLessonPlanner, gradeOptionsFor, teachingDocumentUrl } from '@/lib/teaching';
import { downloadFromUrl } from '@/lib/download';
import { EmptyState, Panel, PrimaryButton, SecondaryButton } from '../fees/shared';
import { CitationList, StatusBadge, LESSON_STATUS_STYLES, TERM_OPTIONS, currentAcademicYear } from './shared';
import type { CurriculumFramework, LessonPlan } from '@/types/teaching';

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
    <div className="grid gap-4 lg:grid-cols-[340px,1fr]">
      <Panel className="p-4 h-fit">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-indigo-500" /> Lesson details
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

          <div className="grid grid-cols-2 gap-2">
            <Field label="Academic year" value={form.academicYear} onChange={set('academicYear')} />
            <Field
              label="Term"
              value={form.term}
              onChange={set('term')}
              options={TERM_OPTIONS.filter(option => option.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Date (optional)" type="date" value={form.lessonDate} onChange={set('lessonDate')} />
            <Field label="Period (optional)" value={form.period} onChange={set('period')} placeholder="Period 3" />
          </div>
        </div>

        <PrimaryButton
          className="w-full mt-4 justify-center"
          onClick={generate}
          disabled={Boolean(busy) || !form.topic.trim() || !canGenerate}
        >
          <Sparkles className="w-4 h-4" /> Draft this lesson
        </PrimaryButton>

        {!canGenerate && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            Pick a configured AI model in the chat composer first — the Local Rules engine can only search
            student records.
          </p>
        )}
      </Panel>

      <Panel className="p-4">
        {!plan ? (
          <EmptyState message="Fill in the lesson details and press “Draft this lesson”. The plan is written from your school's curriculum library, and every draft cites the syllabus passages it came from." />
        ) : (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-700">
              <div className="min-w-0">
                <input
                  value={plan.title}
                  onChange={event => setPlan({ ...plan, title: event.target.value })}
                  className="w-full bg-transparent text-base font-semibold text-gray-800 dark:text-white border-none outline-none focus:bg-gray-50 dark:focus:bg-gray-700 rounded px-1 -mx-1"
                />
                <p className="text-xs text-gray-400 mt-0.5">
                  {plan.subject_name} · {plan.topic} · {plan.duration_minutes} minutes
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={plan.status} styles={LESSON_STATUS_STYLES} />
                {totalMinutes !== plan.duration_minutes && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <Clock className="w-3 h-3" /> stages total {totalMinutes} min
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-4">
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
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Lesson sequence
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[520px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                        <th className="pb-1 pr-2 w-28">Stage</th>
                        <th className="pb-1 pr-2">Teacher does</th>
                        <th className="pb-1">Learners do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.activities.map((activity, index) => (
                        <tr key={index} className="align-top border-t border-gray-100 dark:border-gray-700">
                          <td className="py-2 pr-2 font-medium text-gray-700 dark:text-gray-200">
                            {activity.stage}
                            <span className="block text-[10px] text-gray-400">{activity.minutes} min</span>
                          </td>
                          <td className="py-2 pr-2 text-gray-600 dark:text-gray-300">
                            {activity.teacherActivity || activity.teacher_activity}
                          </td>
                          <td className="py-2 text-gray-600 dark:text-gray-300">
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Assessment</p>
                  <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
                    {plan.assessment.map((entry, index) => (
                      <li key={index}>
                        <span className="font-medium">{entry.method}:</span> {entry.description}
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

            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
              <PrimaryButton onClick={saveEdits} disabled={Boolean(busy)}>
                <Save className="w-4 h-4" /> Save changes
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
                <FileDown className="w-4 h-4" /> Export PDF
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
