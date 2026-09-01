import React, { useCallback, useEffect, useState } from 'react';
import { InlineLoading, InlineNotification, Tab, TabList, Tabs, Tag } from '@carbon/react';
import { Ai, Catalog, Document, Layers, TaskComplete } from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { callDigitalExaminer, loadCurriculumFrameworks } from '@/lib/teaching';
import { AccessDenied, PageHeader, StatRow, StatTile } from '@/components/common';
import styles from './workspace.module.scss';
import BlueprintTab from './examiner/BlueprintTab';
import GenerateTab from './examiner/GenerateTab';
import QuestionBankTab from './examiner/QuestionBankTab';
import PapersTab from './examiner/PapersTab';
import type { CurriculumFramework, ExamBlueprint, ExamQuestion, GeneratedPaper } from '@/types/teaching';

const SECTIONS = [
  { key: 'blueprint', label: 'Blueprints', icon: Layers },
  { key: 'generate', label: 'Generate', icon: Ai },
  { key: 'bank', label: 'Question bank', icon: Catalog },
  { key: 'papers', label: 'Papers', icon: Document },
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
      <AccessDenied
        title="Teaching staff only"
        message="The digital examiner is available to teachers and administrators."
      />
    );
  }

  const awaitingReview = questions.filter(question => question.status === 'draft').length;
  const approved = questions.filter(question => question.status === 'approved').length;
  const published = papers.filter(paper => paper.status === 'published').length;

  return (
    <div className={styles.screen}>
      <PageHeader title="Digital examiner" illustration={<TaskComplete size={32} />}>
        {busy && (
          <span className={styles.busy}>
            <InlineLoading description={`${busy}…`} />
          </span>
        )}
      </PageHeader>

      <div className={styles.controls}>
        <StatRow>
          <StatTile label="Questions banked" value={String(questions.length)} icon={Catalog} />
          <StatTile
            label="Awaiting review"
            value={String(awaitingReview)}
            icon={Ai}
            tone={awaitingReview > 0 ? 'warning' : 'default'}
          />
          <StatTile label="Approved" value={String(approved)} icon={TaskComplete} tone="success" />
          <StatTile label="Papers published" value={String(published)} icon={Document} />
        </StatRow>

        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex(entry => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="Digital examiner sections" contained>
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>
                  {label}
                  {/* How many questions are selected for a paper, on the tab that holds them —
                      so the count is visible from whichever section you are working in. */}
                  {key === 'bank' && selectedIds.length > 0 && (
                    <Tag type="blue" size="sm">
                      {selectedIds.length}
                    </Tag>
                  )}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      <div className={styles.body}>
        {error && (
          <InlineNotification
            kind="warning"
            title={`${error.label} failed`}
            subtitle={error.message}
            onCloseButtonClick={() => setError(null)}
            lowContrast
          />
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
