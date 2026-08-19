/**
 * School fees administration: fee structures, bulk invoicing, payment capture with receipts,
 * per-student ledgers, arrears aging, bursaries and payment-standing overrides.
 *
 * Every action here is admin-only and reached through POST /api/functions/fees. Money mutations
 * deliberately do not go through the generic /api/db endpoint, which has no role check, no
 * validation beyond a column allow-list, and no transactions.
 */
import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/connection.mjs';
import {
  AGING_BUCKETS,
  DISCOUNT_TYPES,
  FEE_STANDINGS,
  agingBucketFor,
  applyBursariesToAmount,
  buildInvoiceLineItems,
  computePaymentRating,
  dayDiff,
  emptyAgingBuckets,
  resolveEffectiveStanding,
  roundMoney,
  toAmount,
  toIsoDate,
} from './fee-math.mjs';
import { issueReceipt, nextInvoiceNumbers } from './fee-documents.mjs';

const DEFAULT_CURRENCY = process.env.PAYMENT_CURRENCY || 'UGX';

const STUDENT_IDENTITY_COLUMNS = 'id, student_id, first_name, last_name, grade_level, class_section, status';

const trimmed = (value) => String(value ?? '').trim();

const positiveAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const identity = (student) => ({
  student_id: student.id,
  student_number: student.student_id,
  full_name: `${student.first_name} ${student.last_name}`,
  grade_level: student.grade_level,
  class_section: student.class_section,
});

