import { supabase } from './supabase';
import type { UserDesignation, UserRole } from '@/types/auth';

/**
 * The two things an administrator assigns to a member of staff: what post they hold, and which
 * classes they teach.
 *
 * Both already existed on the server and neither had a control anywhere in the app. The matron's
 * screens have worked for as long as a matron has existed — but nothing could make anyone a matron.
 * Class allocation was reachable only from inside the Teacher Performance report, which is not
 * where you go to give a teacher a class, so the phone kept saying "You have no classes yet".
 */

/**
 * Which designations each role may hold.
 *
 * Mirrors PROFILES in server/services/scan-profiles.mjs, which is what actually validates the save.
 * Duplicated rather than fetched because the form needs it the moment a row is drawn — but it must
 * not drift: a role missing here simply shows no control, and a wrong entry is refused by the
 * server in words rather than written.
 */
export const DESIGNATIONS_BY_ROLE: Partial<Record<UserRole, UserDesignation[]>> = {
  support_staff: ['askari', 'matron', 'cook'],
};

export const DESIGNATION_LABELS: Record<UserDesignation, string> = {
  askari: 'Gate keeper',
  matron: 'Matron',
  cook: 'Cook',
};

export const designationsForRole = (role: UserRole): UserDesignation[] => DESIGNATIONS_BY_ROLE[role] ?? [];

/** One class a teacher holds, as the allocations report lists them. */
export interface TeacherClass {
  subject_id: string;
  subject_name: string;
  grade_level: number;
  class_section: string;
  academic_year: string;
  term: string;
}

const call = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('teacher-performance', { body });
  if (error) throw error;
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
};

/**
 * The classes one member of staff holds, one row per class and subject.
 *
 * Not read off `summary`: that groups by class and drops the subject id, the year and the term,
 * which is enough to read a report and not enough to take an allocation back.
 */
export const loadTeacherClasses = (userId: string) =>
  call<{ allocations: TeacherClass[] }>({ action: 'allocations', userId })
    .then((data) => data.allocations ?? []);

/**
 * Give a teacher a class.
 *
 * The server creates the `teachers` row and links `users.teacher_id` on the way through
 * (ensureTeacherRecord), which is the part that actually makes the class appear on the teacher's
 * phone — an allocation against an unlinked account shows up nowhere.
 */
export const assignClass = (input: {
  userId: string;
  subject: string;
  gradeLevel: number;
  classSection: string;
  academicYear: string;
  term: string;
}) => call<{ allocated: { students: number; subject: string } }>({ action: 'allocate', ...input });

export const removeClass = (input: {
  userId: string;
  subjectId: string;
  gradeLevel: number;
  classSection: string;
  academicYear: string;
  term: string;
}) => call<{ removed: number }>({ action: 'unallocate', ...input });
