import React from 'react';
import { Wrench } from 'lucide-react';
import type { ExamQuestion } from '@/types/teaching';
import { CitationList, QUESTION_STATUS_STYLES, StatusBadge } from '../lessons/shared';

/**
 * A weighted spread across a fixed set of keys — difficulty, Bloom level or question type.
 *
 * Counts rather than percentages, because a teacher thinks in "three hard ones", not "20% hard",
 * and the generator is told the counts directly.
 */
export const MixEditor = ({
  label,
  keys,
  mix,
  onChange,
}: {
  label: string;
  keys: string[];
  mix: Record<string, number>;
  onChange: (mix: Record<string, number>) => void;
}) => {
  if (keys.length === 0) return null;

  const total = Object.values(mix).reduce((sum, value) => sum + Number(value || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-[10px] text-gray-400">{total} questions</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {keys.map(key => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={mix[key] ?? 0}
              onChange={event => onChange({ ...mix, [key]: Number(event.target.value) })}
              className="w-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400"
            />
            <span className="text-[11px] text-gray-500 dark:text-gray-400 capitalize truncate">
              {key.replace(/_/g, ' ')}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

const OPTION_LABEL = (index: number) => String.fromCharCode(65 + index);

/**
 * One question as a reviewer reads it: the stem, its options or expected answer, the mark-by-mark
 * scheme, and the syllabus passages it was generated from.
 */
export const QuestionCard = ({
  question,
  actions,
  showAnswer = true,
}: {
  question: ExamQuestion;
  actions?: React.ReactNode;
  showAnswer?: boolean;
}) => (
  <div className="p-4 border border-gray-100 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={question.status} styles={QUESTION_STATUS_STYLES} />
        <Tag>{question.question_type.replace(/_/g, ' ')}</Tag>
        <Tag>{question.difficulty}</Tag>
        {question.bloom_level && <Tag>{question.bloom_level}</Tag>}
        {question.assessment_objective && <Tag>{question.assessment_objective}</Tag>}
      </div>
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
        [{question.marks} mark{question.marks === 1 ? '' : 's'}]
      </span>
    </div>

    {question.topic && (
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
        {question.topic}
        {question.subtopic ? ` · ${question.subtopic}` : ''}
      </p>
    )}

    <p className="text-sm text-gray-800 dark:text-gray-100">{question.stem}</p>

    {question.options.length > 0 && (
      <ol className="mt-2 space-y-0.5">
        {question.options.map((option, index) => (
          <li
            key={index}
            className={`text-xs ${
              showAnswer && option === question.correct_answer
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {OPTION_LABEL(index)}. {option}
          </li>
        ))}
      </ol>
    )}

    {showAnswer && question.options.length === 0 && question.correct_answer && (
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-medium text-emerald-600 dark:text-emerald-400">Expected answer:</span>{' '}
        {question.correct_answer}
      </p>
    )}

    {showAnswer && question.marking_scheme.length > 0 && (
      <div className="mt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-1">
          <Wrench className="w-3 h-3" /> Marking scheme
        </p>
        <ul className="space-y-0.5">
          {question.marking_scheme.map((entry, index) => (
            <li key={index} className="text-[11px] text-gray-600 dark:text-gray-300">
              • {entry.point} <span className="text-gray-400">({entry.marks})</span>
            </li>
          ))}
        </ul>
      </div>
    )}

    <CitationList citations={question.source_references} label="Generated from" />

    {question.review_notes && (
      <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">Review note: {question.review_notes}</p>
    )}

    {actions && <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">{actions}</div>}
  </div>
);

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 capitalize">
    {children}
  </span>
);
