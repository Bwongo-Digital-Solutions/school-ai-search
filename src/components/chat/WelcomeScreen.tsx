import React, { useMemo } from 'react';
import { ClickableTile, Tag } from '@carbon/react';
import {
  ChartColumn,
  Book,
  Document,
  Education,
  Image as ImageIcon,
  Microphone,
  Search,
  UserMultiple,
} from '@carbon/react/icons';
import { useChatContext } from '@/contexts/ChatContext';
import styles from './welcome-screen.module.scss';

/**
 * What the assistant shows before the first question.
 *
 * The suggestions are Carbon `ClickableTile`s: a tile that is a button, which is exactly what these
 * are — and it brings the hover, focus ring and keyboard behaviour that the hand-built cards had to
 * approximate. The icons carry no colour of their own; on a flat surface a coloured chip beside
 * every row is decoration competing with the text.
 */

const SUGGESTIONS = [
  { icon: UserMultiple, text: 'Show me all students in Grade 10' },
  { icon: ChartColumn, text: 'Who are the top 5 students by GPA?' },
  { icon: Book, text: 'Tell me about Emma Johnson' },
  { icon: Search, text: 'Which students take Computer Science?' },
  { icon: Document, text: 'Show attendance records for Grade 12' },
  { icon: Education, text: 'List all students in Section A' },
];

const CAPABILITIES = [
  { icon: Search, label: 'Text search' },
  { icon: Microphone, label: 'Voice input' },
  { icon: ImageIcon, label: 'Image analysis' },
];

const WelcomeScreen: React.FC = () => {
  const { sendMessage, students } = useChatContext();

  // The school's own numbers, not a sample. These were hardcoded — every school saw "15 students,
  // 93% attendance" regardless of its roll — which is worse than showing nothing, because it looks
  // like data. Null until the students land, so the band never shows a figure that is wrong.
  const stats = useMemo(() => {
    if (!students.length) return null;
    const attendance =
      students.reduce((sum, student) => sum + (student.attendance_rate || 0), 0) / students.length;
    return [
      { label: 'Students', value: String(students.length) },
      { label: 'Grades', value: String(new Set(students.map(s => s.grade_level)).size) },
      { label: 'Sections', value: String(new Set(students.map(s => s.class_section)).size) },
      { label: 'Avg attendance', value: `${attendance.toFixed(0)}%` },
    ];
  }, [students]);

  return (
    <div className={styles.screen}>
      <div className={styles.mark}>
        <Education size={32} />
      </div>

      <h1 className={styles.title}>SchoolBot AI</h1>
      <p className={styles.lede}>
        Your school information assistant. Ask anything about students, grades and attendance.
      </p>

      <div className={styles.capabilities}>
        {CAPABILITIES.map(({ icon: Icon, label }) => (
          <Tag key={label} type="outline" renderIcon={Icon} size="md">
            {label}
          </Tag>
        ))}
      </div>

      <div className={styles.suggestions}>
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <ClickableTile key={text} className={styles.tile} onClick={() => sendMessage(text)}>
            <span className={styles.suggestion}>
              <Icon size={20} />
              {text}
            </span>
          </ClickableTile>
        ))}
      </div>

      {stats && (
        <dl className={styles.stats}>
          {stats.map(({ label, value }) => (
            <div key={label} className={styles.stat}>
              <dd>{value}</dd>
              <dt>{label}</dt>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

export default WelcomeScreen;