const writeAudit = async (executor, actor, { action, entityType, entityId, entityName, changes }) => {
  await executor.query(
    `
      INSERT INTO audit_logs (
        id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      randomUUID(),
      actor.email,
      actor.name,
      actor.role,
      action,
      entityType,
      entityId || null,
      entityName || null,
      JSON.stringify(changes || {}),
    ],
  );
};

/* -------------------------------------------------------------------------- */
/* Shared loads                                                                */
/* -------------------------------------------------------------------------- */

const loadStudent = async (database, studentId) => {
  const { rows } = await database.query(
    `SELECT ${STUDENT_IDENTITY_COLUMNS} FROM students WHERE id = $1 OR UPPER(student_id) = UPPER($1) LIMIT 1`,
    [trimmed(studentId)],
  );
  return rows[0] || null;
};

const loadActiveStandings = async (database) => {
  const { rows } = await database.query(
    "SELECT * FROM student_fee_standings WHERE status = 'active'",
  );
  return new Map(rows.map((row) => [row.student_id, row]));
};

/** Computed rating plus any manual override, for one student. */
const ratingFor = async (database, studentId, asOf) => {
  const [invoices, payments, override] = await Promise.all([
    database.query('SELECT id, total_amount, balance_due, due_date FROM invoices WHERE student_id = $1', [studentId]),
    database.query('SELECT amount, paid_at, invoice_id FROM payments WHERE student_id = $1', [studentId]),
    database.query(
      "SELECT * FROM student_fee_standings WHERE student_id = $1 AND status = 'active' LIMIT 1",
      [studentId],
    ),
  ]);

  const computed = computePaymentRating({ invoices: invoices.rows, payments: payments.rows, asOf });
  return resolveEffectiveStanding({ computed, override: override.rows[0] || null, asOf });
};

/* -------------------------------------------------------------------------- */
/* Fee structures                                                              */
/* -------------------------------------------------------------------------- */

const listFeeStructures = async ({ database, body }) => {
  const includeArchived = body.includeArchived === true;
  const [structures, counts] = await Promise.all([
    database.query(
      includeArchived
        ? 'SELECT * FROM fee_structures ORDER BY academic_year DESC, term ASC, grade_level ASC, name ASC'
        : "SELECT * FROM fee_structures WHERE status = 'active' ORDER BY academic_year DESC, term ASC, grade_level ASC, name ASC",
    ),
    database.query(
      'SELECT fee_structure_id, COUNT(*)::int AS count FROM invoices WHERE fee_structure_id IS NOT NULL GROUP BY fee_structure_id',
    ),
  ]);

  const invoiceCounts = new Map(counts.rows.map((row) => [row.fee_structure_id, row.count]));
  return {
    structures: structures.rows.map((row) => ({ ...row, invoice_count: invoiceCounts.get(row.id) || 0 })),
  };
};

const saveFeeStructure = async ({ database, body, actor }) => {
  const name = trimmed(body.name);
  const academicYear = trimmed(body.academicYear);
  const term = trimmed(body.term);
  const amount = positiveAmount(body.amount);

  if (!name) return { error: 'Fee structure name is required' };
  if (!academicYear) return { error: 'Academic year is required' };
  if (!term) return { error: 'Term is required' };
  if (amount === null) return { error: 'Amount must be greater than zero' };

  const gradeLevel = body.gradeLevel === null || body.gradeLevel === undefined || body.gradeLevel === ''
    ? null
    : Number(body.gradeLevel);
  if (gradeLevel !== null && !Number.isInteger(gradeLevel)) return { error: 'Grade level must be a whole number' };

  const values = [
    name,
    gradeLevel,
    trimmed(body.studentType) || 'day',
    academicYear,
    term,
    roundMoney(amount),
    (trimmed(body.currency) || DEFAULT_CURRENCY).toUpperCase(),
    toIsoDate(body.dueDate),
    trimmed(body.description),
  ];

  const id = trimmed(body.id);
  const result = id
    ? await database.query(
        `
          UPDATE fee_structures
          SET name = $1, grade_level = $2, student_type = $3, academic_year = $4, term = $5,
              amount = $6, currency = $7, due_date = $8, description = $9
          WHERE id = $10
          RETURNING *
        `,
        [...values, id],
      )
    : await database.query(
        `
          INSERT INTO fee_structures (
            name, grade_level, student_type, academic_year, term, amount, currency, due_date, description, id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `,
        [...values, randomUUID()],
      );

  const structure = result.rows[0];
  if (!structure) return { error: 'Fee structure not found' };

  await withTransaction(database, (executor) =>
    writeAudit(executor, actor, {
      action: id ? 'fee_structure_updated' : 'fee_structure_created',
      entityType: 'fee_structure',
      entityId: structure.id,
      entityName: structure.name,
      changes: structure,
    }),
  );

  return { structure };
};

const deleteFeeStructure = async ({ database, body, actor }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'Fee structure id is required' };

  const existing = await database.query('SELECT * FROM fee_structures WHERE id = $1 LIMIT 1', [id]);
  const structure = existing.rows[0];
  if (!structure) return { error: 'Fee structure not found' };

  const used = await database.query(
    'SELECT COUNT(*)::int AS count FROM invoices WHERE fee_structure_id = $1',
    [id],
  );

  // Deleting a tier that already raised invoices would strand them, so archive instead. It
  // disappears from the billing picker either way; the difference only shows in history.
  const archived = (used.rows[0]?.count || 0) > 0;
  if (archived) {
    await database.query("UPDATE fee_structures SET status = 'archived' WHERE id = $1", [id]);
  } else {
    await database.query('DELETE FROM fee_structures WHERE id = $1', [id]);
  }

  await withTransaction(database, (executor) =>
    writeAudit(executor, actor, {
      action: archived ? 'fee_structure_archived' : 'fee_structure_deleted',
      entityType: 'fee_structure',
      entityId: id,
      entityName: structure.name,
      changes: { archived, invoice_count: used.rows[0]?.count || 0 },
    }),
  );

  return { deleted: !archived, archived };
};

/* -------------------------------------------------------------------------- */
/* Billing                                                                     */
/* -------------------------------------------------------------------------- */

const billingKeyFor = (structureId, studentId) => `${structureId}:${studentId}`;

/** Shared by preview and run so the numbers an admin confirms are the numbers that get billed. */
const buildBillingRows = async (database, body) => {
  const feeStructureId = trimmed(body.feeStructureId);
  if (!feeStructureId) return { error: 'A fee structure must be selected' };

  const structureResult = await database.query('SELECT * FROM fee_structures WHERE id = $1 LIMIT 1', [feeStructureId]);
  const structure = structureResult.rows[0];
  if (!structure) return { error: 'Fee structure not found' };
  if (structure.status !== 'active') return { error: 'This fee structure is archived and cannot be billed' };

  const conditions = ['status = $1'];
  const params = [trimmed(body.studentStatus) || 'active'];

  // A structure scoped to a grade only ever bills that grade, whatever the caller asks for.
  const gradeLevel = body.gradeLevel === null || body.gradeLevel === undefined || body.gradeLevel === ''
    ? structure.grade_level
    : Number(body.gradeLevel);
  if (gradeLevel !== null && gradeLevel !== undefined && Number.isFinite(gradeLevel)) {
    params.push(gradeLevel);
    conditions.push(`grade_level = $${params.length}`);
  }
  const classSection = trimmed(body.classSection);
  if (classSection) {
    params.push(classSection);
    conditions.push(`class_section = $${params.length}`);
  }

  const students = await database.query(
    `SELECT ${STUDENT_IDENTITY_COLUMNS} FROM students WHERE ${conditions.join(' AND ')} ORDER BY last_name, first_name`,
    params,
  );
  if (students.rows.length === 0) return { error: 'No students match this billing run' };

  const [bursaries, existing] = await Promise.all([
    // The bursary table holds at most one row per sponsored student, so loading the active ones
    // and matching in JS is cheaper than sending a student id list the width of the school.
    database.query("SELECT * FROM fee_bursaries WHERE status = 'active'"),
    // Selected by structure rather than by a list of billing keys: pg-mem silently returns no
    // rows for `= ANY($1)` against a uniquely indexed column, which would hide every invoice
    // that already exists and turn a re-run into a double-billing.
    database.query('SELECT student_id, invoice_number FROM invoices WHERE fee_structure_id = $1', [feeStructureId]),
  ]);

  const bursariesByStudent = new Map();
  for (const bursary of bursaries.rows) {
    if (!bursariesByStudent.has(bursary.student_id)) bursariesByStudent.set(bursary.student_id, []);
    bursariesByStudent.get(bursary.student_id).push(bursary);
  }
  const invoicedBy = new Map(existing.rows.map((row) => [row.student_id, row.invoice_number]));

  const issueDate = toIsoDate(body.issueDate) || toIsoDate(new Date());
  const dueDate = toIsoDate(body.dueDate) || toIsoDate(structure.due_date);
  const gross = toAmount(structure.amount);

  const rows = students.rows.map((student) => {
    const applied = applyBursariesToAmount({
      gross,
      bursaries: bursariesByStudent.get(student.id) || [],
      structure,
      issueDate,
    });
    const existingNumber = invoicedBy.get(student.id) || null;

    return {
      ...identity(student),
      gross: applied.gross,
      discount_total: applied.discountTotal,
      net: applied.net,
      discounts: applied.discounts,
      already_invoiced: existingNumber !== null,
      existing_invoice_number: existingNumber,
      line_items: buildInvoiceLineItems({ structure, gross: applied.gross, discounts: applied.discounts }),
    };
  });

  const billable = rows.filter((row) => !row.already_invoiced);
  return {
    feeStructure: structure,
    issueDate,
    dueDate,
    rows,
    totals: {
      students: rows.length,
      billable: billable.length,
      skipped: rows.length - billable.length,
      gross: roundMoney(billable.reduce((sum, row) => sum + row.gross, 0)),
      discount: roundMoney(billable.reduce((sum, row) => sum + row.discount_total, 0)),
      net: roundMoney(billable.reduce((sum, row) => sum + row.net, 0)),
      currency: structure.currency,
    },
  };
};

const previewBillingRun = async ({ database, body }) => {
  const preview = await buildBillingRows(database, body);
  if (preview.error) return preview;
  const { feeStructure, rows, totals, issueDate, dueDate } = preview;
  return { feeStructure, rows, totals, issueDate, dueDate };
};

const runBilling = async ({ database, body, actor }) => {
  if (body.confirm !== true) return { error: 'Billing run must be confirmed' };

  const preview = await buildBillingRows(database, body);
  if (preview.error) return preview;

  const { feeStructure, rows, issueDate, dueDate } = preview;

  const { created: invoices, skippedRows } = await withTransaction(database, async (executor) => {
    // Re-read what has already been billed from inside the transaction rather than trusting the
    // preview. Two admins can press Bill at the same moment, and this is what makes the retry
    // after a billing_key collision converge on "skip" instead of colliding all over again.
    const { rows: alreadyBilled } = await executor.query(
      'SELECT student_id, invoice_number FROM invoices WHERE fee_structure_id = $1',
      [feeStructure.id],
    );
    const invoicedBy = new Map(alreadyBilled.map((row) => [row.student_id, row.invoice_number]));

    const billable = rows.filter((row) => !invoicedBy.has(row.student_id));
    const skipped = rows
      .filter((row) => invoicedBy.has(row.student_id))
      .map((row) => ({ student_id: row.student_id, invoice_number: invoicedBy.get(row.student_id) }));

    if (billable.length === 0) return { created: [], skippedRows: skipped };

    const numbers = await nextInvoiceNumbers(executor, issueDate, billable.length);
    const created = [];

    for (const [index, row] of billable.entries()) {
      const { rows: inserted } = await executor.query(
        `
          INSERT INTO invoices (
            id, student_id, invoice_number, status, total_amount, balance_due, currency, due_date,
            issued_at, line_items, fee_structure_id, academic_year, term, gross_amount, discount_total, billing_key
          ) VALUES ($1, $2, $3, 'issued', $4, $4, $5, $6, COALESCE($7, NOW()), $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `,
        [
          randomUUID(),
          row.student_id,
          numbers[index],
          row.net,
          feeStructure.currency,
          dueDate,
          issueDate,
          JSON.stringify(row.line_items),
          feeStructure.id,
          feeStructure.academic_year,
          feeStructure.term,
          row.gross,
          row.discount_total,
          billingKeyFor(feeStructure.id, row.student_id),
        ],
      );
      created.push(inserted[0]);
    }

    await writeAudit(executor, actor, {
      action: 'billing_run',
      entityType: 'invoice',
      entityId: feeStructure.id,
      entityName: `${feeStructure.name} — ${feeStructure.term} ${feeStructure.academic_year}`,
      changes: {
        created: created.length,
        skipped: skipped.length,
        total_billed: roundMoney(billable.reduce((sum, row) => sum + row.net, 0)),
        currency: feeStructure.currency,
        due_date: dueDate,
      },
    });

    return { created, skippedRows: skipped };
  });

  return { created: invoices.length, skipped: skippedRows.length, invoices, skippedRows };
};

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

const recordPayment = async ({ database, body, actor }) => {
  const amount = positiveAmount(body.amount);
  if (amount === null) return { error: 'Amount must be greater than zero' };

  const paymentMethod = trimmed(body.paymentMethod);
  if (!paymentMethod) return { error: 'Payment method is required' };

  const student = await loadStudent(database, body.studentId);
  if (!student) return { error: 'Student not found' };

  const invoiceId = trimmed(body.invoiceId);
  if (invoiceId) {
    const { rows } = await database.query('SELECT student_id FROM invoices WHERE id = $1 LIMIT 1', [invoiceId]);
    if (!rows[0]) return { error: 'Invoice not found' };
    if (rows[0].student_id !== student.id) return { error: 'Invoice does not belong to this student' };
  }

  const paidAt = body.paidAt ? toIsoDate(body.paidAt) : null;
  const currency = (trimmed(body.currency) || DEFAULT_CURRENCY).toUpperCase();

  const result = await withTransaction(database, async (executor) => {
    // Settle the named invoice, or spread the money over open invoices oldest due date first —
    // the order a bursar would work through a pile of unpaid bills.
    const open = invoiceId
      ? await executor.query('SELECT * FROM invoices WHERE id = $1', [invoiceId])
      : await executor.query(
          `
            SELECT * FROM invoices
            WHERE student_id = $1 AND balance_due > 0
            ORDER BY due_date ASC NULLS LAST, issued_at ASC
          `,
          [student.id],
        );

    let remaining = roundMoney(amount);
    const allocations = [];

    for (const invoice of open.rows) {
      if (remaining <= 0) break;
      const balance = toAmount(invoice.balance_due);
      if (balance <= 0) continue;

      const applied = roundMoney(Math.min(balance, remaining));
      const newBalance = roundMoney(balance - applied);
      remaining = roundMoney(remaining - applied);

      const { rows: updated } = await executor.query(
        `
          UPDATE invoices
          SET balance_due = $1, status = CASE WHEN $1 <= 0 THEN 'paid' ELSE 'partial' END
          WHERE id = $2
          RETURNING invoice_number, balance_due, status
        `,
        [newBalance, invoice.id],
      );

      allocations.push({
        invoice_id: invoice.id,
        invoice_number: updated[0].invoice_number,
        applied,
        balance_due: toAmount(updated[0].balance_due),
        status: updated[0].status,
      });
    }

    const paymentId = randomUUID();
    const { rows: payments } = await executor.query(
      `
        INSERT INTO payments (
          id, student_id, fee_structure_id, invoice_id, amount, currency, payment_method,
          reference, paid_at, received_by, notes
        ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9, $10)
        RETURNING *
      `,
      [
        paymentId,
        student.id,
        allocations.length === 1 ? allocations[0].invoice_id : null,
        roundMoney(amount),
        currency,
        paymentMethod,
        trimmed(body.reference) || null,
        paidAt,
        trimmed(body.receivedBy) || actor.name || actor.email,
        trimmed(body.notes),
      ],
    );

    const receipt = await issueReceipt(executor, {
      paymentId,
      studentId: student.id,
      amount,
      currency,
      issuedAt: paidAt,
      issuedBy: actor.name || actor.email,
    });

    await writeAudit(executor, actor, {
      action: 'payment_recorded',
      entityType: 'payment',
      entityId: paymentId,
      entityName: `${student.first_name} ${student.last_name}`,
      changes: {
        amount: roundMoney(amount),
        currency,
        payment_method: paymentMethod,
        receipt_number: receipt.receipt_number,
        allocations,
        credit_amount: remaining,
      },
    });

    return { payment: payments[0], receipt, allocations, creditAmount: remaining };
  });

  return result;
};

/* -------------------------------------------------------------------------- */
/* Ledger and arrears                                                          */
/* -------------------------------------------------------------------------- */

const studentLedger = async ({ database, body }) => {
  const student = await loadStudent(database, body.studentId);
  if (!student) return { error: 'Student not found' };

  const [invoices, payments, receipts, bursaries] = await Promise.all([
    database.query('SELECT * FROM invoices WHERE student_id = $1 ORDER BY issued_at ASC', [student.id]),
    database.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY paid_at ASC', [student.id]),
    database.query('SELECT * FROM receipts WHERE student_id = $1 ORDER BY issued_at ASC', [student.id]),
    database.query('SELECT * FROM fee_bursaries WHERE student_id = $1 ORDER BY created_at DESC', [student.id]),
  ]);

  const receiptByPayment = new Map(receipts.rows.map((receipt) => [receipt.payment_id, receipt]));

  const entries = [
    ...invoices.rows.map((invoice) => ({
      date: toIsoDate(invoice.issued_at),
      type: 'invoice',
      reference: invoice.invoice_number,
      description: [invoice.term, invoice.academic_year].filter(Boolean).join(' ') || 'Invoice',
      debit: toAmount(invoice.total_amount),
      credit: 0,
    })),
    ...payments.rows.map((payment) => ({
      date: toIsoDate(payment.paid_at),
      type: 'payment',
      reference: receiptByPayment.get(payment.id)?.receipt_number || payment.reference || '',
      description: payment.payment_method || 'Payment',
      debit: 0,
      credit: toAmount(payment.amount),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.type === 'invoice' ? -1 : 1));

  let balance = 0;
  for (const entry of entries) {
    balance = roundMoney(balance + entry.debit - entry.credit);
    entry.balance = balance;
  }

  const totalInvoiced = roundMoney(invoices.rows.reduce((sum, row) => sum + toAmount(row.total_amount), 0));
  const totalPaid = roundMoney(payments.rows.reduce((sum, row) => sum + toAmount(row.amount), 0));

  return {
    student: identity(student),
    invoices: invoices.rows,
    payments: payments.rows,
    receipts: receipts.rows,
    bursaries: bursaries.rows,
    entries,
    summary: {
      currency: invoices.rows[0]?.currency || DEFAULT_CURRENCY,
      total_invoiced: totalInvoiced,
      total_discounted: roundMoney(invoices.rows.reduce((sum, row) => sum + toAmount(row.discount_total), 0)),
      total_paid: totalPaid,
      balance_due: roundMoney(invoices.rows.reduce((sum, row) => sum + Math.max(0, toAmount(row.balance_due)), 0)),
    },
    rating: await ratingFor(database, student.id, body.asOf || new Date()),
  };
};

const arrearsReport = async ({ database, body }) => {
  const asOf = toIsoDate(body.asOf) || toIsoDate(new Date());
  const minBalance = Number.isFinite(Number(body.minBalance)) ? Number(body.minBalance) : 0;

  const conditions = ["status = 'active'"];
  const params = [];
  if (body.gradeLevel !== null && body.gradeLevel !== undefined && body.gradeLevel !== '') {
    params.push(Number(body.gradeLevel));
    conditions.push(`grade_level = $${params.length}`);
  }
  if (trimmed(body.classSection)) {
    params.push(trimmed(body.classSection));
    conditions.push(`class_section = $${params.length}`);
  }

  const [students, invoices, standings] = await Promise.all([
    database.query(
      `SELECT ${STUDENT_IDENTITY_COLUMNS} FROM students WHERE ${conditions.join(' AND ')} ORDER BY last_name, first_name`,
      params,
    ),
    database.query('SELECT student_id, balance_due, due_date, currency FROM invoices WHERE balance_due > 0'),
    loadActiveStandings(database),
  ]);

  const byStudent = new Map(
    students.rows.map((student) => [
      student.id,
      {
        ...identity(student),
        ...emptyAgingBuckets(),
        total_outstanding: 0,
        oldest_due_date: null,
        days_overdue: 0,
        standing: standings.get(student.id)?.standing || null,
      },
    ]),
  );

  let currency = DEFAULT_CURRENCY;
  for (const invoice of invoices.rows) {
    const row = byStudent.get(invoice.student_id);
    if (!row) continue;

    const balance = Math.max(0, toAmount(invoice.balance_due));
    if (balance <= 0) continue;
    if (invoice.currency) currency = invoice.currency;

    const dueDate = toIsoDate(invoice.due_date);
    const daysOverdue = dueDate ? dayDiff(asOf, dueDate) : 0;
    row[agingBucketFor(daysOverdue)] = roundMoney(row[agingBucketFor(daysOverdue)] + balance);
    row.total_outstanding = roundMoney(row.total_outstanding + balance);

    if (dueDate && daysOverdue > 0 && (!row.oldest_due_date || dueDate < row.oldest_due_date)) {
      row.oldest_due_date = dueDate;
      row.days_overdue = daysOverdue;
    }
  }

  let rows = [...byStudent.values()].filter((row) => row.total_outstanding > minBalance);
  if (trimmed(body.standing)) rows = rows.filter((row) => row.standing === trimmed(body.standing));
  rows.sort((a, b) => b.total_outstanding - a.total_outstanding);

  const totals = AGING_BUCKETS.reduce(
    (sums, bucket) => ({ ...sums, [bucket]: roundMoney(rows.reduce((sum, row) => sum + row[bucket], 0)) }),
    {},
  );
  totals.total = roundMoney(rows.reduce((sum, row) => sum + row.total_outstanding, 0));

  return { asOf, rows, totals, currency };
};

/* -------------------------------------------------------------------------- */
/* Bursaries                                                                   */
/* -------------------------------------------------------------------------- */

const listBursaries = async ({ database, body }) => {
  const conditions = [];
  const params = [];
  if (trimmed(body.studentId)) {
    params.push(trimmed(body.studentId));
    conditions.push(`b.student_id = $${params.length}`);
  }
  if (trimmed(body.status)) {
    params.push(trimmed(body.status));
    conditions.push(`b.status = $${params.length}`);
  }

  const { rows } = await database.query(
    `
      SELECT b.*, s.student_id AS student_number, s.first_name, s.last_name, s.grade_level, s.class_section
      FROM fee_bursaries b
      JOIN students s ON s.id = b.student_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY b.created_at DESC
    `,
    params,
  );

  return {
    bursaries: rows.map((row) => ({
      ...row,
      full_name: `${row.first_name} ${row.last_name}`,
    })),
  };
};

const saveBursary = async ({ database, body, actor }) => {
  const name = trimmed(body.name);
  if (!name) return { error: 'Bursary name is required' };

  const discountType = trimmed(body.discountType) || 'percentage';
  if (!DISCOUNT_TYPES.includes(discountType)) return { error: `Unsupported discount type: ${discountType}` };

  const discountValue = positiveAmount(body.discountValue);
  if (discountValue === null) return { error: 'Discount value must be greater than zero' };
  if (discountType === 'percentage' && discountValue > 100) return { error: 'A percentage discount cannot exceed 100' };

  const student = await loadStudent(database, body.studentId);
  if (!student) return { error: 'Student not found' };

  const startDate = toIsoDate(body.startDate);
  const endDate = toIsoDate(body.endDate);
  if (startDate && endDate && endDate < startDate) return { error: 'End date cannot be before the start date' };

  const status = trimmed(body.status) || 'active';
  if (!['active', 'ended'].includes(status)) return { error: `Unsupported bursary status: ${status}` };

  const values = [
    student.id,
    name,
    trimmed(body.sponsor),
    discountType,
    roundMoney(discountValue),
    trimmed(body.feeStructureId) || null,
    trimmed(body.academicYear) || null,
    trimmed(body.term) || null,
    startDate,
    endDate,
    status,
    trimmed(body.notes),
    actor.name || actor.email,
  ];

  const id = trimmed(body.id);
  const result = id
    ? await database.query(
        `
          UPDATE fee_bursaries
          SET student_id = $1, name = $2, sponsor = $3, discount_type = $4, discount_value = $5,
              fee_structure_id = $6, academic_year = $7, term = $8, start_date = $9, end_date = $10,
              status = $11, notes = $12, approved_by = $13
          WHERE id = $14
          RETURNING *
        `,
        [...values, id],
      )
    : await database.query(
        `
          INSERT INTO fee_bursaries (
            student_id, name, sponsor, discount_type, discount_value, fee_structure_id,
            academic_year, term, start_date, end_date, status, notes, approved_by, id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `,
        [...values, randomUUID()],
      );

  const bursary = result.rows[0];
  if (!bursary) return { error: 'Bursary not found' };

  await withTransaction(database, (executor) =>
    writeAudit(executor, actor, {
      action: id ? 'bursary_updated' : 'bursary_created',
      entityType: 'bursary',
      entityId: bursary.id,
      entityName: `${student.first_name} ${student.last_name} — ${name}`,
      changes: bursary,
    }),
  );

  return { bursary };
};

const deleteBursary = async ({ database, body, actor }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'Bursary id is required' };

  const { rows } = await database.query('DELETE FROM fee_bursaries WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) return { error: 'Bursary not found' };

  await withTransaction(database, (executor) =>
    writeAudit(executor, actor, {
      action: 'bursary_deleted',
      entityType: 'bursary',
      entityId: id,
      entityName: rows[0].name,
      changes: rows[0],
    }),
  );

  return { deleted: true };
};

/* -------------------------------------------------------------------------- */
/* Standings                                                                   */
/* -------------------------------------------------------------------------- */

const listStandings = async ({ database, body }) => {
  const asOf = toIsoDate(body.asOf) || toIsoDate(new Date());

  const conditions = ["status = 'active'"];
  const params = [];
  if (body.gradeLevel !== null && body.gradeLevel !== undefined && body.gradeLevel !== '') {
    params.push(Number(body.gradeLevel));
    conditions.push(`grade_level = $${params.length}`);
  }

  const [students, invoices, payments, overrides] = await Promise.all([
    database.query(
      `SELECT ${STUDENT_IDENTITY_COLUMNS} FROM students WHERE ${conditions.join(' AND ')} ORDER BY last_name, first_name`,
      params,
    ),
    database.query('SELECT id, student_id, total_amount, balance_due, due_date FROM invoices'),
    database.query('SELECT student_id, amount, paid_at, invoice_id FROM payments'),
    loadActiveStandings(database),
  ]);

  const invoicesByStudent = new Map();
  for (const invoice of invoices.rows) {
    if (!invoicesByStudent.has(invoice.student_id)) invoicesByStudent.set(invoice.student_id, []);
    invoicesByStudent.get(invoice.student_id).push(invoice);
  }
  const paymentsByStudent = new Map();
  for (const payment of payments.rows) {
    if (!paymentsByStudent.has(payment.student_id)) paymentsByStudent.set(payment.student_id, []);
    paymentsByStudent.get(payment.student_id).push(payment);
  }

  let rows = students.rows.map((student) => {
    const computed = computePaymentRating({
      invoices: invoicesByStudent.get(student.id) || [],
      payments: paymentsByStudent.get(student.id) || [],
      asOf,
    });
    const effective = resolveEffectiveStanding({
      computed,
      override: overrides.get(student.id) || null,
      asOf,
    });
    return { ...identity(student), ...effective };
  });

  if (trimmed(body.standing)) rows = rows.filter((row) => row.standing === trimmed(body.standing));
  if (body.reviewDueOnly === true) rows = rows.filter((row) => row.override?.review_due === true);

  return { asOf, rows };
};

const setStanding = async ({ database, body, actor }) => {
  const standing = trimmed(body.standing);
  if (!FEE_STANDINGS.includes(standing)) return { error: `Unsupported fee standing: ${standing}` };

  // An override silently outranks the computed rating, so it has to say why. A standing with no
  // reason cannot be reviewed by whoever inherits it.
  const note = trimmed(body.note);
  if (!note) return { error: 'A note explaining the override is required' };

  const student = await loadStudent(database, body.studentId);
  if (!student) return { error: 'Student not found' };

  const reviewDate = toIsoDate(body.reviewDate);
  const setBy = actor.name || actor.email;

  const row = await withTransaction(database, async (executor) => {
    // Supersede the live override and insert the replacement together; the partial unique index
    // on (student_id) WHERE status = 'active' guarantees there is never more than one.
    await executor.query(
      `
        UPDATE student_fee_standings
        SET status = 'cleared', cleared_by = $1, cleared_at = NOW()
        WHERE student_id = $2 AND status = 'active'
      `,
      [setBy, student.id],
    );

    const { rows } = await executor.query(
      `
        INSERT INTO student_fee_standings (id, student_id, standing, note, review_date, status, set_by)
        VALUES ($1, $2, $3, $4, $5, 'active', $6)
        RETURNING *
      `,
      [randomUUID(), student.id, standing, note, reviewDate, setBy],
    );

    await writeAudit(executor, actor, {
      action: 'fee_standing_set',
      entityType: 'fee_standing',
      entityId: rows[0].id,
      entityName: `${student.first_name} ${student.last_name}`,
      changes: { standing, note, review_date: reviewDate },
    });

    return rows[0];
  });

  return { standing: row, effective: await ratingFor(database, student.id, body.asOf || new Date()) };
};

const clearStanding = async ({ database, body, actor }) => {
  const student = await loadStudent(database, body.studentId);
  if (!student) return { error: 'Student not found' };

  const cleared = await withTransaction(database, async (executor) => {
    const { rows } = await executor.query(
      `
        UPDATE student_fee_standings
        SET status = 'cleared', cleared_by = $1, cleared_at = NOW()
        WHERE student_id = $2 AND status = 'active'
        RETURNING *
      `,
      [actor.name || actor.email, student.id],
    );

    if (rows[0]) {
      await writeAudit(executor, actor, {
        action: 'fee_standing_cleared',
        entityType: 'fee_standing',
        entityId: rows[0].id,
        entityName: `${student.first_name} ${student.last_name}`,
        changes: { previous_standing: rows[0].standing },
      });
    }

    return rows.length > 0;
  });

  return { cleared, effective: await ratingFor(database, student.id, body.asOf || new Date()) };
};

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

const summary = async ({ database, body }) => {
  const asOf = toIsoDate(body.asOf) || toIsoDate(new Date());

  const [invoices, payments, structures, bursaries, overrides] = await Promise.all([
    database.query('SELECT student_id, total_amount, balance_due, currency, due_date, id FROM invoices'),
    database.query('SELECT student_id, amount, paid_at, invoice_id FROM payments'),
    database.query("SELECT COUNT(*)::int AS count FROM fee_structures WHERE status = 'active'"),
    database.query("SELECT COUNT(*)::int AS count FROM fee_bursaries WHERE status = 'active'"),
    loadActiveStandings(database),
  ]);

  const invoicesByStudent = new Map();
  for (const invoice of invoices.rows) {
    if (!invoicesByStudent.has(invoice.student_id)) invoicesByStudent.set(invoice.student_id, []);
    invoicesByStudent.get(invoice.student_id).push(invoice);
  }
  const paymentsByStudent = new Map();
  for (const payment of payments.rows) {
    if (!paymentsByStudent.has(payment.student_id)) paymentsByStudent.set(payment.student_id, []);
    paymentsByStudent.get(payment.student_id).push(payment);
  }

  const standings = { excellent: 0, good: 0, fair: 0, watch: 0, delinquent: 0, unrated: 0 };
  let reviewsDue = 0;
  for (const studentId of new Set([...invoicesByStudent.keys(), ...overrides.keys()])) {
    const effective = resolveEffectiveStanding({
      computed: computePaymentRating({
        invoices: invoicesByStudent.get(studentId) || [],
        payments: paymentsByStudent.get(studentId) || [],
        asOf,
      }),
      override: overrides.get(studentId) || null,
      asOf,
    });
    standings[effective.standing] = (standings[effective.standing] || 0) + 1;
    if (effective.override?.review_due) reviewsDue += 1;
  }

  const overdueStudents = new Set(
    invoices.rows
      .filter((invoice) => toAmount(invoice.balance_due) > 0 && toIsoDate(invoice.due_date) && toIsoDate(invoice.due_date) < asOf)
      .map((invoice) => invoice.student_id),
  );

  return {
    asOf,
    totals: {
      invoiced: roundMoney(invoices.rows.reduce((sum, row) => sum + toAmount(row.total_amount), 0)),
      collected: roundMoney(payments.rows.reduce((sum, row) => sum + toAmount(row.amount), 0)),
      outstanding: roundMoney(invoices.rows.reduce((sum, row) => sum + Math.max(0, toAmount(row.balance_due)), 0)),
      currency: invoices.rows[0]?.currency || DEFAULT_CURRENCY,
    },
    counts: {
      structures: structures.rows[0]?.count || 0,
      activeBursaries: bursaries.rows[0]?.count || 0,
      invoices: invoices.rows.length,
      overdueStudents: overdueStudents.size,
      overrides: overrides.size,
      reviewsDue,
    },
    standings,
  };
};

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

const ACTIONS = {
  summary,
  list_fee_structures: listFeeStructures,
  save_fee_structure: saveFeeStructure,
  delete_fee_structure: deleteFeeStructure,
  preview_billing_run: previewBillingRun,
  run_billing: runBilling,
  record_payment: recordPayment,
  student_ledger: studentLedger,
  arrears_report: arrearsReport,
  list_bursaries: listBursaries,
  save_bursary: saveBursary,
  delete_bursary: deleteBursary,
  list_standings: listStandings,
  set_standing: setStanding,
  clear_standing: clearStanding,
};

export const FEES_ACTIONS = Object.keys(ACTIONS);

/**
 * Single entry point for every fees action.
 *
 * The role check sits here, ahead of the action table, so no handler can be reached without
 * passing it. Note that requesterRole is supplied by the browser: this matches the existing
 * update_role convention and is a deployment-perimeter assumption, not an auth control.
 */
export const handleFeesFunction = async (database, body = {}) => {
  if (body.requesterRole !== 'admin') return { error: 'Unauthorized' };

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported fees action: ${body.action}` };

  const actor = {
    email: String(body.actorEmail || ''),
    name: String(body.actorName || ''),
    role: body.requesterRole,
  };

  return handler({ database, body, actor });
};
