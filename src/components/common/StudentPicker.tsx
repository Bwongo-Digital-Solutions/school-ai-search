import React, { useMemo } from 'react';
import { ComboBox } from '@carbon/react';
import { classLabel } from '@/lib/classLevels';
import { useSettings } from '@/contexts/SettingsContext';
import type { Student } from '@/types/chat';

interface StudentPickerProps {
  /** The chosen student's id, or '' for none. */
  value: string;
  onChange: (studentId: string) => void;
  students: Student[];
  label?: string;
  placeholder?: string;
  /** Hide the visible label where the surrounding layout already says what this is. */
  hideLabel?: boolean;
  /** Marks the field required, for the forms that cannot be submitted without a student. */
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  invalidText?: string;
  helperText?: string;
  size?: 'sm' | 'md' | 'lg';
  id?: string;
  className?: string;
}

const fullName = (student: Student) => `${student.first_name} ${student.last_name}`.trim();

/**
 * Choosing a student, by typing.
 *
 * A plain dropdown is the wrong control here and gets worse as a school grows: by a few hundred
 * students, finding one means scrolling a list ordered by nothing you can predict. A combo box lets
 * whoever is holding the register type what they already know.
 *
 * Matching is deliberately broad — first name, surname, student number, or class — because the
 * thing to hand differs by desk. The bursar has an invoice with a student number on it; the class
 * teacher has a name; the person covering a lesson knows only "someone in 10-A". Each of those is a
 * reasonable thing to type, so each of them works, and so does the whole label at once.
 */
export const StudentPicker: React.FC<StudentPickerProps> = ({
  value,
  onChange,
  students,
  label: labelText = 'Student',
  placeholder = 'Type a name, student number or class…',
  hideLabel,
  required,
  disabled,
  invalid,
  invalidText,
  helperText,
  size = 'md',
  id = 'student-picker',
  className: cls,
}) => {
  const { settings } = useSettings();

  // The class reads in the school's own words — "Primary 5 A", not "Grade 5A" — because that is
  // what is written on the register the person choosing is holding.
  const describe = (student: Student) =>
    [
      fullName(student),
      student.student_id,
      [classLabel(settings.school_level, student.grade_level), student.class_section]
        .filter(Boolean)
        .join(' '),
    ].join(' · ');

  const selected = useMemo(
    () => students.find(student => student.id === value) ?? null,
    [students, value],
  );

  return (
    <ComboBox
      id={id}
      className={cls}
      size={size}
      // ComboBox has no hideLabel of its own, so the label is hidden the way Carbon hides any
      // label — visually, while leaving it for a screen reader.
      titleText={
        hideLabel ? <span className="cds--visually-hidden">{labelText}</span> : labelText
      }
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      invalid={invalid}
      invalidText={invalidText}
      helperText={helperText}
      items={students}
      selectedItem={selected}
      itemToString={(student) => (student ? describe(student as Student) : '')}
      shouldFilterItem={({ item, inputValue }) => {
        const query = (inputValue || '').trim().toLowerCase();
        if (!query) return true;
        const student = item as Student;
        // Every word has to match something, so "olivia 11" narrows rather than widening.
        const haystack = [
          fullName(student),
          student.student_id,
          classLabel(settings.school_level, student.grade_level),
          student.class_section,
          student.email,
        ]
          .join(' ')
          .toLowerCase();
        return query.split(/\s+/).every(word => haystack.includes(word));
      }}
      onChange={({ selectedItem }) => onChange((selectedItem as Student | null)?.id ?? '')}
    />
  );
};

export default StudentPicker;
