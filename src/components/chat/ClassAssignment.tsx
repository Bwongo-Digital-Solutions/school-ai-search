import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tag } from '@carbon/react';
import { Add, TrashCan } from '@carbon/react/icons';
import { Field } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { classOptionsFor } from '@/lib/classLevels';
import { assignClass, loadTeacherClasses, removeClass, type TeacherClass } from '@/lib/staffAssignment';
import type { UserProfile } from '@/types/auth';
import styles from './tabs.module.scss';

interface Props {
  person: UserProfile;
  onClose: () => void;
}

const todayYear = () => String(new Date().getFullYear());

/**
 * Which classes a teacher takes.
 *
 * This existed only inside the Teacher Performance report, which is where you go to read how
 * somebody is doing rather than to give them a class — so the allocation nobody had made left the
 * phone saying "You have no classes yet" with no obvious way to fix it. Same server actions,
 * reached from the screen where an administrator manages the person.
 *
 * Assigning also links the account to its `teachers` row (`ensureTeacherRecord` on the server),
 * which is the part that actually makes the class appear on their phone: an allocation against an
 * unlinked login shows up nowhere at all.
 */
const ClassAssignment: React.FC<Props> = ({ person, onClose }) => {
  const { notify } = useNotifications();
  const { settings } = useSettings();

  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [classSection, setClassSection] = useState('');
  const [academicYear, setAcademicYear] = useState(todayYear());
  const [term, setTerm] = useState('Term 1');

  const load = useCallback(async () => {
    try {
      setClasses(await loadTeacherClasses(person.id));
    } catch (err) {
      console.error('Could not load the classes:', err);
      setClasses([]);
      notify.error('Could not load their classes', err instanceof Error ? err.message : undefined);
    }
  }, [notify, person.id]);

  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!subject.trim()) { notify.error('Which subject?'); return; }
    if (!gradeLevel) { notify.error('Which class?'); return; }
    if (!classSection.trim()) { notify.error('Which section?'); return; }

    setBusy(true);
    try {
      const result = await assignClass({
        userId: person.id,
        subject: subject.trim(),
        gradeLevel: Number(gradeLevel),
        classSection: classSection.trim(),
        academicYear: academicYear.trim(),
        term,
      });
      // The student count is the useful confirmation: an allocation over an empty class is refused
      // by the server, so a number here means the marks register has rows to fill.
      notify.success(
        `${result.allocated.subject} assigned`,
        `${result.allocated.students} student${result.allocated.students === 1 ? '' : 's'} in that class.`,
      );
      setSubject('');
      await load();
    } catch (err) {
      notify.error('Could not assign that class', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: TeacherClass) => {
    setBusy(true);
    try {
      await removeClass({
        userId: person.id,
        subjectId: row.subject_id,
        gradeLevel: row.grade_level,
        classSection: row.class_section,
        academicYear: row.academic_year,
        term: row.term,
      });
      notify.success('Class removed', `${row.subject_name} · ${row.grade_level} ${row.class_section}`);
      await load();
    } catch (err) {
      notify.error('Could not remove that class', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      modalHeading={`Classes for ${person.display_name}`}
      modalLabel="Teaching"
      primaryButtonText="Assign the class"
      secondaryButtonText="Done"
      onRequestSubmit={assign}
      onRequestClose={onClose}
      primaryButtonDisabled={busy}
      hasScrollingContent
    >
      <div className={styles.stack}>
        {classes === null ? (
          <p className={styles.note}>Loading…</p>
        ) : classes.length === 0 ? (
          <p className={styles.note}>
            No classes yet. Until one is assigned, this teacher cannot enter marks — the phone tells
            them to ask an administrator, which is this screen.
          </p>
        ) : (
          <div className={styles.stack}>
            {classes.map((row) => (
              <div
                key={`${row.subject_id}-${row.grade_level}-${row.class_section}-${row.term}`}
                className={styles.rowPadBetween}
              >
                <span>
                  <strong>{row.subject_name || 'Unnamed subject'}</strong>{' '}
                  <Tag type="cool-gray" size="sm">{`${row.grade_level} ${row.class_section}`}</Tag>{' '}
                  <span className={styles.note}>{`${row.term} ${row.academic_year}`}</span>
                </span>
                <Button
                  hasIconOnly
                  kind="danger--ghost"
                  size="sm"
                  renderIcon={TrashCan}
                  iconDescription={`Remove ${row.subject_name}`}
                  tooltipPosition="left"
                  disabled={busy}
                  onClick={() => remove(row)}
                />
              </div>
            ))}
          </div>
        )}

        <div className={styles.grid}>
          <Field
            label="Subject"
            value={subject}
            onChange={setSubject}
            placeholder="Biology"
            hint="Made on first use if the school has not taught it before."
          />
          <Field
            label="Class"
            value={gradeLevel}
            onChange={(value) => setGradeLevel(String(value))}
            options={[
              { value: '', label: 'Choose a class' },
              ...classOptionsFor(settings.school_level).map((option) => ({
                value: String(option.value),
                label: option.label,
              })),
            ]}
          />
          <Field label="Section" value={classSection} onChange={setClassSection} placeholder="A" />
          <Field label="Academic year" value={academicYear} onChange={setAcademicYear} placeholder={todayYear()} />
          <Field
            label="Term"
            value={term}
            onChange={setTerm}
            options={['Term 1', 'Term 2', 'Term 3'].map((name) => ({ value: name, label: name }))}
          />
        </div>
        <p className={styles.note}>
          <Add size={14} /> Re-assigning the same class replaces it rather than doubling it, so a
          student who joined since is picked up and one who left drops out.
        </p>
      </div>
    </Modal>
  );
};

export default ClassAssignment;
