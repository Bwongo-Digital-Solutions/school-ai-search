import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileDown, Sparkles, Target, Terminal, Trash2 } from 'lucide-react';
import Field from '@/components/common/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callDigitalExaminer, gradeOptionsFor } from '@/lib/teaching';
import { EmptyState, Panel, PrimaryButton, SecondaryButton } from '../fees/shared';
import { currentAcademicYear } from '../lessons/shared';
import { QuestionCard } from './shared';
import type { AgentStep } from '@/types/agent';
import type { CurriculumFramework, ExamBlueprint, ExamQuestion } from '@/types/teaching';

interface Props {
  frameworks: CurriculumFramework[];
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  busy: string | null;
  blueprint: ExamBlueprint | null;
  onClearBlueprint: () => void;
}

interface GenerateResult {
  questions: ExamQuestion[];
  steps: AgentStep[];
  weakTopics: string[];
  /** True when the questions were read out of prose because the model ignored the submit tool. */
  recoveredFromProse?: boolean;
  /** The model's raw reply, kept so nothing it produced is lost. */
  rawReply?: string;
}

/**
 * Runs generation and puts every question in front of a teacher for review before it can be used.
 *
 * Nothing generated is usable until approved: the question bank filters on status, and a paper
 * refuses to publish while any of its questions is still a draft.
 */
