import React from 'react';
import { NumberInput, Tag, TextArea } from '@carbon/react';
import { Rule } from '@carbon/react/icons';
import type { ExamQuestion } from '@/types/teaching';
import { CitationList, QUESTION_STATUS_STYLES, StatusBadge } from '../lessons/shared';
import styles from './shared.module.scss';

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
      <div className={styles.mixHead}>
        <span className={styles.mixLabel}>{label}</span>
        <span className={styles.mixTotal}>
          {total} question{total === 1 ? '' : 's'}
        </span>
      </div>
      <div className={styles.mixGrid}>
        {keys.map(key => (
          <div key={key} className={styles.mixItem}>
            <NumberInput
              id={`mix-${label}-${key}`}
              className={styles.mixInput}
              label={key.replace(/_/g, ' ')}
              hideLabel
              size="sm"
              hideSteppers
              min={0}
              value={mix[key] ?? 0}
              onChange={(event, state) => {
                const next = state?.value ?? (event?.target as HTMLInputElement | undefined)?.value ?? 0;
                onChange({ ...mix, [key]: Number(next) || 0 });
              }}
 />
            <span className={styles.mixName}>{key.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const OPTION_LABEL = (index: number) => String.fromCharCode(65 + index);

/** The small grey chips carrying a question's type, difficulty and Bloom level. */
const Chip = ({ children }: { children: React.ReactNode }) => (
  <Tag type="cool-gray" size="sm">
    {children}
  </Tag>
);

/** The mark-by-mark scheme, shown under a question wherever the answer is shown. */
const MarkingScheme = ({ scheme }: { scheme: ExamQuestion['marking_scheme'] }) => {
  if (scheme.length === 0) return null;
  return (
    <div className={styles.section}>
      <p className={styles.sectionLabel}>
        <Rule size={16} /> Marking scheme
      </p>
      <ul className={styles.scheme}>
        {scheme.map((entry, index) => (
          <li key={index}>
            • {entry.point} <span className={styles.schemeMarks}>({entry.marks})</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * One question as a reviewer reads it: the stem, its options or expected answer, the mark-by-mark
 * scheme, and the syllabus passages it was generated from.
 */
export const QuestionCard = ({
  question,
  actions,
  showAnswer = true,
  editable = false,
  onEdit,
}: {
  question: ExamQuestion;
  actions?: React.ReactNode;
  showAnswer?: boolean;
  /** Turns the stem, answer and marks into fields that save on blur. */
  editable?: boolean;
  onEdit?: (patch: Partial<ExamQuestion>) => void;
}) => {
  if (editable && onEdit) {
    return <EditableQuestionCard question={question} actions={actions} onEdit={onEdit} />;
  }

  return <ReadOnlyQuestionCard question={question} actions={actions} showAnswer={showAnswer} />;
};

/**
 * A generated question a teacher can correct in place.
 *
 * Saves on blur rather than behind a Save button: a generated draft usually needs several small
 * fixes, and making each one a two-step action discourages doing them at all.
 */
const EditableQuestionCard = ({
  question,
  actions,
  onEdit,
}: {
  question: ExamQuestion;
  actions?: React.ReactNode;
  onEdit: (patch: Partial<ExamQuestion>) => void;
}) => {
  const [stem, setStem] = React.useState(question.stem);
  const [answer, setAnswer] = React.useState(question.correct_answer);
  const [marks, setMarks] = React.useState(question.marks);

  // Re-sync when the saved question comes back from the server, so an edit elsewhere is not lost.
  React.useEffect(() => {
    setStem(question.stem);
    setAnswer(question.correct_answer);
    setMarks(question.marks);
  }, [question.stem, question.correct_answer, question.marks]);

  const commit = (patch: Partial<ExamQuestion>, changed: boolean) => {
    if (changed) onEdit(patch);
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.tags}>
          <StatusBadge status={question.status} styles={QUESTION_STATUS_STYLES} />
          <Chip>{question.question_type.replace(/_/g, ' ')}</Chip>
          <Chip>{question.difficulty}</Chip>
          {question.topic && <Chip>{question.topic}</Chip>}
        </div>
        <div className={styles.marksField}>
          <span className={styles.marksLabel}>Marks</span>
          <NumberInput
            id={`marks-${question.id}`}
            className={styles.mixInput}
            label="Marks"
            hideLabel
            size="sm"
            hideSteppers
            min={0}
            value={marks}
            onChange={(event, state) => {
              const next = state?.value ?? (event?.target as HTMLInputElement | undefined)?.value ?? 0;
              setMarks(Number(next) || 0);
            }}
            onBlur={() => commit({ marks }, marks !== question.marks)}
 />
        </div>
      </div>

      <TextArea
        id={`stem-${question.id}`}
        labelText="Question"
        hideLabel
        value={stem}
        onChange={event => setStem(event.target.value)}
        onBlur={() => commit({ stem }, stem !== question.stem)}
        rows={Math.min(6, Math.max(2, Math.ceil(stem.length / 90)))}
 />

      {question.options.length > 0 && (
        <ol className={styles.options}>
          {question.options.map((option, index) => (
            <li key={index}>
              {OPTION_LABEL(index)}. {option}
            </li>
          ))}
        </ol>
      )}

      <div className={styles.section}>
        <TextArea
          id={`answer-${question.id}`}
          labelText="Expected answer"
          value={answer}
          onChange={event => setAnswer(event.target.value)}
          onBlur={() =>
            commit({ correctAnswer: answer } as Partial<ExamQuestion>, answer !== question.correct_answer)
          }
          rows={2}
          placeholder="Write the expected answer — a generated draft may not have one."
 />
      </div>

      <MarkingScheme scheme={question.marking_scheme} />

      <CitationList citations={question.source_references} label="Generated from" />

      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
};

const ReadOnlyQuestionCard = ({
  question,
  actions,
  showAnswer = true,
}: {
  question: ExamQuestion;
  actions?: React.ReactNode;
  showAnswer?: boolean;
}) => (
  <div className={styles.card}>
    <div className={styles.cardHead}>
      <div className={styles.tags}>
        <StatusBadge status={question.status} styles={QUESTION_STATUS_STYLES} />
        <Chip>{question.question_type.replace(/_/g, ' ')}</Chip>
        <Chip>{question.difficulty}</Chip>
        {question.bloom_level && <Chip>{question.bloom_level}</Chip>}
        {question.assessment_objective && <Chip>{question.assessment_objective}</Chip>}
      </div>
      <span className={styles.marks}>
        [{question.marks} mark{question.marks === 1 ? '' : 's'}]
      </span>
    </div>

    {question.topic && (
      <p className={styles.topic}>
        {question.topic}
        {question.subtopic ? ` · ${question.subtopic}` : ''}
      </p>
    )}

    <p className={styles.stem}>{question.stem}</p>

    {question.options.length > 0 && (
      <ol className={styles.options}>
        {question.options.map((option, index) => {
          const correct = showAnswer && option === question.correct_answer;
          return (
            <li key={index} className={correct ? styles.optionCorrect : undefined}>
              {OPTION_LABEL(index)}. {option}
              {/* Named as well as coloured, so the right answer survives a black-and-white print
                  and a reader who cannot distinguish the green. */}
              {correct && ' — correct'}
            </li>
          );
        })}
      </ol>
    )}

    {showAnswer && question.options.length === 0 && question.correct_answer && (
      <p className={styles.answer}>
        <span className={styles.answerLabel}>Expected answer:</span> {question.correct_answer}
      </p>
    )}

    {showAnswer && <MarkingScheme scheme={question.marking_scheme} />}

    <CitationList citations={question.source_references} label="Generated from" />

    {question.review_notes && <p className={styles.reviewNote}>Review note: {question.review_notes}</p>}

    {actions && <div className={styles.actions}>{actions}</div>}
  </div>
);
