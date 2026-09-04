import { supabase } from './supabase';

/**
 * Clubs, school requirements, and the matron's dormitory screens.
 *
 * One module for the three because they are one part of school life: what a child joins, what they
 * were asked to bring, and the person who notices when they did not. Each is a thin typed wrapper
 * over its `/api/functions/*` endpoint, in the same shape as `callFees` — the server decides who
 * may do what from the session, so nothing about identity travels in these bodies.
 */

/** The four bands a requirements list is scoped to. Mirrors REQUIREMENT_LEVELS on the server. */
export type RequirementLevel = 'kindergarten' | 'primary' | 'secondary' | 'tertiary';

export type RequirementCategory = 'cleaning' | 'scholastic' | 'personal' | 'bedding' | 'other';

export const REQUIREMENT_LEVELS: { value: RequirementLevel; label: string; grades: string }[] = [
  { value: 'kindergarten', label: 'Kindergarten / Nursery', grades: 'Baby, Middle and Top class' },
  { value: 'primary', label: 'Primary', grades: 'Primary 1 to Primary 7' },
  { value: 'secondary', label: 'Secondary', grades: 'Senior 1 to Senior 6' },
  { value: 'tertiary', label: 'Tertiary / Technical', grades: 'Institute and university' },
];

export const REQUIREMENT_CATEGORIES: { value: RequirementCategory; label: string }[] = [
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'scholastic', label: 'Scholastic' },
  { value: 'personal', label: 'Personal' },
  { value: 'bedding', label: 'Bedding' },
  { value: 'other', label: 'Other' },
];

/**
 * Which band a class falls in.
 *
 * The same bands as `levelForGrade` in server/services/requirements.mjs and `inferAcademicLevel` in
 * server/reports/grading-config.mjs. Duplicated here rather than fetched because the student form
 * needs it the moment a class is picked, before anything is saved — but it must not drift from the
 * server, which is what decides the list that is actually stored.
 */
export const levelForGrade = (gradeLevel: number | string | null | undefined): RequirementLevel | null => {
  const grade = Number(gradeLevel);
  if (!Number.isFinite(grade)) return null;
  if (grade <= 0) return 'kindergarten';
  if (grade <= 7) return 'primary';
  if (grade <= 13) return 'secondary';
  return 'tertiary';
};

export interface Club {
  id: string;
  name: string;
  description: string;
  category: string;
  patron_name: string;
  patron_user_id: string | null;
  meeting_day: string;
  meeting_time: string;
  venue: string;
  /** null means no limit, which is the usual case. */
  capacity: number | null;
  status: 'active' | 'archived';
  member_count: number;
  full: boolean;
}

export interface ClubMember {
  id: string;
  student_id: string;
  student_number: string;
  full_name: string;
  grade_level: number;
  class_section: string;
  joined_on: string;
  left_on: string | null;
  status: 'active' | 'left';
}

export interface RequirementItem {
  id: string;
  item_name: string;
  category: RequirementCategory;
  unit: string;
  quantity: number;
  school_level: RequirementLevel;
  /** null means the whole level; a number narrows it to one class. */
  grade_level: number | null;
  mandatory: boolean;
  boarding_only: boolean;
  notes: string;
  status: 'active' | 'archived';
}

/** One item as it stands for a named student in a named term. */
export interface StudentRequirement {
  requirement_id: string;
  item_name: string;
  category: RequirementCategory;
  unit: string;
  quantity: number;
  mandatory: boolean;
  boarding_only: boolean;
  notes: string;
  status: 'pending' | 'brought' | 'waived';
  quantity_expected: number;
  quantity_brought: number;
  note: string;
  recorded_by: string;
  recorded_at: string | null;
}

