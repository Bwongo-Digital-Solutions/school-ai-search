import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Gauge } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callFees, feeDocumentUrl } from '@/lib/fees';
import { downloadFromUrl } from '@/lib/download';
import { formatAmount, formatDate } from '@/lib/format';
import Field from '@/components/common/Field';
import StatTile from '@/components/common/StatTile';
import type { StudentLedger } from '@/types/feeAdmin';
import RatingCard from './RatingCard';
import { EmptyState, Panel, SecondaryButton, zebra } from './shared';

const StudentLedgerTab = ({
  runAction,
  onChanged,
  studentId,
  setStudentId,
}: {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  studentId: string;
  setStudentId: (id: string) => void;
}) => {
  const { user } = useAuth();
  const { students } = useChatContext();
  const [ledger, setLedger] = useState<StudentLedger | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!studentId) { setLedger(null); return; }
    setLoading(true);
    try {
      setLedger(await callFees<StudentLedger>('student_ledger', { studentId }, user));
    } catch (err) {
      console.error('Failed to load student ledger:', err);
      setLedger(null);
    }
    setLoading(false);
  }, [studentId, user]);

  useEffect(() => { load(); }, [load]);

  const downloadStatement = () =>
    runAction('Downloading statement', async () => {
      if (!ledger) return;
      await downloadFromUrl(
        feeDocumentUrl(`/api/fees/statements/${ledger.student.student_id}.pdf`, user),
        `${ledger.student.student_number}-fee-statement.pdf`,
      );
    });

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Field
              label="Student"
              value={studentId}
              onChange={value => setStudentId(String(value))}
              options={[
                { value: '', label: 'Select a student' },
                ...students.map(student => ({
                  value: student.id,
                  label: `${student.first_name} ${student.last_name} · ${student.student_id} · Grade ${student.grade_level}${student.class_section}`,
                })),
              ]}
            />
          </div>
          {ledger && (
            <SecondaryButton onClick={downloadStatement}>
              <Download className="w-3.5 h-3.5" /> Download statement
            </SecondaryButton>
          )}
        </div>
      </Panel>

      {!studentId ? (
        <Panel><EmptyState message="Select a student to see every invoice, payment and receipt on their account." /></Panel>
      ) : loading ? (
        <Panel><EmptyState message="Loading ledger…" /></Panel>
      ) : !ledger ? (
        <Panel><EmptyState message="No ledger could be loaded for this student." /></Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Invoiced" value={formatAmount(ledger.summary.total_invoiced, ledger.summary.currency)} icon={FileText} />
            <StatTile label="Bursaries" value={formatAmount(ledger.summary.total_discounted, ledger.summary.currency)} icon={Gauge} tone="success" />
            <StatTile label="Paid" value={formatAmount(ledger.summary.total_paid, ledger.summary.currency)} icon={FileText} tone="success" />
            <StatTile
              label="Balance"
              value={formatAmount(ledger.summary.balance_due, ledger.summary.currency)}
              icon={FileText}
              tone={ledger.summary.balance_due > 0 ? 'warning' : 'success'}
            />
          </div>

          <RatingCard
            student={ledger.student}
            rating={ledger.rating}
            runAction={runAction}
            onChanged={async () => { await load(); onChanged(); }}
          />

          <Panel className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Statement of account</h4>
            </div>
            {ledger.entries.length === 0 ? (
              <EmptyState message="No fee activity has been recorded for this student." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="text-left font-medium px-4 py-2.5">Date</th>
                      <th className="text-left font-medium px-4 py-2.5">Reference</th>
                      <th className="text-left font-medium px-4 py-2.5">Description</th>
                      <th className="text-right font-medium px-4 py-2.5">Debit</th>
                      <th className="text-right font-medium px-4 py-2.5">Credit</th>
                      <th className="text-right font-medium px-4 py-2.5">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {ledger.entries.map((entry, index) => (
                      <tr key={`${entry.reference}-${index}`} className={zebra}>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(entry.date)}</td>
                        <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">{entry.reference || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{entry.description}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">
                          {entry.debit ? formatAmount(entry.debit, ledger.summary.currency) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                          {entry.credit ? formatAmount(entry.credit, ledger.summary.currency) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-white">
                          {formatAmount(entry.balance, ledger.summary.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {ledger.bursaries.length > 0 && (
            <Panel className="p-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Bursaries</h4>
              <ul className="space-y-1.5">
                {ledger.bursaries.map(bursary => (
                  <li key={bursary.id} className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                    <span className="font-medium text-gray-800 dark:text-white">{bursary.name}</span>
                    <span className="text-xs text-gray-400">
                      {bursary.discount_type === 'percentage'
                        ? `${bursary.discount_value}%`
                        : formatAmount(bursary.discount_value, ledger.summary.currency)}
                      {bursary.sponsor ? ` · ${bursary.sponsor}` : ''} · {bursary.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
};

export default StudentLedgerTab;
