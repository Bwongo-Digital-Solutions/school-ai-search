/**
 * Pure fee arithmetic: money rounding, bursary discounts, document numbers, aging buckets and
 * the payment reliability rating. Nothing here touches the database, so every rule below can be
 * tested directly without a runtime — see the "fee math" tests in tests/local-backend.test.mjs.
 */

// Keep in sync with the CHECK constraint on student_fee_standings.standing in
// server/db/schema.mjs and with FeeStanding in src/types/feeAdmin.ts.
export const FEE_STANDINGS = ['excellent', 'good', 'fair', 'watch', 'delinquent'];

export const DISCOUNT_TYPES = ['percentage', 'fixed'];

export const AGING_BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_90_plus'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// An invoice is settled once its balance rounds away to nothing. Comparing against a bare 0
// would leave a sub-cent NUMERIC remainder looking like an outstanding debt forever.
const SETTLED_EPSILON = 0.005;

// Late by a couple of days is a bank clearing delay, not a payment habit. The grace applies to
// the on-time/late counters the UI shows; the score itself uses raw lateness so it degrades
// smoothly instead of stepping at the boundary.
const PUNCTUALITY_GRACE_DAYS = 3;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const toAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

export const toIsoDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

export const roundMoney = (value) => Math.round((toAmount(value) + Number.EPSILON) * 100) / 100;

/** Whole days from `from` to `to`, both read as calendar dates so clock times cannot skew it. */
export const dayDiff = (to, from) => {
  const toDate = toIsoDate(to);
  const fromDate = toIsoDate(from);
  if (!toDate || !fromDate) return null;
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / MS_PER_DAY);
};

/* -------------------------------------------------------------------------- */
/* Document numbers                                                            */
/* -------------------------------------------------------------------------- */

// Zero-padded to a fixed width so lexicographic order matches numeric order. That is what lets
// the allocator find the latest number with ORDER BY ... DESC LIMIT 1 instead of casting, and
// padding happens here in JS because pg-mem implements neither LPAD nor to_char.
export const DOCUMENT_SEQUENCE_WIDTH = 6;

export const formatDocumentNumber = (prefix, year, sequence) =>
  `${prefix}-${year}-${String(sequence).padStart(DOCUMENT_SEQUENCE_WIDTH, '0')}`;

export const parseDocumentSequence = (value) => {
  const match = /-(\d+)$/.exec(String(value ?? ''));
  return match ? Number(match[1]) : 0;
};

/* -------------------------------------------------------------------------- */
/* Bursaries                                                                   */
/* -------------------------------------------------------------------------- */

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

/** A bursary with a blank structure, year or term is a wildcard that matches every invoice. */
export const bursaryApplies = (bursary, { structure = {}, issueDate = null } = {}) => {
  if (bursary.status && bursary.status !== 'active') return false;

  if (!isBlank(bursary.fee_structure_id) && bursary.fee_structure_id !== structure.id) return false;
  if (!isBlank(bursary.academic_year) && bursary.academic_year !== structure.academic_year) return false;
  if (!isBlank(bursary.term) && bursary.term !== structure.term) return false;

  const on = toIsoDate(issueDate);
  if (on) {
    const start = toIsoDate(bursary.start_date);
    const end = toIsoDate(bursary.end_date);
    if (start && on < start) return false;
    if (end && on > end) return false;
  }

  return true;
};

/**
 * Reduces a gross fee by every bursary that applies to it.
 *
 * Percentages are summed and then capped at 100 rather than compounded: a bursar reading
 * "50% sponsor + 30% staff child" means 80% off, and quietly charging 65% instead would be
 * impossible to defend at the counter. Fixed amounts apply on top, and the combined discount is
 * clamped to the gross so an invoice can never go negative.
 */
export const applyBursariesToAmount = ({ gross, bursaries = [], structure = {}, issueDate = null }) => {
  const grossAmount = Math.max(0, roundMoney(gross));
  const applicable = bursaries.filter((bursary) => bursaryApplies(bursary, { structure, issueDate }));

  let percentageTotal = 0;
  let fixedTotal = 0;
  for (const bursary of applicable) {
    const value = toAmount(bursary.discount_value);
    if (bursary.discount_type === 'fixed') fixedTotal += Math.max(0, value);
    else percentageTotal += clamp(value, 0, 100);
  }
  percentageTotal = Math.min(100, percentageTotal);

  const rawDiscount = (grossAmount * percentageTotal) / 100 + fixedTotal;
  const discountTotal = roundMoney(Math.min(grossAmount, rawDiscount));
  const net = roundMoney(grossAmount - discountTotal);

  // Apportion the (possibly clamped) total across the bursaries so the discount lines always
  // sum to discount_total exactly. Any rounding remainder lands on the last line.
  const shares = applicable.map((bursary) => {
    const value = toAmount(bursary.discount_value);
    return bursary.discount_type === 'fixed'
      ? Math.max(0, value)
      : (grossAmount * clamp(value, 0, 100)) / 100;
  });
  const shareTotal = shares.reduce((sum, share) => sum + share, 0);

  let assigned = 0;
  const discounts = applicable.map((bursary, index) => {
    const isLast = index === applicable.length - 1;
    const amount = isLast
      ? roundMoney(discountTotal - assigned)
      : roundMoney(shareTotal > 0 ? (shares[index] / shareTotal) * discountTotal : 0);
    assigned = roundMoney(assigned + amount);
    return {
      bursary_id: bursary.id,
      name: bursary.name,
      discount_type: bursary.discount_type,
      discount_value: toAmount(bursary.discount_value),
      amount,
    };
  });

  return { gross: grossAmount, discountTotal, net, discounts, percentageTotal, fixedTotal };
};

