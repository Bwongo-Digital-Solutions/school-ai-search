import { supabase, buildApiUrl } from './supabase';

/**
 * One student, whole — what the summary screen renders.
 *
 * Every section is optional in the type because every section is optional in the response: the
 * server sends only what the reader's role may see, and does not query the rest. So `undefined`
 * here means "not yours to see", not "nothing on file" — a distinction the screen keeps, by saying
 * nothing at all about a section it did not receive rather than showing it empty.
 */

export interface SummaryStudent {
  id: string;
  student_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  class_section: string | null;
  status: string;
  lifecycle_status: string | null;
  photo_url: string;
  gpa: number | null;
  attendance_rate: number | null;
}

export interface SubjectResult {
  subject: string;
  score: number;
  max_score: number;
  grade: string | null;
  remarks: string | null;
}

export interface AttendanceEntry {
  attendance_date: string;
  status: string;
  reason: string | null;
}

export interface PaymentEntry {
  amount: number;
  currency: string;
  method: string;
  reference: string;
  paid_at: string;
  receipt_number: string;
}

export interface DisciplineEntry {
  id: string;
  incident_date: string;
  category: string;
  severity: string;
  description: string;
  action_taken: string | null;
  reported_by: string | null;
  guardian_notified: boolean;
  status: string;
}

export interface AdmissionEntry {
  id: string;
  application_number: string;
  grade_level: number;
  status: string;
  submitted_at: string;
  notes: string;
}

export interface PromotionEntry {
  id: string;
  from_grade_level: number;
  from_class_section: string | null;
  to_grade_level: number;
  to_class_section: string | null;
  academic_year: string;
  effective_date: string;
  decision: string;
  notes: string;
  approved_by: string | null;
}

export interface TransferEntry {
  id: string;
  movement_type: 'transfer' | 'withdrawal';
  effective_date: string;
  destination_school: string | null;
  reason: string;
  status: string;
  processed_by: string | null;
}

export interface StudentSummary {
  profile: { role: string; designation: string | null; label: string };
  sections: string[];
  student: SummaryStudent;
  bio?: {
    date_of_birth: string | null;
    gender: string | null;
    blood_group: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    enrollment_date: string | null;
    medical_record: unknown;
    notes: string | null;
  };
  class?: { grade_level: number; class_section: string | null; subjects: unknown };
  parents?: {
    parent_name: string | null;
    parent_phone: string | null;
    parent_email: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    emergency_contact_relation: string | null;
  };
  academics?: { subjects: SubjectResult[]; average: number };
  attendance?: {
    counts: Record<string, number>;
    total: number;
    rate: number;
    entries: AttendanceEntry[];
  };
  fees?: {
    currency: string;
    invoice_count: number;
    total_invoiced: number;
    total_paid: number;
    balance_due: number;
  };
  payments?: { currency: string; count: number; total_paid: number; entries: PaymentEntry[] };
  discipline?: { entries: DisciplineEntry[] };
  movements?: {
    admissions: AdmissionEntry[];
    promotions: PromotionEntry[];
    transfers: TransferEntry[];
  };
}

export const loadStudentSummary = async (code: string): Promise<StudentSummary> => {
  const { data, error } = await supabase.functions.invoke<StudentSummary>('student-summary', {
    body: { code },
  });
  if (error) throw error;
  if (!data) throw new Error('The summary came back empty.');
  return data;
};

/** The whole record as one PDF — the same document a guardian is emailed. */
export const studentReportUrl = (code: string) =>
  buildApiUrl(`/api/student-reports/${encodeURIComponent(code)}.pdf`);