export interface OwingStudent {
  id: string;
  student_id: string;
  full_name: string;
  grade_level: number;
  class_section: string;
  level: RequirementLevel;
  boarder: boolean;
  owing: number;
  /** The names, already joined — the server groups these because pg-mem has no string_agg. */
  items: string;
  item_list: { requirement_id: string; item_name: string; category: string; quantity: number; unit: string }[];
  /* Present only on the matron's welfare list, which starts from the boarders and therefore knows
     where each one sleeps. The office's own outstanding list starts from the roll and does not. */
  hostel_name?: string;
  room_number?: string;
  student_number?: string;
}

export interface MatronDashboardData {
  date: string;
  check: 'morning' | 'night';
  boarders: number;
  in_sick_bay: number;
  signed_out: number;
  owing_requirements: number;
  rooms: number;
  beds: number;
  beds_free: number;
  roll: { present: number; absent: number; sick_bay: number; away: number; unmarked: number };
}

export type RollStatus = 'present' | 'absent' | 'sick_bay' | 'away';

export interface DormRollEntry {
  id: string;
  student_number: string;
  full_name: string;
  grade_level: number;
  class_section: string;
  hostel_name: string;
  room_number: string;
  room_id: string;
  bed_number: string | null;
  /** '' when nobody has marked this student yet — the whole reason for taking a roll. */
  status: RollStatus | '';
  note: string;
  recorded_by: string;
  recorded_at: string | null;
  in_sick_bay: boolean;
  signed_out: boolean;
}

export interface SickBayRecord {
  id: string;
  student_id: string;
  student_number: string;
  full_name: string;
  grade_level: number;
  class_section: string;
  parent_name: string;
  parent_phone: string;
  complaint: string;
  treatment: string;
  temperature: string | number | null;
  admitted_at: string;
  discharged_at: string | null;
  outcome: string;
  referred_to: string;
  parent_informed: boolean;
  note: string;
  recorded_by: string;
  open: boolean;
}

/** A child in a bed, as the room list reports them. */
export interface RoomOccupant {
  assignment_id: string;
  room_id: string;
  bed_number: string | null;
  start_date: string;
  student_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  grade_level: number | string | null;
  class_section: string | null;
}

export interface HostelRoom {
  id: string;
  hostel_name: string;
  room_number: string;
  capacity: number;
  occupants: RoomOccupant[];
  occupied: number;
  free: number;
  full: boolean;
}

/**
 * One call, one place to throw.
 *
 * Every one of these endpoints reports a refusal or a validation failure as `{ error }` rather than
 * as a non-2xx, so the shim hands it back in `error` and this turns it into an exception each
 * screen's action wrapper can show.
 */
const call = async <T>(fn: 'clubs' | 'requirements' | 'matron', body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body });
  if (error) throw error;
  return data as T;
};

export const clubsApi = {
  list: (includeArchived = false) =>
    call<{ clubs: Club[] }>('clubs', { action: 'list', includeArchived }),
  create: (club: Partial<Club> & { name: string }) =>
    call<{ club: Club }>('clubs', { action: 'create', ...club }),
  update: (clubId: string, changes: Partial<Club>) =>
    call<{ club: Club }>('clubs', { action: 'update', clubId, ...changes }),
  archive: (clubId: string, restore = false) =>
    call<{ club: Club }>('clubs', { action: 'archive', clubId, restore }),
  roster: (clubId: string, includeLeft = false) =>
    call<{ members: ClubMember[] }>('clubs', { action: 'roster', clubId, includeLeft }),
  forStudent: (studentId: string) =>
    call<{ clubs: (Club & { club_id: string })[] }>('clubs', { action: 'for_student', studentId }),
  join: (clubId: string, studentId: string) =>
    call<{ member?: ClubMember; already?: boolean }>('clubs', { action: 'join', clubId, studentId }),
  leave: (clubId: string, studentId: string) =>
    call<{ member: ClubMember }>('clubs', { action: 'leave', clubId, studentId }),
};

export interface TermScope {
  term?: string;
  academicYear?: string;
}