const GenerateTab: React.FC<Props> = ({ frameworks, runAction, onChanged, busy, blueprint, onClearBlueprint }) => {
  const { user } = useAuth();
  const { aiModels, selectedModelId } = useChatContext();

  const [form, setForm] = useState({
    curriculum: 'uganda-cbc-lower-secondary',
    subjectName: 'Biology',
    gradeLevel: '9',
    assessmentType: 'test',
    academicYear: currentAcademicYear(),
    count: 10,
    targetWeakTopics: false,
  });
  const [topicText, setTopicText] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  // Selecting a blueprint on the previous tab prefills this form and pins generation to it.
  useEffect(() => {
    if (!blueprint) return;
    setForm(previous => ({
      ...previous,
      curriculum: blueprint.curriculum,
      subjectName: blueprint.subject_name,
      gradeLevel: String(blueprint.grade_level ?? previous.gradeLevel),
      assessmentType: blueprint.assessment_type,
      academicYear: blueprint.academic_year || previous.academicYear,
    }));
    setTopicText((blueprint.topic_weights || []).map(entry => entry.topic).join('\n'));
  }, [blueprint]);

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
      runAction('Writing questions', async () => {
        const response = await callDigitalExaminer<GenerateResult>(
          'generate_questions',
          { ...form, topics, blueprintId: blueprint?.id, modelId: selectedModelId },
          user,
        );
        setResult(response);
        onChanged();
      }),
    [blueprint, form, onChanged, runAction, selectedModelId, topics, user],
  );

  const saveEdit = useCallback(
    (question: ExamQuestion, patch: Partial<ExamQuestion>) =>
      runAction('Saving the question', async () => {
        const response = await callDigitalExaminer<{ question: ExamQuestion }>(
          'save_question',
          {
            id: question.id,
            topic: question.topic,
            subtopic: question.subtopic,
            questionType: question.question_type,
            difficulty: question.difficulty,
            bloomLevel: question.bloom_level,
            commandWord: question.command_word,
            stem: question.stem,
            options: question.options,
            correctAnswer: question.correct_answer,
            markingScheme: question.marking_scheme,
            marks: question.marks,
            assessmentObjective: question.assessment_objective,
            ...patch,
          },
          user,
        );
        setResult(previous =>
          previous
            ? {
                ...previous,
                questions: previous.questions.map(entry =>
                  entry.id === question.id ? response.question : entry,
                ),
              }
            : previous,
        );
        onChanged();
      }),
    [onChanged, runAction, user],
  );

  /** Downloads what was generated as Markdown, so a draft is never trapped in the browser. */
  const downloadDraft = useCallback(() => {
    if (!result) return;

    const lines = [
      `# Generated questions — ${form.subjectName || 'Untitled'}`,
      '',
      ...result.questions.flatMap((question, index) => [
        `## ${index + 1}. ${question.stem}`,
        '',
        ...(question.options.length > 0
          ? question.options.map((option, position) => `${String.fromCharCode(65 + position)}. ${option}`)
          : []),
        question.options.length > 0 ? '' : null,
        question.correct_answer ? `**Answer:** ${question.correct_answer}` : null,
        ...(question.marking_scheme.length > 0
          ? ['', '**Marking scheme:**', ...question.marking_scheme.map(entry => `- ${entry.point} (${entry.marks})`)]
          : []),
        '',
        `_${[question.topic, question.difficulty, `${question.marks} mark(s)`, question.status]
          .filter(Boolean)
          .join(' · ')}_`,
        '',
      ]),
      ...(result.rawReply ? ['---', '', '## The model\'s original reply', '', result.rawReply] : []),
    ].filter((line): line is string => line !== null);

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `generated-questions-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [form.subjectName, result]);

  const setStatus = useCallback(
    (question: ExamQuestion, status: string) =>
      runAction(`Marking the question ${status}`, async () => {
        const response = await callDigitalExaminer<{ question: ExamQuestion }>(
          'set_question_status',
          { id: question.id, status },
          user,
        );
        setResult(previous =>
          previous
            ? { ...previous, questions: previous.questions.map(entry => (entry.id === question.id ? response.question : entry)) }
            : previous,
        );
        onChanged();
      }),
    [onChanged, runAction, user],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[340px,1fr]">
      <Panel className="p-4 h-fit">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" /> Generate questions
        </h3>

        {blueprint && (
          <div className="mb-3 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-2">
            <span className="text-[11px] text-indigo-700 dark:text-indigo-300 truncate">
              Using blueprint: <span className="font-medium">{blueprint.name}</span>
            </span>
            <button
              type="button"
              onClick={onClearBlueprint}
              className="text-[11px] text-indigo-500 hover:underline shrink-0"
            >
              clear
            </button>
          </div>
        )}

        <div className="space-y-3">
          <Field
            label="Curriculum"
            value={form.curriculum}
            onChange={set('curriculum')}
            options={frameworks.map(entry => ({ value: entry.id, label: entry.label }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Year / class" value={form.gradeLevel} onChange={set('gradeLevel')} options={gradeOptionsFor(framework)} />
            <Field label="Subject" value={form.subjectName} onChange={set('subjectName')} />
          </div>
          <Field
            label="Topics"
            type="textarea"
            value={topicText}
            onChange={value => setTopicText(String(value ?? ''))}
            hint="One syllabus topic per line."
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Type"
              value={form.assessmentType}
              onChange={set('assessmentType')}
              options={[
                { value: 'quiz', label: 'Quiz' },
                { value: 'assignment', label: 'Assignment' },
                { value: 'test', label: 'Class test' },
                { value: 'exam', label: 'Exam' },
                { value: 'mock', label: 'Mock exam' },
              ]}
            />
            <Field label="How many" type="number" min={1} max={40} value={form.count} onChange={set('count')} />
          </div>

          <label className="flex items-start gap-2 pt-1">
            <input
              type="checkbox"
              checked={form.targetWeakTopics}
              onChange={event => set('targetWeakTopics')(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-[11px] text-gray-600 dark:text-gray-400">
              <span className="font-medium flex items-center gap-1">
                <Target className="w-3 h-3" /> Target weak topics
              </span>
              Weight the paper towards topics this cohort scored lowest on in the gradebook.
            </span>
          </label>
        </div>

        <PrimaryButton
          className="w-full mt-4 justify-center"
          onClick={generate}
          disabled={Boolean(busy) || topics.length === 0 || !canGenerate}
        >
          <Sparkles className="w-4 h-4" /> Write {form.count} question{form.count === 1 ? '' : 's'}
        </PrimaryButton>

        {!canGenerate && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            Pick a configured AI model in the chat composer first — the Local Rules engine can only search
            student records.
          </p>
        )}
      </Panel>

      <div className="space-y-3">
        {!result ? (
          <Panel>
            <EmptyState message="Choose the topics and press Write. Every question is generated from your school's curriculum library and shows the syllabus passages it came from, so you can check it before use." />
          </Panel>
        ) : (
          <>
            <Panel className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  <span className="font-semibold">{result.questions.length}</span> question
                  {result.questions.length === 1 ? '' : 's'} written · edit anything, then approve
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={downloadDraft}
                    className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    <FileDown className="w-3.5 h-3.5" /> Download draft
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSteps(!showSteps)}
                    className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    {showSteps ? 'Hide' : 'Show'} what the assistant did ({result.steps.length})
                  </button>
                </div>
              </div>

              {result.recoveredFromProse && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  The model wrote these out as prose instead of returning them properly, so they were read
                  back from its reply. Marks and answers may be missing — read each one before approving.
                  A larger model usually returns them cleanly.
                </p>
              )}

              {result.weakTopics.length > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                  <Target className="w-3 h-3" /> Weighted towards weak topics: {result.weakTopics.join(', ')}
                </p>
              )}

              {showSteps && (
                <ol className="mt-2 space-y-1 border-t border-gray-100 dark:border-gray-700 pt-2">
                  {result.steps.map((step, index) => (
                    <li key={index} className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                      <span className={step.isError ? 'text-red-500' : 'text-indigo-500'}>{step.tool}</span>
                      <span className="text-gray-400"> ({step.ms}ms)</span>
                      <span className="block truncate text-gray-400">{JSON.stringify(step.input)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            {result.questions.map(question => (
              <QuestionCard
                key={question.id}
                question={question}
                editable
                onEdit={patch => saveEdit(question, patch)}
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
                        <Trash2 className="w-4 h-4" /> Retire
                      </SecondaryButton>
                    )}
                  </>
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default GenerateTab;