/** Invoice line items, with discounts held as negatives so the lines sum to total_amount. */
export const buildInvoiceLineItems = ({ structure, gross, discounts = [] }) => [
  {
    type: 'fee',
    fee_structure_id: structure.id ?? null,
    description: `${structure.name} — ${structure.term} ${structure.academic_year}`,
    amount: roundMoney(gross),
  },
  ...discounts
    .filter((discount) => discount.amount > 0)
    .map((discount) => ({
      type: 'discount',
      bursary_id: discount.bursary_id,
      discount_type: discount.discount_type,
      discount_value: discount.discount_value,
      description:
        discount.discount_type === 'percentage'
          ? `Bursary: ${discount.name} (${discount.discount_value}%)`
          : `Bursary: ${discount.name}`,
      amount: roundMoney(-discount.amount),
    })),
];

/* -------------------------------------------------------------------------- */
/* Aging                                                                       */
/* -------------------------------------------------------------------------- */

export const agingBucketFor = (daysOverdue) => {
  if (daysOverdue === null || daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days_1_30';
  if (daysOverdue <= 60) return 'days_31_60';
  if (daysOverdue <= 90) return 'days_61_90';
  return 'days_90_plus';
};

export const emptyAgingBuckets = () =>
  AGING_BUCKETS.reduce((buckets, key) => ({ ...buckets, [key]: 0 }), {});

/* -------------------------------------------------------------------------- */
/* Payment rating                                                              */
/* -------------------------------------------------------------------------- */

export const GRADE_THRESHOLDS = [
  { min: 85, grade: 'A', standing: 'excellent' },
  { min: 70, grade: 'B', standing: 'good' },
  { min: 55, grade: 'C', standing: 'fair' },
  { min: 40, grade: 'D', standing: 'watch' },
  { min: 0, grade: 'E', standing: 'delinquent' },
];

export const gradeForScore = (score) =>
  GRADE_THRESHOLDS.find((threshold) => score >= threshold.min) ?? GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];

const confidenceFor = (settledWithDueCount) => {
  if (settledWithDueCount >= 5) return 'high';
  if (settledWithDueCount >= 2) return 'medium';
  return 'low';
};

/**
 * Scores how reliably a family pays, from 100 (always early, nothing owing) downwards.
 *
 * Three independent penalties, so a single bad habit cannot mask a different one:
 *   punctuality  — how late settled invoices were paid, capped at 40 (27 days average = full)
 *   exposure     — how much of the money already due is still unpaid, capped at 30
 *   delinquency  — how long the oldest unpaid invoice has been overdue, capped at 30 (60 days)
 *
 * Exposure and delinquency deliberately look only at invoices whose due date has arrived.
 * Counting invoices billed for a future term would drop every family to "delinquent" the
 * moment next term's fees were raised, which is the opposite of what the rating is for.
 */