export const requirementsApi = {
  catalogue: (level?: RequirementLevel | '', includeArchived = false) =>
    call<{ items: RequirementItem[] }>('requirements', {
      action: 'catalogue', level: level || undefined, includeArchived,
    }),
  addItem: (item: Partial<RequirementItem> & { itemName: string; level: RequirementLevel }) =>
    call<{ item: RequirementItem }>('requirements', { action: 'add_item', ...item }),
  updateItem: (itemId: string, changes: Record<string, unknown>) =>
    call<{ item: RequirementItem }>('requirements', { action: 'update_item', itemId, ...changes }),
  archiveItem: (itemId: string, restore = false) =>
    call<{ item: RequirementItem }>('requirements', { action: 'archive_item', itemId, restore }),
  forStudent: (studentId: string, scope: TermScope = {}) =>
    call<{
      level: RequirementLevel | null; boarder: boolean; items: StudentRequirement[];
      term: string; academic_year: string;
    }>('requirements', { action: 'for_student', studentId, ...scope }),
  record: (
    studentId: string,
    requirementId: string,
    status: 'pending' | 'brought' | 'waived',
    scope: TermScope = {},
    extra: { quantityBrought?: number; note?: string } = {},
  ) =>
    call<{ record: unknown }>('requirements', {
      action: 'record', studentId, requirementId, status, ...scope, ...extra,
    }),
  /** Writes the whole applicable list for a student, marking `brought` as arrived. */
  assign: (studentId: string, brought: string[], scope: TermScope = {}) =>
    call<{ level: RequirementLevel | null; assigned: number }>('requirements', {
      action: 'assign', studentId, brought, ...scope,
    }),
  outstanding: (filters: { gradeLevel?: number | ''; classSection?: string } & TermScope = {}) =>
    call<{ students: OwingStudent[]; term: string; academic_year: string }>('requirements', {
      action: 'outstanding', ...filters,
    }),
};

export const matronApi = {
  dashboard: (date?: string, check?: 'morning' | 'night') =>
    call<MatronDashboardData>('matron', { action: 'dashboard', date, check }),
  dormRoll: (date?: string, check?: 'morning' | 'night', hostel?: string) =>
    call<{ date: string; check: string; students: DormRollEntry[] }>('matron', {
      action: 'dorm_roll', date, check, hostel,
    }),
  mark: (studentId: string, status: RollStatus, opts: { date?: string; check?: string; note?: string } = {}) =>
    call<{ check: unknown }>('matron', { action: 'mark', studentId, status, ...opts }),
  sickBay: (includeDischarged = false) =>
    call<{ records: SickBayRecord[] }>('matron', { action: 'sick_bay', includeDischarged }),
  admit: (studentId: string, details: { complaint: string; temperature?: number; treatment?: string; note?: string }) =>
    call<{ record: SickBayRecord; already?: boolean }>('matron', { action: 'admit', studentId, ...details }),
  discharge: (recordId: string, details: { outcome: string; treatment?: string; referredTo?: string; parentInformed?: boolean; note?: string }) =>
    call<{ record: SickBayRecord }>('matron', { action: 'discharge', recordId, ...details }),
  rooms: () => call<{ rooms: HostelRoom[] }>('matron', { action: 'rooms' }),
  assignBed: (studentId: string, roomId: string, bedNumber?: string) =>
    call<{ assignment: unknown; already?: boolean }>('matron', { action: 'assign_bed', studentId, roomId, bedNumber }),
  releaseBed: (studentId: string) =>
    call<{ assignment: unknown }>('matron', { action: 'release_bed', studentId }),
  saveRoom: (room: { roomId?: string; hostelName: string; roomNumber: string; capacity: number }) =>
    call<{ room: HostelRoom }>('matron', { action: 'save_room', ...room }),
  removeRoom: (roomId: string) =>
    call<{ removed: string }>('matron', { action: 'remove_room', roomId }),
  welfare: (hostel?: string) =>
    call<{ students: OwingStudent[] }>('matron', { action: 'welfare', hostel }),
};
