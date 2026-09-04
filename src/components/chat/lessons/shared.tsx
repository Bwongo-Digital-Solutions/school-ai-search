import React from 'react';
import { Tag } from '@carbon/react';
import { Book, CheckmarkFilled, Education, Incomplete } from '@carbon/react/icons';
import type { Citation, LessonStatus, QuestionStatus } from '@/types/teaching';
import styles from './shared.module.scss';

/**
 * Status pills shared by the Lesson Planner and the Digital Examiner.
 *
 * Both modules run the same draft → approved → in-use lifecycle, so they read the same way on
 * screen. Carbon `Tag` colours rather than hand-written classes, so a lesson's status and a fee
 * standing look like the same kind of thing — which they are.
 */
type TagType = 'red' | 'magenta' | 'purple' | 'blue' | 'cyan' | 'teal' | 'green' | 'gray' | 'cool-gray' | 'warm-gray';

export interface StatusStyle {
  label: string;
  tag: TagType;
  icon: React.ElementType;
}

export const LESSON_STATUS_STYLES: Record<LessonStatus, StatusStyle> = {
  draft: { label: 'Draft', tag: 'cool-gray', icon: Incomplete },
  approved: { label: 'Approved', tag: 'green', icon: CheckmarkFilled },
  delivered: { label: 'Delivered', tag: 'blue', icon: Education },
};

export const QUESTION_STATUS_STYLES: Record<QuestionStatus, StatusStyle> = {
  draft: LESSON_STATUS_STYLES.draft,
  approved: LESSON_STATUS_STYLES.approved,
  retired: { label: 'Retired', tag: 'warm-gray', icon: Incomplete },
};

export const StatusBadge = ({
  status,
  styles: statusStyles,
}: {
  status: string;
  styles: Record<string, StatusStyle>;
}) => {
  const style = statusStyles[status] ?? LESSON_STATUS_STYLES.draft;
  return (
    <Tag type={style.tag} size="sm" renderIcon={style.icon}>
      {style.label}
    </Tag>
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
    <div className={styles.citations}>
      <p className={styles.citationsLabel}>
        <Book size={16} /> {label}
      </p>
      <ul className={styles.citationList}>
        {citations.map(citation => (
          <li
            key={citation.chunkId || `${citation.documentId}-${citation.citationIndex}`}
            className={styles.citation}
          >
            <span className={styles.citationIndex}>[{citation.citationIndex}]</span>
            <span>
              <span className={styles.citationTitle}>{citation.title}</span>
              {citation.heading && <span> — {citation.heading}</span>}
              {citation.snippet && <span className={styles.citationSnippet}>{citation.snippet}</span>}
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
