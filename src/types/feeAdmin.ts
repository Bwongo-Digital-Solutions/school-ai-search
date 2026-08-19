/**
 * Shapes for the admin fees workspace.
 *
 * Deliberately separate from src/types/fees.ts: that file describes the one payload the
 * support_staff role may read, and its field list is asserted by a backend test. Nothing here
 * may leak into it — ratings, standing notes, bursary sponsors and payment references are all
 * admin-only.
 */

// Keep in sync with FEE_STANDINGS in server/services/fee-math.mjs and the CHECK constraint on
// student_fee_standings.standing in server/db/schema.mjs.
export type FeeStanding = 'excellent' | 'good' | 'fair' | 'watch' | 'delinquent';
export type EffectiveFeeStanding = FeeStanding | 'unrated';
export type RatingGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export type RatingConfidence = 'none' | 'low' | 'medium' | 'high';
export type StandingSource = 'computed' | 'manual';
export type DiscountType = 'percentage' | 'fixed';
export type AgingBucketKey = 'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_90_plus';

export interface StudentIdentity {
  student_id: string;
  student_number: string;
  full_name: string;
  grade_level: number;
  class_section: string;
}

export interface FeeStructure {
  id: string;
  name: string;
  grade_level: number | null;
  student_type: string;
  academic_year: string;
  term: string;
  amount: number;
  currency: string;
  due_date: string | null;
  description: string;
  status: string;
  created_at: string;
  invoice_count: number;
}

export interface Bursary {
  id: string;
  student_id: string;
  name: string;
  sponsor: string;
  discount_type: DiscountType;
  discount_value: number;
  fee_structure_id: string | null;
  academic_year: string | null;
  term: string | null;
  start_date: string | null;
  end_date: string | null;
  status: 'active' | 'ended';
  notes: string;
  approved_by: string | null;
  created_at: string;
  student_number?: string;
  full_name?: string;
  grade_level?: number;
  class_section?: string;
}

export type InvoiceLineItem =
  | { type: 'fee'; fee_structure_id: string | null; description: string; amount: number }
  | {
      type: 'discount';
      bursary_id: string;
      discount_type: DiscountType;
      discount_value: number;
      description: string;
      amount: number;
    };

export interface InvoiceRecord {
  id: string;
  student_id: string;
  invoice_number: string;
  status: string;
  total_amount: number;
  balance_due: number;
  currency: string;
  due_date: string | null;
  issued_at: string;
  line_items: InvoiceLineItem[];
  fee_structure_id: string | null;
  academic_year: string | null;
  term: string | null;
  gross_amount: number | null;
  discount_total: number;
  notes: string;
}

export interface PaymentRecord {
  id: string;
  student_id: string;
  invoice_id: string | null;
  amount: number;
  currency: string;
  payment_method: string | null;
  reference: string | null;
  paid_at: string;
  received_by: string | null;
  notes: string;
}

export interface ReceiptRecord {
  id: string;
  payment_id: string;
  student_id: string | null;
  receipt_number: string;
  amount: number;
  currency: string;
  issued_at: string;
  issued_by: string | null;
}

export interface BillingDiscount {
  bursary_id: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  amount: number;
}

export interface BillingPreviewRow extends StudentIdentity {
  gross: number;
  discount_total: number;
  net: number;
  discounts: BillingDiscount[];
  already_invoiced: boolean;
  existing_invoice_number: string | null;
  line_items: InvoiceLineItem[];
}

export interface BillingPreview {
  feeStructure: FeeStructure;
  rows: BillingPreviewRow[];
  issueDate: string;
  dueDate: string | null;
  totals: {
    students: number;
    billable: number;
    skipped: number;
    gross: number;
    discount: number;
    net: number;
    currency: string;
  };
}

export interface RatingMetrics {
  invoiceCount: number;
  settledCount: number;
  untracedSettledCount: number;
  onTimeCount: number;
  lateCount: number;
  avgDaysLate: number;
  maxDaysOverdue: number;
  overdueCount: number;
  dueInvoiced: number;
  dueOutstanding: number;
  balanceRatio: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  lastPaymentAt: string | null;
}

export interface ComputedRating {
  score: number | null;
  grade: RatingGrade | null;
  standing: EffectiveFeeStanding;
  confidence: RatingConfidence;
  reason: string | null;
  metrics: RatingMetrics;
  penalties: { punctuality: number; exposure: number; delinquency: number };
}

export interface ManualStanding {
  id: string;
  student_id: string;
  standing: FeeStanding;
  note: string;
  review_date: string | null;
  set_by: string;
  set_at: string;
  review_due: boolean;
}

export interface EffectiveStanding {
  standing: EffectiveFeeStanding;
  source: StandingSource;
  computed: ComputedRating;
  override: ManualStanding | null;
}

export type StandingRow = StudentIdentity & EffectiveStanding;

export interface LedgerEntry {
  date: string;
  type: 'invoice' | 'payment';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StudentLedger {
  student: StudentIdentity;
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  receipts: ReceiptRecord[];
  bursaries: Bursary[];
  entries: LedgerEntry[];
  summary: {
    currency: string;
    total_invoiced: number;
    total_discounted: number;
    total_paid: number;
    balance_due: number;
  };
  rating: EffectiveStanding;
}

export type ArrearsRow = StudentIdentity &
  Record<AgingBucketKey, number> & {
    total_outstanding: number;
    oldest_due_date: string | null;
    days_overdue: number;
    standing: FeeStanding | null;
  };

export interface ArrearsReport {
  asOf: string;
  rows: ArrearsRow[];
  totals: Record<AgingBucketKey, number> & { total: number };
  currency: string;
}

export interface PaymentAllocation {
  invoice_id: string;
  invoice_number: string;
  applied: number;
  balance_due: number;
  status: string;
}

export interface RecordPaymentResult {
  payment: PaymentRecord;
  receipt: ReceiptRecord;
  allocations: PaymentAllocation[];
  creditAmount: number;
}

export interface FeesSummary {
  asOf: string;
  totals: { invoiced: number; collected: number; outstanding: number; currency: string };
  counts: {
    structures: number;
    activeBursaries: number;
    invoices: number;
    overdueStudents: number;
    overrides: number;
    reviewsDue: number;
  };
  standings: Record<EffectiveFeeStanding, number>;
}
