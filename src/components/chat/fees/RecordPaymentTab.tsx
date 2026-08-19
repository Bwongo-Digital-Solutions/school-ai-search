import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Receipt, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callFees, feeDocumentUrl } from '@/lib/fees';
import { downloadFromUrl } from '@/lib/download';
import { formatAmount, formatDate, todayIso } from '@/lib/format';
import Field from '@/components/common/Field';
import StudentIdScanner from '../StudentIdScanner';
import type { RecordPaymentResult, StudentLedger } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Mobile Money', 'Card'];

const RecordPaymentTab = ({ runAction, onChanged }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void>; onChanged: () => void }) => {
  const { user } = useAuth();
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
    else alert(`No student matches "${code}".`);
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Field
              label="Student"
              value={studentId}
              onChange={value => { setStudentId(String(value)); setResult(null); }}
              options={[
                { value: '', label: 'Select a student' },
                ...students.map(student => ({
                  value: student.id,
                  label: `${student.first_name} ${student.last_name} · ${student.student_id} · Grade ${student.grade_level}${student.class_section}`,
                })),
              ]}
            />
          </div>
          <div className="flex items-end">
            <SecondaryButton onClick={() => setScannerOpen(true)} className="w-full justify-center">
              Scan ID card
            </SecondaryButton>
          </div>
        </div>

        {ledger && (
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3">
            <span>Invoiced <span className="font-medium text-gray-700 dark:text-gray-200">{formatAmount(ledger.summary.total_invoiced, ledger.summary.currency)}</span></span>
            <span>Paid <span className="font-medium text-gray-700 dark:text-gray-200">{formatAmount(ledger.summary.total_paid, ledger.summary.currency)}</span></span>
            <span>Balance <span className="font-medium text-gray-800 dark:text-white">{formatAmount(ledger.summary.balance_due, ledger.summary.currency)}</span></span>
          </div>
        )}
      </Panel>

      {studentId && (
        <Panel className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3">
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
            <div className="sm:col-span-2">
              <Field label="Notes" value={notes} onChange={value => setNotes(String(value))} />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <PrimaryButton onClick={submit} disabled={!amount || amount <= 0}>
              <Wallet className="w-4 h-4" /> Record payment &amp; issue receipt
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
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Receipt {result.receipt.receipt_number}
            </span>
            <SecondaryButton onClick={downloadReceipt}>
              <Download className="w-3.5 h-3.5" /> Download PDF
            </SecondaryButton>
          </div>
          <div className="p-4">
            <p className="text-lg font-bold text-gray-800 dark:text-white">
              {formatAmount(result.payment.amount, result.payment.currency)}
            </p>
            <p className="text-xs text-gray-400">
              {result.payment.payment_method} · {formatDate(result.payment.paid_at)}
            </p>

            {result.allocations.length > 0 && (
              <table className="w-full text-sm mt-3">
                <thead className="text-xs text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left font-medium py-1.5">Invoice</th>
                    <th className="text-right font-medium py-1.5">Applied</th>
                    <th className="text-right font-medium py-1.5">Balance after</th>
                    <th className="text-left font-medium py-1.5 pl-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {result.allocations.map(allocation => (
                    <tr key={allocation.invoice_id} className={zebra}>
                      <td className="py-1.5 text-gray-700 dark:text-gray-200">{allocation.invoice_number}</td>
                      <td className="py-1.5 text-right text-gray-600 dark:text-gray-300">
                        {formatAmount(allocation.applied, result.payment.currency)}
                      </td>
                      <td className="py-1.5 text-right text-gray-800 dark:text-white">
                        {formatAmount(allocation.balance_due, result.payment.currency)}
                      </td>
                      <td className="py-1.5 pl-4 text-gray-600 dark:text-gray-300 capitalize">{allocation.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {result.creditAmount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
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
