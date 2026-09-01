import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callDigitalExaminer, gradeOptionsFor } from '@/lib/teaching';
import { DangerButton, EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from '../fees/shared';
import { TERM_OPTIONS, currentAcademicYear } from '../lessons/shared';
import { MixEditor } from './shared';
import type { CurriculumFramework, ExamBlueprint } from '@/types/teaching';
import styles from '../tabs.module.scss';
import { Layers, Save, TrashCan } from '@carbon/react/icons';

interface Props {
  frameworks: CurriculumFramework[];
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
  refreshKey: number;
  onUseBlueprint: (blueprint: ExamBlueprint) => void;
}

const ASSESSMENT_TYPES = [
  { value: 'quiz', label: 'Quiz' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'test', label: 'Class test' },
  { value: 'exam', label: 'Exam' },
  { value: 'mock', label: 'Mock exam' },
];

const emptyForm = () => ({
  id: '',
  name: '',
  curriculum: 'uganda-cbc-lower-secondary',
  subjectName: 'Biology',
  gradeLevel: '9',
  academicYear: currentAcademicYear(),
  term: 'Term 1',
  assessmentType: 'test',
  durationMinutes: 90,
  totalMarks: 100,
});

/**
 * The fine-tuning panel. A blueprint fixes what a paper is — curriculum, year, subject, grade — and
 * how its marks are spread across topics, difficulty, Bloom levels and question types. Generation
 * reads it, so tuning here changes every paper produced from it.
 */
const BlueprintTab: React.FC<Props> = ({ frameworks, runAction, onChanged, busy, refreshKey, onUseBlueprint }) => {
  const { confirm } = useNotifications();
  const { user } = useAuth();
  const [blueprints, setBlueprints] = useState<ExamBlueprint[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [topicText, setTopicText] = useState('');
  const [difficultyMix, setDifficultyMix] = useState<Record<string, number>>({ easy: 3, moderate: 5, challenging: 2 });
  const [bloomMix, setBloomMix] = useState<Record<string, number>>({ remember: 2, understand: 3, apply: 3, analyse: 2 });
  const [typeMix, setTypeMix] = useState<Record<string, number>>({});

  const framework = useMemo(
    () => frameworks.find(entry => entry.id === form.curriculum),
    [frameworks, form.curriculum],
  );

  const load = useCallback(async () => {
    try {
      const result = await callDigitalExaminer<{ blueprints: ExamBlueprint[] }>('list_blueprints', {}, user);
      setBlueprints(result.blueprints);
    } catch (err) {
      console.error('Failed to load blueprints:', err);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Question types come from the chosen framework, so an IGCSE blueprint cannot ask for a question
  // shape that examiner never sets.
  useEffect(() => {
    if (!framework) return;
    setTypeMix(previous => {
      const allowed = new Set(framework.questionTypes);
      const kept = Object.fromEntries(Object.entries(previous).filter(([key]) => allowed.has(key)));
      return Object.keys(kept).length > 0 ? kept : { [framework.questionTypes[0]]: 5 };
    });
  }, [framework]);

  const set = (key: keyof ReturnType<typeof emptyForm>) => (value: unknown) =>
    setForm(previous => ({ ...previous, [key]: value }));

  const topics = useMemo(
    () => topicText.split('\n').map(line => line.trim()).filter(Boolean),
    [topicText],
  );

  const save = useCallback(
    () =>
      runAction('Saving the blueprint', async () => {
        await callDigitalExaminer(
          'save_blueprint',
          {
            ...form,
            topicWeights: topics.map(topic => ({ topic, weight: 1 })),
            difficultyMix,
            bloomMix,
            questionTypeMix: typeMix,
          },
          user,
        );
        setForm(emptyForm());
        setTopicText('');
        await load();
        onChanged();
      }),
    [bloomMix, difficultyMix, form, load, onChanged, runAction, topics, typeMix, user],
  );

  const edit = useCallback((blueprint: ExamBlueprint) => {
    setForm({
      id: blueprint.id,
      name: blueprint.name,
      curriculum: blueprint.curriculum,
      subjectName: blueprint.subject_name,
      gradeLevel: String(blueprint.grade_level ?? ''),
      academicYear: blueprint.academic_year,
      term: blueprint.term,
      assessmentType: blueprint.assessment_type,
      durationMinutes: blueprint.duration_minutes,
      totalMarks: blueprint.total_marks,
    });
    setTopicText((blueprint.topic_weights || []).map(entry => entry.topic).join('\n'));
    setDifficultyMix(blueprint.difficulty_mix as Record<string, number>);
    setBloomMix(blueprint.bloom_mix);
    setTypeMix(blueprint.question_type_mix);
  }, []);

  return (
    <div className={styles.split}>
      <Panel className={styles.padFit}>
        <h3 className={styles.subheading}>
          <Layers size={16} />
          {form.id ? 'Edit blueprint' : 'New blueprint'}
        </h3>

        <div className={styles.stackTight}>
          <Field label="Blueprint name" value={form.name} onChange={set('name')} placeholder="S2 Biology — Term 1 Test" />
          <Field
            label="Curriculum"
            value={form.curriculum}
            onChange={set('curriculum')}
            options={frameworks.map(entry => ({ value: entry.id, label: entry.label }))}
            hint={framework?.examBody}
 />
          <div className={styles.grid2}>
            <Field label="Year / class" value={form.gradeLevel} onChange={set('gradeLevel')} options={gradeOptionsFor(framework)} />
            <Field label="Subject" value={form.subjectName} onChange={set('subjectName')} />
          </div>
          <div className={styles.grid2}>
            <Field label="Academic year" value={form.academicYear} onChange={set('academicYear')} />
            <Field label="Term" value={form.term} onChange={set('term')} options={TERM_OPTIONS.filter(o => o.value)} />
          </div>
          <div className={styles.grid3}>
            <Field label="Type" value={form.assessmentType} onChange={set('assessmentType')} options={ASSESSMENT_TYPES} />
            <Field label="Minutes" type="number" min={10} value={form.durationMinutes} onChange={set('durationMinutes')} />
            <Field label="Marks" type="number" min={1} value={form.totalMarks} onChange={set('totalMarks')} />
          </div>
          <Field
            label="Topics"
            type="textarea"
            value={topicText}
            onChange={value => setTopicText(String(value ?? ''))}
            hint="One syllabus topic per line."
 />

          <MixEditor label="Difficulty spread" keys={['easy', 'moderate', 'challenging']} mix={difficultyMix} onChange={setDifficultyMix} />
          <MixEditor
            label="Bloom level spread"
            keys={['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create']}
            mix={bloomMix}
            onChange={setBloomMix}
 />
          <MixEditor
            label="Question type spread"
            keys={framework?.questionTypes || []}
            mix={typeMix}
            onChange={setTypeMix}
 />
        </div>

        <div className={styles.actions}>
          <PrimaryButton onClick={save} disabled={Boolean(busy) || !form.name.trim()}>
            <Save size={16} /> {form.id ? 'Update' : 'Create'}
          </PrimaryButton>
          {form.id && (
            <SecondaryButton onClick={() => { setForm(emptyForm()); setTopicText(''); }} disabled={Boolean(busy)}>
              Cancel
            </SecondaryButton>
          )}
        </div>
      </Panel>

      <Panel>
        {blueprints.length === 0 ? (
          <EmptyState message="No blueprints yet. A blueprint fixes the curriculum, year, subject and mark spread for a paper, so you can regenerate it consistently each term." />
        ) : (
          <div className={styles.rows}>
            {blueprints.map(blueprint => (
              <div key={blueprint.id} className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 ${zebra}`}>
                <div className={styles.rowMain}>
                  <p className={styles.strong}>{blueprint.name}</p>
                  <p className={styles.note}>
                    {[
                      blueprint.subject_name,
                      blueprint.term,
                      `${blueprint.total_marks} marks`,
                      `${blueprint.duration_minutes} min`,
                      `${(blueprint.topic_weights || []).length} topics`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className={styles.actions}>
                  <SecondaryButton onClick={() => onUseBlueprint(blueprint)} disabled={Boolean(busy)}>
                    Generate from this
                  </SecondaryButton>
                  <SecondaryButton onClick={() => edit(blueprint)} disabled={Boolean(busy)}>
                    Edit
                  </SecondaryButton>
                  <DangerButton
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Delete this blueprint?',
                          message: `“${blueprint.name}” will be removed. Questions already generated from it are kept.`,
                          confirmLabel: 'Delete',
                          danger: true,
                        }))
                      ) {
                        return;
                      }
                      runAction('Deleting the blueprint', async () => {
                        await callDigitalExaminer('delete_blueprint', { id: blueprint.id }, user);
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
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

export default BlueprintTab;
