import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, FileText, Layers, Library, Loader2, Shield, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callDigitalExaminer, loadCurriculumFrameworks } from '@/lib/teaching';
import StatTile from '@/components/common/StatTile';
import BlueprintTab from './examiner/BlueprintTab';
import GenerateTab from './examiner/GenerateTab';
import QuestionBankTab from './examiner/QuestionBankTab';
import PapersTab from './examiner/PapersTab';
import type { CurriculumFramework, ExamBlueprint, ExamQuestion, GeneratedPaper } from '@/types/teaching';

const SECTIONS = [
  { key: 'blueprint', label: 'Blueprints', icon: Layers },
  { key: 'generate', label: 'Generate', icon: Sparkles },
  { key: 'bank', label: 'Question Bank', icon: Library },
  { key: 'papers', label: 'Papers', icon: FileText },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const DigitalExaminerWorkspace: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const isTeachingStaff = isAdmin || user?.role === 'teacher';

  const [section, setSection] = useState<SectionKey>('blueprint');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ label: string; message: string } | null>(null);
  const [frameworks, setFrameworks] = useState<CurriculumFramework[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [papers, setPapers] = useState<GeneratedPaper[]>([]);
  const [activeBlueprint, setActiveBlueprint] = useState<ExamBlueprint | null>(null);
  // Questions ticked in the bank, carried to the Papers tab for assembly.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    loadCurriculumFrameworks().then(setFrameworks);
  }, []);

  const loadCounts = useCallback(async () => {
    if (!isTeachingStaff) return;
    try {
      const [questionResult, paperResult] = await Promise.all([
        callDigitalExaminer<{ questions: ExamQuestion[] }>('list_questions', {}, user),
        callDigitalExaminer<{ papers: GeneratedPaper[] }>('list_papers', {}, user),
      ]);
      setQuestions(questionResult.questions);
      setPapers(paperResult.papers);
    } catch (err) {
      console.error('Failed to load examiner data:', err);
    }
  }, [isTeachingStaff, user]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const onChanged = useCallback(() => {
    setRefreshKey(key => key + 1);
    loadCounts();
  }, [loadCounts]);

  /**
   * Shared wrapper for every mutation on this screen.
   *
   * A failure is surfaced in the page rather than through alert(): generation failures in
   * particular carry the model's actual reply, which the teacher may want to read, edit and keep —
   * a modal that can only be dismissed throws that away.
   */
  const runAction = useCallback(async (label: string, handler: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await handler();
    } catch (err: unknown) {
      console.error(`${label} failed:`, err);
      setError({ label, message: err instanceof Error ? err.message : 'Unexpected error' });
    } finally {
      setBusy(null);
    }
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(previous => (previous.includes(id) ? previous.filter(entry => entry !== id) : [...previous, id]));
  }, []);

  const useBlueprint = useCallback((blueprint: ExamBlueprint) => {
    setActiveBlueprint(blueprint);
    setSection('generate');
  }, []);

  // Defence in depth, matching the Lesson Planner and fees workspaces.
  if (!isTeachingStaff) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900 p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-purple-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Teaching Staff Only</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The Digital Examiner is available to teachers and administrators.
          </p>
        </div>
      </div>
    );
  }

  const awaitingReview = questions.filter(question => question.status === 'draft').length;
  const approved = questions.filter(question => question.status === 'approved').length;
  const published = papers.filter(paper => paper.status === 'published').length;

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-indigo-500" />
              Digital Examiner
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Questions, assignments and exams written against the Uganda syllabus and International GCSE
              standards.
            </p>
          </div>
          {busy && (
            <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy}…
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <StatTile label="Questions banked" value={String(questions.length)} icon={Library} />
          <StatTile
            label="Awaiting review"
            value={String(awaitingReview)}
            icon={Sparkles}
            tone={awaitingReview > 0 ? 'warning' : 'default'}
          />
          <StatTile label="Approved" value={String(approved)} icon={ClipboardCheck} tone="success" />
          <StatTile label="Papers published" value={String(published)} icon={FileText} />
        </div>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                section === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {key === 'bank' && selectedIds.length > 0 && (
                <span className="ml-0.5 px-1.5 rounded-full bg-white/20 text-[10px]">{selectedIds.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{error.label} failed</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 whitespace-pre-wrap">
                  {error.message}
                </p>
              </div>
              <button
                onClick={() => setError(null)}
                className="shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5 text-amber-600" />
              </button>
            </div>
          </div>
        )}

        {section === 'blueprint' && (
          <BlueprintTab
            frameworks={frameworks}
            runAction={runAction}
            onChanged={onChanged}
            busy={busy}
            refreshKey={refreshKey}
            onUseBlueprint={useBlueprint}
          />
        )}
        {section === 'generate' && (
          <GenerateTab
            frameworks={frameworks}
            runAction={runAction}
            onChanged={onChanged}
            busy={busy}
            blueprint={activeBlueprint}
            onClearBlueprint={() => setActiveBlueprint(null)}
          />
        )}
        {section === 'bank' && (
          <QuestionBankTab
            runAction={runAction}
            onChanged={onChanged}
            busy={busy}
            refreshKey={refreshKey}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
            onAssemble={() => setSection('papers')}
          />
        )}
        {section === 'papers' && (
          <PapersTab
            runAction={runAction}
            onChanged={onChanged}
            busy={busy}
            refreshKey={refreshKey}
            pendingQuestionIds={selectedIds}
            onAssembled={() => setSelectedIds([])}
          />
        )}
      </div>
    </div>
  );
};

export default DigitalExaminerWorkspace;
