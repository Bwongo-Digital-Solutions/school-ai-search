import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { callFees } from '@/lib/fees';
import { formatAmount, formatDate, todayIso } from '@/lib/format';
import { classAndSection, classOptionsFor } from '@/lib/classLevels';
import Field from '@/components/common/Field';
import type { ArrearsReport } from '@/types/feeAdmin';
import { TablePager, TableSkeleton } from '@/components/common';
import { usePagedRows } from '@/hooks/usePagedRows';
import { AGING_COLUMNS, EmptyState, Panel, SecondaryButton, StandingBadge, zebra } from './shared';
import styles from '../tabs.module.scss';
import { Download, Renew, Warning } from '@carbon/react/icons';
import { InlineNotification } from '@carbon/react';

/** Stable identity for "no report yet", so the pager's memo does not churn on every render. */
const NO_ROWS: ArrearsReport['rows'] = [];

const ArrearsReportTab = ({ runAction }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void> }) => {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [report, setReport] = useState<ArrearsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState(todayIso());
  const [gradeLevel, setGradeLevel] = useState('');
  const [minBalance, setMinBalance] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await callFees<ArrearsReport>('arrears_report', {
        asOf,
        gradeLevel: gradeLevel || undefined,
        minBalance,
      }, user));
    } catch (err) {
      console.error('Failed to load arrears report:', err);
      setReport(null);
    }
    setLoading(false);
  }, [asOf, gradeLevel, minBalance, user]);

  useEffect(() => { load(); }, [load]);

  // One row per student in arrears. The totals in the footer stay whole-report — they come from the
  // server, and a page's worth of subtotals would be a different and much less useful number.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(
    report?.rows ?? NO_ROWS,
    25,
  );

  const exportCsv = () =>
    runAction('Exporting arrears report', async () => {
      if (!report) return;
      const header = ['Student number', 'Name', 'Grade', 'Section', ...AGING_COLUMNS.map(column => column.label), 'Total outstanding', 'Oldest due', 'Days overdue', 'Standing'];
      const rows = report.rows.map(row => [
        row.student_number,
        row.full_name,
        row.grade_level,
        row.class_section,
        ...AGING_COLUMNS.map(column => row[column.key]),
        row.total_outstanding,
        row.oldest_due_date || '',
        row.days_overdue,
        row.standing || '',
      ]);
      const csv = [header, ...rows]
        .map(line => line.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `arrears-${report.asOf}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });

  return (
    <div className={styles.stack}>
      <Panel className={styles.pad}>
        <div className={styles.grid4}>
          <Field label="As at" type="date" value={asOf} onChange={value => setAsOf(String(value))} />
          <Field
            label="Class"
            value={gradeLevel}
            onChange={value => setGradeLevel(String(value))}
            options={[
              { value: '', label: 'All classes' },
              ...classOptionsFor(settings.school_level).map(option => ({
                value: String(option.value),
                label: option.label,
              })),
            ]}
          />
          <Field label="Minimum balance" type="number" min={0} value={minBalance} onChange={value => setMinBalance(Number(value))} />
          <div className={styles.toolbar}>
            <SecondaryButton onClick={load} disabled={loading}>
              <Renew size={16} /> Refresh
            </SecondaryButton>
            <SecondaryButton onClick={exportCsv} disabled={!report || report.rows.length === 0}>
              <Download size={16} /> CSV
            </SecondaryButton>
          </div>
        </div>
      </Panel>

      <Panel >
        {loading && !report ? (
          <TableSkeleton
            rowCount={8}
            columnLabels={[
              'Student',
              'Class',
              ...AGING_COLUMNS.map(column => column.label),
              'Total',
              'Oldest due',
              'Standing',
            ]}
          />
        ) : !report || report.rows.length === 0 ? (
          <EmptyState message="No outstanding balances match these filters." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead className={styles.thead}>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  {AGING_COLUMNS.map(column => (
                    <th key={column.key} className={styles.numeric}>{column.label}</th>
                  ))}
                  <th className={styles.numeric}>Total</th>
                  <th>Oldest due</th>
                  <th>Standing</th>
                </tr>
              </thead>
              <tbody className={styles.rows}>
                {pageRows.map(row => (
                  <tr key={row.student_id} className={zebra}>
                    <td>
                      <p className={styles.strong}>{row.full_name}</p>
                      <p className={styles.note}>{row.student_number}</p>
                    </td>
                    <td>
                      {classAndSection(settings.school_level, row.grade_level, row.class_section)}
                    </td>
                    {/* A zero in an ageing bucket is not news, so it recedes; a figure in the
                        90-plus column should be the loudest thing in the row. */}
                    {AGING_COLUMNS.map(column => (
                      <td
                        key={column.key}
                        className={`${styles.numeric} ${row[column.key] > 0 ? column.tone : styles.muted}`}
                      >
                        {row[column.key] > 0 ? formatAmount(row[column.key], report.currency) : '—'}
                      </td>
                    ))}
                    <td className={styles.tdStrong}>
                      {formatAmount(row.total_outstanding, report.currency)}
                    </td>
                    <td>
                      {row.oldest_due_date ? (
                        <span className={styles.actions}>
                          {formatDate(row.oldest_due_date)}
                          <span className={styles.negative}>({row.days_overdue}d)</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {row.standing ? <StandingBadge standing={row.standing} source="manual" /> : <span className={styles.note}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className={styles.thead}>
                <tr>
                  <td className={styles.td} colSpan={2}>
                    Totals · {report.rows.length} student{report.rows.length === 1 ? '' : 's'}
                  </td>
                  {AGING_COLUMNS.map(column => (
                    <td key={column.key} className={styles.tdNumeric}>
                      {formatAmount(report.totals[column.key], report.currency)}
                    </td>
                  ))}
                  <td className={styles.tdStrong}>
                    {formatAmount(report.totals.total, report.currency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {report && report.rows.length > 0 && (
          <div className={styles.tableFoot}>
            <TablePager
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              firstOnPage={firstOnPage}
              lastOnPage={lastOnPage}
              total={report.rows.length}
              noun="student"
            />
          </div>
        )}
      </Panel>

      {report && report.totals.days_90_plus > 0 && (
        <InlineNotification
          kind="error"
          title="Long-overdue debt"
          subtitle={`${formatAmount(report.totals.days_90_plus, report.currency)} has been outstanding for more than 90 days.`}
          lowContrast
          hideCloseButton
        />
      )}
    </div>
  );
};

export default ArrearsReportTab;
