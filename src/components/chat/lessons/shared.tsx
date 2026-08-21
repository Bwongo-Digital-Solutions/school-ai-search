import React from 'react';
import { BookMarked, CheckCircle2, CircleDashed, GraduationCap } from 'lucide-react';
import type { Citation, LessonStatus, QuestionStatus } from '@/types/teaching';

/**
 * Status pills shared by the Lesson Planner and the Digital Examiner. Both modules run the same
 * draft → reviewed → in-use lifecycle, so they read the same way on screen.
 */
export const LESSON_STATUS_STYLES: Record<LessonStatus, { label: string; badge: string; icon: React.ElementType }> = {
  draft: {
    label: 'Draft',
    badge: 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    icon: CircleDashed,
  },
  approved: {
    label: 'Approved',
    badge: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle2,
  },
  delivered: {
    label: 'Delivered',
    badge: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
    icon: GraduationCap,
  },
};

export const QUESTION_STATUS_STYLES: Record<
  QuestionStatus,
  { label: string; badge: string; icon: React.ElementType }
> = {
  draft: LESSON_STATUS_STYLES.draft,
  approved: LESSON_STATUS_STYLES.approved,
  retired: {
    label: 'Retired',
    badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    icon: CircleDashed,
  },
};

export const StatusBadge = ({
  status,
  styles,
}: {
  status: string;
  styles: Record<string, { label: string; badge: string; icon: React.ElementType }>;
}) => {
  const style = styles[status] ?? LESSON_STATUS_STYLES.draft;
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.badge}`}>
      <Icon className="w-2.5 h-2.5" />
      {style.label}
    </span>
  );
};

/**
 * The syllabus passages an artefact was generated from.
 *
 * Shown wherever generated content is reviewed, because "which part of the syllabus is this from"
 * is the first question a head of department asks — and the answer is what separates a grounded
 * draft from a plausible-sounding invention.
 */
export const CitationList = ({ citations, label = 'Syllabus sources' }: { citations: Citation[]; label?: string }) => {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
        <BookMarked className="w-3 h-3" /> {label}
      </p>
      <ul className="space-y-1">
        {citations.map(citation => (
          <li
            key={citation.chunkId || `${citation.documentId}-${citation.citationIndex}`}
            className="text-[11px] text-gray-500 dark:text-gray-400 flex gap-1.5"
          >
            <span className="shrink-0 font-medium text-indigo-500">[{citation.citationIndex}]</span>
            <span>
              <span className="font-medium text-gray-600 dark:text-gray-300">{citation.title}</span>
              {citation.heading && <span> — {citation.heading}</span>}
              {citation.snippet && <span className="block text-gray-400 line-clamp-2">{citation.snippet}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const TERM_OPTIONS = [
  { value: '', label: 'Any term' },
  { value: 'Term 1', label: 'Term 1' },
  { value: 'Term 2', label: 'Term 2' },
  { value: 'Term 3', label: 'Term 3' },
];

/** The academic year the school is most likely in, used to prefill year fields. */
export const currentAcademicYear = () => {
  const year = new Date().getFullYear();
  return `${year}/${year + 1}`;
};