export const computePaymentRating = ({ invoices = [], payments = [], asOf = new Date() } = {}) => {
  const on = toIsoDate(asOf);

  const paymentsByInvoice = new Map();
  for (const payment of payments) {
    if (!payment.invoice_id) continue;
    const paidAt = toIsoDate(payment.paid_at);
    if (!paidAt) continue;
    const latest = paymentsByInvoice.get(payment.invoice_id);
    if (!latest || paidAt > latest) paymentsByInvoice.set(payment.invoice_id, paidAt);
  }

  const lateDays = [];
  let settledCount = 0;
  let untracedSettledCount = 0;
  let onTimeCount = 0;
  let lateCount = 0;
  let overdueCount = 0;
  let maxDaysOverdue = 0;
  let dueInvoiced = 0;
  let dueOutstanding = 0;
  let totalInvoiced = 0;
  let outstanding = 0;

  for (const invoice of invoices) {
    const balance = toAmount(invoice.balance_due);
    const total = toAmount(invoice.total_amount);
    const dueDate = toIsoDate(invoice.due_date);
    const settled = balance <= SETTLED_EPSILON;

    totalInvoiced += total;
    outstanding += Math.max(0, balance);

    // "Due" means the money has actually been asked for: no due date means payable on issue.
    if (!dueDate || dueDate <= on) {
      dueInvoiced += total;
      dueOutstanding += Math.max(0, balance);
    }

    if (settled) {
      settledCount += 1;
      const settledAt = paymentsByInvoice.get(invoice.id);
      // Invoices settled without a linked payment predate payment/invoice linking. They say
      // nothing about punctuality either way, so they are counted but never scored.
      if (!settledAt || !dueDate) {
        untracedSettledCount += 1;
      } else {
        const days = Math.max(0, dayDiff(settledAt, dueDate) ?? 0);
        lateDays.push(days);
        if (days <= PUNCTUALITY_GRACE_DAYS) onTimeCount += 1;
        else lateCount += 1;
      }
    } else if (dueDate && dueDate < on) {
      overdueCount += 1;
      maxDaysOverdue = Math.max(maxDaysOverdue, dayDiff(on, dueDate) ?? 0);
    }
  }

  const settledWithDueCount = lateDays.length;
  const totalPaid = payments.reduce((sum, payment) => sum + toAmount(payment.amount), 0);
  const lastPaymentAt = payments.reduce((latest, payment) => {
    const paidAt = payment.paid_at instanceof Date ? payment.paid_at.toISOString() : payment.paid_at;
    return paidAt && (!latest || paidAt > latest) ? paidAt : latest;
  }, null);

  const avgDaysLate = settledWithDueCount
    ? lateDays.reduce((sum, days) => sum + days, 0) / settledWithDueCount
    : 0;
  const balanceRatio = dueInvoiced > 0 ? clamp(dueOutstanding / dueInvoiced, 0, 1) : 0;

  const metrics = {
    invoiceCount: invoices.length,
    settledCount,
    untracedSettledCount,
    onTimeCount,
    lateCount,
    avgDaysLate: Math.round(avgDaysLate * 10) / 10,
    maxDaysOverdue,
    overdueCount,
    dueInvoiced: roundMoney(dueInvoiced),
    dueOutstanding: roundMoney(dueOutstanding),
    balanceRatio: Math.round(balanceRatio * 1000) / 1000,
    totalInvoiced: roundMoney(totalInvoiced),
    totalPaid: roundMoney(totalPaid),
    outstanding: roundMoney(outstanding),
    lastPaymentAt,
  };

  // Nothing has ever come due, so there is no evidence to rate. Scoring this as a perfect 100
  // would hand a brand-new student the same standing as a family with six years of early
  // payments, which is exactly the judgement the rating exists to distinguish.
  if (settledWithDueCount === 0 && overdueCount === 0 && dueInvoiced === 0) {
    return {
      score: null,
      grade: null,
      standing: 'unrated',
      confidence: 'none',
      reason: 'no_billing_history',
      metrics,
      penalties: { punctuality: 0, exposure: 0, delinquency: 0 },
    };
  }

  const punctuality = Math.min(40, avgDaysLate * 1.5);
  const exposure = 30 * balanceRatio;
  const delinquency = Math.min(30, maxDaysOverdue * 0.5);
  const score = clamp(Math.round(100 - punctuality - exposure - delinquency), 0, 100);
  const { grade, standing } = gradeForScore(score);

  return {
    score,
    grade,
    standing,
    confidence: confidenceFor(settledWithDueCount),
    reason: null,
    metrics,
    penalties: {
      punctuality: Math.round(punctuality * 10) / 10,
      exposure: Math.round(exposure * 10) / 10,
      delinquency: Math.round(delinquency * 10) / 10,
    },
  };
};

/**
 * Combines the computed rating with an admin's manual standing.
 *
 * An active override always wins, and `review_date` never expires it — it only raises
 * `review_due` so the Ratings tab can prompt someone to look again. Letting a standing lapse on
 * its own would silently reinstate a gate block overnight for a family with a signed payment
 * arrangement; a stale row an admin can see and clear is the safer failure.
 */
export const resolveEffectiveStanding = ({ computed, override = null, asOf = new Date() } = {}) => {
  const on = toIsoDate(asOf);
  const reviewDate = override ? toIsoDate(override.review_date) : null;

  return {
    standing: override ? override.standing : computed.standing,
    source: override ? 'manual' : 'computed',
    computed,
    override: override
      ? {
          id: override.id,
          student_id: override.student_id,
          standing: override.standing,
          note: override.note,
          review_date: reviewDate,
          set_by: override.set_by,
          set_at: override.set_at instanceof Date ? override.set_at.toISOString() : override.set_at,
          review_due: reviewDate !== null && reviewDate <= on,
        }
      : null,
  };
};
