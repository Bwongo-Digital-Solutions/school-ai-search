export type FeeStatus = 'cleared' | 'partial' | 'unpaid' | 'overdue' | 'no_invoices';

/**
 * Fee payment status only. Deliberately carries no contact, academic, medical or
 * behavioural data — this is the one student-facing shape the support_staff role can read.
 */
export interface StudentFeeStatus {
  student_id: string;
  student_number: string;
  full_name: string;
  grade_level: number;
  class_section: string;
  currency: string;
  invoice_count: number;
  total_invoiced: number;
  total_paid: number;
  balance_due: number;
  next_due_date: string | null;
  last_payment_at: string | null;
  status: FeeStatus;
}
