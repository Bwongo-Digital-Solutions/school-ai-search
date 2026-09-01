import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callFees, feeDocumentUrl } from '@/lib/fees';
import { downloadFromUrl } from '@/lib/download';
import { formatAmount, formatDate, todayIso } from '@/lib/format';
import Field from '@/components/common/Field';
import { StudentPicker } from '@/components/common';
import StudentIdScanner from '../StudentIdScanner';
import type { RecordPaymentResult, StudentLedger } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';
import styles from '../tabs.module.scss';
import { CheckmarkFilled, Download, Receipt, Wallet } from '@carbon/react/icons';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Mobile Money', 'Card'];

const RecordPaymentTab = ({ runAction, onChanged }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void>; onChanged: () => void }) => {
  const { user } = useAuth();
  const { notify } = useNotifications();
  const { students } = useChatContext();
  const [studentId, setStudentId] = useState('');
  const [ledger, setLedger] = useState<StudentLedger | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [result, setResult] = useState<RecordPaymentResult | null>(null);

  const loadLedger = useCallback(async (id: string) => {
    if (!id) { setLedger(null); return; }
    try {
      setLedger(await callFees<StudentLedger>('student_ledger', { studentId: id }, user));
    } catch (err) {
      console.error('Failed to load student ledger:', err);
      setLedger(null);
    }
  }, [user]);

  useEffect(() => { loadLedger(studentId); }, [studentId, loadLedger]);

  const openInvoices = (ledger?.invoices || []).filter(invoice => invoice.balance_due > 0);

  const submit = () =>
    runAction('Recording payment', async () => {
      const data = await callFees<RecordPaymentResult>(
        'record_payment',
        {
          studentId,
          invoiceId: invoiceId || undefined,
          amount,
          paymentMethod,
          reference: reference || undefined,
          paidAt: paidAt || undefined,
          notes: notes || undefined,
        },
        user,
      );
      setResult(data);
      setAmount(0);
      setReference('');
      setNotes('');
      setInvoiceId('');
      await loadLedger(studentId);
      onChanged();
    });

  const downloadReceipt = () =>
    runAction('Downloading receipt', async () => {
      if (!result) return;
      await downloadFromUrl(
        feeDocumentUrl(`/api/fees/receipts/${result.payment.id}.pdf`, user),
        `${result.receipt.receipt_number}.pdf`,
      );
    });

  const scanned = (code: string) => {
    setScannerOpen(false);
    const match = students.find(
      student => student.student_id.toUpperCase() === code.toUpperCase() || student.id === code,
    );
    if (match) setStudentId(match.id);
    else notify.warning('No student matches that ID card', `Scanned: ${code}`);
  };

  return (
    <div className={styles.stack}>
      <Panel className={styles.padStack}>
        <div className={styles.grid3}>
          <div className={styles.spanAll}>
            <StudentPicker
              value={studentId}
              onChange={id => {
                setStudentId(id);
                setResult(null);
              }}
              students={students}
            />
          </div>
          <div className={styles.toolbar}>
            <SecondaryButton onClick={() => setScannerOpen(true)} className={styles.fullWidth}>
              Scan ID card
            </SecondaryButton>
          </div>
        </div>

        {ledger && (
          <div className={styles.footNotes}>
            <span>Invoiced <span className={styles.strong}>{formatAmount(ledger.summary.total_invoiced, ledger.summary.currency)}</span></span>
            <span>Paid <span className={styles.strong}>{formatAmount(ledger.summary.total_paid, ledger.summary.currency)}</span></span>
            <span>Balance <span className={styles.strong}>{formatAmount(ledger.summary.balance_due, ledger.summary.currency)}</span></span>
          </div>
        )}
      </Panel>

      {studentId && (
        <Panel className={styles.pad}>
          <div className={styles.grid3}>
            <div className={styles.spanAll}>
              <Field
                label="Apply to invoice"
                value={invoiceId}
                onChange={value => setInvoiceId(String(value))}
                options={[
                  { value: '', label: 'Oldest outstanding first (automatic)' },
                  ...openInvoices.map(invoice => ({
                    value: invoice.id,
                    label: `${invoice.invoice_number} · due ${formatDate(invoice.due_date)} · ${formatAmount(invoice.balance_due, invoice.currency)} owing`,
                  })),
                ]}
                hint={openInvoices.length === 0 ? 'This student has no outstanding invoices; a payment will be recorded as credit.' : undefined}
 />
            </div>
            <Field label="Amount" type="number" min={0} value={amount} onChange={value => setAmount(Number(value))} />
            <Field
              label="Method"
              value={paymentMethod}
              onChange={value => setPaymentMethod(String(value))}
              options={PAYMENT_METHODS.map(method => ({ value: method, label: method }))}
 />
            <Field label="Date received" type="date" value={paidAt} onChange={value => setPaidAt(String(value))} />
            <Field label="Reference" value={reference} onChange={value => setReference(String(value))} placeholder="Bank slip / txn id" />
            <div className={styles.spanAll}>
              <Field label="Notes" value={notes} onChange={value => setNotes(String(value))} />
            </div>
          </div>
          <div className={styles.actionsEnd}>
            <PrimaryButton onClick={submit} disabled={!amount || amount <= 0}>
              <Wallet size={16} /> Record payment &amp; issue receipt
            </PrimaryButton>
          </div>
        </Panel>
      )}

      {!studentId && (
        <Panel>
          <EmptyState message="Select or scan a student to record a payment against their account." />
        </Panel>
      )}

      {result && (
        <Panel >
          <div className={styles.receiptHead}>
            <span className={styles.calloutTitle}>
              <CheckmarkFilled size={16} /> Receipt {result.receipt.receipt_number}
            </span>
            <SecondaryButton onClick={downloadReceipt}>
              <Download size={16} /> Download PDF
            </SecondaryButton>
          </div>
          <div className={styles.pad}>
            <p className={styles.total}>
              {formatAmount(result.payment.amount, result.payment.currency)}
            </p>
            <p className={styles.note}>
              {result.payment.payment_method} · {formatDate(result.payment.paid_at)}
            </p>

            {result.allocations.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                <thead className={styles.note}>
                  <tr>
                    <th className={styles.th}>Invoice</th>
                    <th className={styles.thNumeric}>Applied</th>
                    <th className={styles.thNumeric}>Balance after</th>
                    <th className={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody className={styles.rows}>
                  {result.allocations.map(allocation => (
                    <tr key={allocation.invoice_id} className={zebra}>
                      <td className={styles.td}>{allocation.invoice_number}</td>
                      <td className={styles.tdNumeric}>
                        {formatAmount(allocation.applied, result.payment.currency)}
                      </td>
                      <td className={styles.tdStrong}>
                        {formatAmount(allocation.balance_due, result.payment.currency)}
                      </td>
                      <td className={styles.td}>{allocation.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            {result.creditAmount > 0 && (
              <p className={styles.warn}>
                {formatAmount(result.creditAmount, result.payment.currency)} was received beyond what is owed and is held
                as credit on the account.
              </p>
            )}
          </div>
        </Panel>
      )}

      <StudentIdScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={scanned}
        title="Scan Student ID Card"
        hint="Scan the QR code on the card, or type the student number printed on it."
 />
    </div>
  );
};

export default RecordPaymentTab;
