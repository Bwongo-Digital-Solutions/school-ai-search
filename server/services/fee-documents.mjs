/**
 * Allocation of invoice and receipt numbers, plus receipt issuing.
 *
 * Shared by the fees admin service and the mobile-money gateway so that every payment recorded
 * anywhere in the system gets a receipt from the same numbering pool.
 */
import { randomUUID } from 'node:crypto';
import { formatDocumentNumber, parseDocumentSequence, roundMoney, toIsoDate } from './fee-math.mjs';

export const INVOICE_PREFIX = process.env.FEE_INVOICE_PREFIX || 'INV';
export const RECEIPT_PREFIX = process.env.FEE_RECEIPT_PREFIX || 'RCT';

const documentYear = (value) => Number(String(toIsoDate(value) || toIsoDate(new Date())).slice(0, 4));

/**
 * Next free sequence number for a prefix/year, read from the highest existing document.
 *
 * Two callers can read the same maximum, so this is not a lock: the loser trips the UNIQUE
 * constraint on the number column and withTransaction retries the whole unit of work with a
 * fresh read. Correctness comes from the constraint, not from this query.
 */
const nextSequence = async (executor, table, column, prefix, year) => {
  const { rows } = await executor.query(
    `SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`,
    [`${prefix}-${year}-%`],
  );
  return parseDocumentSequence(rows[0]?.value) + 1;
};

export const nextInvoiceNumber = async (executor, date) => {
  const year = documentYear(date);
  const sequence = await nextSequence(executor, 'invoices', 'invoice_number', INVOICE_PREFIX, year);
  return formatDocumentNumber(INVOICE_PREFIX, year, sequence);
};

/**
 * Allocates a run of consecutive invoice numbers in one read.
 *
 * A billing run inserts every invoice inside a single transaction, so reading the maximum once
 * and counting up in memory is both correct and far cheaper than one query per student.
 */
export const nextInvoiceNumbers = async (executor, date, count) => {
  const year = documentYear(date);
  const start = await nextSequence(executor, 'invoices', 'invoice_number', INVOICE_PREFIX, year);
  return Array.from({ length: count }, (_, index) => formatDocumentNumber(INVOICE_PREFIX, year, start + index));
};

export const nextReceiptNumber = async (executor, date) => {
  const year = documentYear(date);
  const sequence = await nextSequence(executor, 'receipts', 'receipt_number', RECEIPT_PREFIX, year);
  return formatDocumentNumber(RECEIPT_PREFIX, year, sequence);
};

/** Issues the receipt for a payment. Must run inside the same transaction as the payment insert. */
export const issueReceipt = async (executor, { paymentId, studentId, amount, currency, issuedAt, issuedBy }) => {
  const receiptNumber = await nextReceiptNumber(executor, issuedAt);
  const { rows } = await executor.query(
    `
      INSERT INTO receipts (id, payment_id, student_id, receipt_number, amount, currency, issued_at, issued_by)
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), $8)
      RETURNING *
    `,
    [randomUUID(), paymentId, studentId, receiptNumber, roundMoney(amount), currency, issuedAt || null, issuedBy || ''],
  );
  return rows[0];
};
