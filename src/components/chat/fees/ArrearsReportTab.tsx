import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callFees } from '@/lib/fees';
import { formatAmount, formatDate, todayIso } from '@/lib/format';
import Field from '@/components/common/Field';
import type { ArrearsReport } from '@/types/feeAdmin';
import { AGING_COLUMNS, EmptyState, Panel, SecondaryButton, StandingBadge, zebra } from './shared';

const ArrearsReportTab = ({ runAction }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void> }) => {
  const { user } = useAuth();
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
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="As at" type="date" value={asOf} onChange={value => setAsOf(String(value))} />
          <Field label="Grade level" value={gradeLevel} onChange={value => setGradeLevel(String(value))} placeholder="All grades" />
          <Field label="Minimum balance" type="number" min={0} value={minBalance} onChange={value => setMinBalance(Number(value))} />
          <div className="flex items-end gap-2">
            <SecondaryButton onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </SecondaryButton>
            <SecondaryButton onClick={exportCsv} disabled={!report || report.rows.length === 0}>
              <Download className="w-3.5 h-3.5" /> CSV
            </SecondaryButton>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        {loading ? (
          <EmptyState message="Building arrears report…" />
        ) : !report || report.rows.length === 0 ? (
          <EmptyState message="No outstanding balances match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Student</th>
                  <th className="text-left font-medium px-4 py-2.5">Class</th>
                  {AGING_COLUMNS.map(column => (
                    <th key={column.key} className="text-right font-medium px-4 py-2.5">{column.label}</th>
                  ))}
                  <th className="text-right font-medium px-4 py-2.5">Total</th>
                  <th className="text-left font-medium px-4 py-2.5">Oldest due</th>
                  <th className="text-left font-medium px-4 py-2.5">Standing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {report.rows.map(row => (
                  <tr key={row.student_id} className={zebra}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800 dark:text-white">{row.full_name}</p>
                      <p className="text-xs text-gray-400">{row.student_number}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      Grade {row.grade_level} {row.class_section}
                    </td>
                    {AGING_COLUMNS.map(column => (
                      <td key={column.key} className={`px-4 py-2.5 text-right ${row[column.key] > 0 ? column.tone : 'text-gray-300 dark:text-gray-600'}`}>
                        {row[column.key] > 0 ? formatAmount(row[column.key], report.currency) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-white">
                      {formatAmount(row.total_outstanding, report.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      {row.oldest_due_date ? (
                        <span className="flex items-center gap-1">
                          {formatDate(row.oldest_due_date)}
                          <span className="text-[10px] text-red-500">({row.days_overdue}d)</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.standing ? <StandingBadge standing={row.standing} source="manual" /> : <span className="text-xs text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900/40 text-sm font-medium">
                <tr>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200" colSpan={2}>
                    Totals · {report.rows.length} student{report.rows.length === 1 ? '' : 's'}
                  </td>
                  {AGING_COLUMNS.map(column => (
                    <td key={column.key} className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-200">
                      {formatAmount(report.totals[column.key], report.currency)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-gray-900 dark:text-white">
                    {formatAmount(report.totals.total, report.currency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      {report && report.totals.days_90_plus > 0 && (
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">
            {formatAmount(report.totals.days_90_plus, report.currency)} has been outstanding for more than 90 days.
          </p>
        </div>
      )}
    </div>
  );
};

export default ArrearsReportTab;
