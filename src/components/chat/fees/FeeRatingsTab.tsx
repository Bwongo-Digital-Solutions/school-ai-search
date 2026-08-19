import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callFees } from '@/lib/fees';
import { formatDate, todayIso } from '@/lib/format';
import Field from '@/components/common/Field';
import type { StandingRow } from '@/types/feeAdmin';
import RatingCard from './RatingCard';
import { EmptyState, Panel, SecondaryButton, StandingBadge, STANDING_OPTIONS, zebra } from './shared';

const GRADE_TONE: Record<string, string> = {
  A: 'text-emerald-500',
  B: 'text-teal-500',
  C: 'text-amber-500',
  D: 'text-orange-500',
  E: 'text-red-500',
};

const FeeRatingsTab = ({
  runAction,
  onChanged,
  onOpenLedger,
}: {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  onOpenLedger: (studentId: string) => void;
}) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [standing, setStanding] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [reviewDueOnly, setReviewDueOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callFees<{ rows: StandingRow[] }>('list_standings', {
        standing: standing || undefined,
        gradeLevel: gradeLevel || undefined,
        reviewDueOnly,
        asOf: todayIso(),
      }, user);
      setRows(data.rows);
    } catch (err) {
      console.error('Failed to load payment ratings:', err);
      setRows([]);
    }
    setLoading(false);
  }, [gradeLevel, reviewDueOnly, standing, user]);

  useEffect(() => { load(); }, [load]);

  const reviewsDue = rows.filter(row => row.override?.review_due).length;

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field
            label="Standing"
            value={standing}
            onChange={value => setStanding(String(value))}
            options={[{ value: '', label: 'All standings' }, { value: 'unrated', label: 'Unrated' }, ...STANDING_OPTIONS]}
          />
          <Field label="Grade level" value={gradeLevel} onChange={value => setGradeLevel(String(value))} placeholder="All grades" />
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 pb-2">
              <input
                type="checkbox"
                checked={reviewDueOnly}
                onChange={event => setReviewDueOnly(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
              />
              Overrides due for review
            </label>
          </div>
          <div className="flex items-end">
            <SecondaryButton onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </SecondaryButton>
          </div>
        </div>
      </Panel>

      {reviewsDue > 0 && !reviewDueOnly && (
        <button
          onClick={() => setReviewDueOnly(true)}
          className="w-full flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-left"
        >
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <span className="text-sm text-amber-700 dark:text-amber-300">
            {reviewsDue} manual override{reviewsDue === 1 ? '' : 's'} passed the review date set for {reviewsDue === 1 ? 'it' : 'them'}.
          </span>
        </button>
      )}

      <Panel className="overflow-hidden">
        {loading ? (
          <EmptyState message="Computing payment ratings…" />
        ) : rows.length === 0 ? (
          <EmptyState message="No students match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Student</th>
                  <th className="text-left font-medium px-4 py-2.5">Class</th>
                  <th className="text-left font-medium px-4 py-2.5">Standing</th>
                  <th className="text-center font-medium px-4 py-2.5">Grade</th>
                  <th className="text-right font-medium px-4 py-2.5">Score</th>
                  <th className="text-left font-medium px-4 py-2.5">On time</th>
                  <th className="text-left font-medium px-4 py-2.5">Review</th>
                  <th className="text-right font-medium px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map(row => (
                  <React.Fragment key={row.student_id}>
                    <tr className={zebra}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800 dark:text-white">{row.full_name}</p>
                        <p className="text-xs text-gray-400">{row.student_number}</p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                        Grade {row.grade_level} {row.class_section}
                      </td>
                      <td className="px-4 py-2.5">
                        <StandingBadge standing={row.standing} source={row.source} />
                      </td>
                      <td className={`px-4 py-2.5 text-center font-bold ${GRADE_TONE[row.computed.grade || ''] || 'text-gray-400'}`}>
                        {row.computed.grade || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">
                        {row.computed.score === null ? '—' : row.computed.score}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                        {row.computed.metrics.onTimeCount + row.computed.metrics.lateCount === 0
                          ? '—'
                          : `${row.computed.metrics.onTimeCount}/${row.computed.metrics.onTimeCount + row.computed.metrics.lateCount}`}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {row.override?.review_date ? (
                          <span className={row.override.review_due ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                            {formatDate(row.override.review_date)}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setExpanded(expanded === row.student_id ? null : row.student_id)}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {expanded === row.student_id ? 'Hide' : 'Manage'}
                          </button>
                          <button
                            onClick={() => onOpenLedger(row.student_id)}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                            aria-label={`Open ledger for ${row.full_name}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded === row.student_id && (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 bg-gray-50/60 dark:bg-gray-900/40">
                          <RatingCard
                            compact
                            student={row}
                            rating={row}
                            runAction={runAction}
                            onChanged={async () => { await load(); onChanged(); }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};

export default FeeRatingsTab;
