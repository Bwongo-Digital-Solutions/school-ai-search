import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callFees, feeDocumentUrl } from '@/lib/fees';
import { downloadFromUrl } from '@/lib/download';
import { formatAmount, formatDate } from '@/lib/format';
import { StudentPicker } from '@/components/common';
import StatTile from '@/components/common/StatTile';
import type { StudentLedger } from '@/types/feeAdmin';
import RatingCard from './RatingCard';
import { EmptyState, Panel, SecondaryButton, zebra } from './shared';
import styles from '../tabs.module.scss';
import { Document, Download, Meter } from '@carbon/react/icons';

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
    <div className={styles.stack}>
      <Panel className={styles.pad}>
        <div className={styles.toolbar}>
          <div className={styles.grow}>
            <StudentPicker value={studentId} onChange={setStudentId} students={students} />
          </div>
          {ledger && (
            <SecondaryButton onClick={downloadStatement}>
              <Download size={16} /> Download statement
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
          <div className={styles.grid4}>
            <StatTile label="Invoiced" value={formatAmount(ledger.summary.total_invoiced, ledger.summary.currency)} icon={Document} />
            <StatTile label="Bursaries" value={formatAmount(ledger.summary.total_discounted, ledger.summary.currency)} icon={Meter} tone="success" />
            <StatTile label="Paid" value={formatAmount(ledger.summary.total_paid, ledger.summary.currency)} icon={Document} tone="success" />
            <StatTile
              label="Balance"
              value={formatAmount(ledger.summary.balance_due, ledger.summary.currency)}
              icon={Document}
              tone={ledger.summary.balance_due > 0 ? 'warning' : 'success'}
 />
          </div>

          <RatingCard
            student={ledger.student}
            rating={ledger.rating}
            runAction={runAction}
            onChanged={async () => { await load(); onChanged(); }}
 />

          <Panel >
            <div className={styles.sectionRow}>
              <h4 className={styles.subheading}>Statement of account</h4>
            </div>
            {ledger.entries.length === 0 ? (
              <EmptyState message="No fee activity has been recorded for this student." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead className={styles.thead}>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Description</th>
                      <th className={styles.numeric}>Debit</th>
                      <th className={styles.numeric}>Credit</th>
                      <th className={styles.numeric}>Balance</th>
                    </tr>
                  </thead>
                  <tbody className={styles.rows}>
                    {ledger.entries.map((entry, index) => (
                      <tr key={`${entry.reference}-${index}`} className={zebra}>
                        <td>{formatDate(entry.date)}</td>
                        <td className={styles.td}>{entry.reference || '—'}</td>
                        <td>{entry.description}</td>
                        <td className={styles.tdNumeric}>
                          {entry.debit ? formatAmount(entry.debit, ledger.summary.currency) : '—'}
                        </td>
                        <td className={styles.tdPositive}>
                          {entry.credit ? formatAmount(entry.credit, ledger.summary.currency) : '—'}
                        </td>
                        <td className={styles.tdStrong}>
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
            <Panel className={styles.pad}>
              <h4 className={styles.subheading}>Bursaries</h4>
              <ul className={styles.stackTight}>
                {ledger.bursaries.map(bursary => (
                  <li key={bursary.id} className={styles.noteRow}>
                    <span className={styles.strong}>{bursary.name}</span>
                    <span className={styles.note}>
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
