import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { callFees } from '@/lib/fees';
import { formatDate, todayIso } from '@/lib/format';
import { classAndSection, classOptionsFor } from '@/lib/classLevels';
import Field from '@/components/common/Field';
import { TablePager, TableSkeleton } from '@/components/common';
import { usePagedRows } from '@/hooks/usePagedRows';
import type { StandingRow } from '@/types/feeAdmin';
import RatingCard from './RatingCard';
import { EmptyState, Panel, SecondaryButton, StandingBadge, STANDING_OPTIONS, zebra } from './shared';
import styles from '../tabs.module.scss';
import { Launch, Renew, WarningAlt } from '@carbon/react/icons';
import { Button, Checkbox } from '@carbon/react';

/** A payment grade, coloured from good to poor. The letter carries the meaning; the colour is
    what lets a long list be scanned without reading every row. */
const GRADE_TONE: Record<string, string> = {
  A: styles.gradeA,
  B: styles.gradeB,
  C: styles.gradeC,
  D: styles.gradeD,
  E: styles.gradeE,
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
  const { settings } = useSettings();
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

  // One row per student, and the filters above are the server's, so an unfiltered school arrives
  // whole. The review-due banner counts the whole list, not the page — it is a prompt to act on
  // everything outstanding, and a per-page count would understate it.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(rows, 25);

  const reviewsDue = rows.filter(row => row.override?.review_due).length;

  return (
    <div className={styles.stack}>
      <Panel className={styles.pad}>
        <div className={styles.grid4}>
          <Field
            label="Standing"
            value={standing}
            onChange={value => setStanding(String(value))}
            options={[{ value: '', label: 'All standings' }, { value: 'unrated', label: 'Unrated' }, ...STANDING_OPTIONS]}
 />
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
          <div className={styles.toolbar}>
            <Checkbox
              id="review-due-only"
              labelText="Overrides due for review"
              checked={reviewDueOnly}
              onChange={(_event, { checked }) => setReviewDueOnly(checked)}
            />
          </div>
          <div className={styles.toolbar}>
            <SecondaryButton onClick={load} disabled={loading}>
              <Renew size={16} /> Refresh
            </SecondaryButton>
          </div>
        </div>
      </Panel>

      {reviewsDue > 0 && !reviewDueOnly && (
        <button onClick={() => setReviewDueOnly(true)} className={styles.warnBanner}>
          <WarningAlt size={16} />
          <span className={styles.warn}>
            {reviewsDue} manual override{reviewsDue === 1 ? '' : 's'} passed the review date set for {reviewsDue === 1 ? 'it' : 'them'}.
          </span>
        </button>
      )}

      <Panel >
        {loading && rows.length === 0 ? (
          <TableSkeleton
            rowCount={8}
            columnLabels={['Student', 'Class', 'Standing', 'Grade', 'Score', 'On time', 'Review', '']}
          />
        ) : rows.length === 0 ? (
          <EmptyState message="No students match these filters." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead className={styles.thead}>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Standing</th>
                  <th className={styles.th}>Grade</th>
                  <th className={styles.numeric}>Score</th>
                  <th>On time</th>
                  <th>Review</th>
                  <th className={styles.numeric} />
                </tr>
              </thead>
              <tbody className={styles.rows}>
                {pageRows.map(row => (
                  <React.Fragment key={row.student_id}>
                    <tr className={zebra}>
                      <td>
                        <p className={styles.strong}>{row.full_name}</p>
                        <p className={styles.note}>{row.student_number}</p>
                      </td>
                      <td>
                        {classAndSection(settings.school_level, row.grade_level, row.class_section)}
                      </td>
                      <td>
                        <StandingBadge standing={row.standing} source={row.source} />
                      </td>
                      <td className={`${styles.grade} ${GRADE_TONE[row.computed.grade || ''] || styles.muted}`}>
                        {row.computed.grade || '—'}
                      </td>
                      <td className={styles.tdNumeric}>
                        {row.computed.score === null ? '—' : row.computed.score}
                      </td>
                      <td className={styles.td}>
                        {row.computed.metrics.onTimeCount + row.computed.metrics.lateCount === 0
                          ? '—'
                          : `${row.computed.metrics.onTimeCount}/${row.computed.metrics.onTimeCount + row.computed.metrics.lateCount}`}
                      </td>
                      <td className={styles.td}>
                        {row.override?.review_date ? (
                          <span className={row.override.review_due ? styles.warn : styles.note}>
                            {formatDate(row.override.review_date)}
                          </span>
                        ) : (
                          <span className={styles.note}>—</span>
                        )}
                      </td>
                      <td>
                        <div className={styles.actionsEnd}>
                          <Button
                            kind="ghost"
                            size="sm"
                            onClick={() => setExpanded(expanded === row.student_id ? null : row.student_id)}
                          >
                            {expanded === row.student_id ? 'Hide' : 'Manage'}
                          </Button>
                          <Button
                            hasIconOnly
                            kind="ghost"
                            size="sm"
                            renderIcon={Launch}
                            iconDescription={`Open ledger for ${row.full_name}`}
                            tooltipPosition="left"
                            onClick={() => onOpenLedger(row.student_id)}
                          />
                        </div>
                      </td>
                    </tr>
                    {expanded === row.student_id && (
                      <tr>
                        <td colSpan={8} className={styles.sectionRow}>
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

        {!loading && rows.length > 0 && (
          <div className={styles.tableFoot}>
            <TablePager
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              firstOnPage={firstOnPage}
              lastOnPage={lastOnPage}
              total={rows.length}
              noun="student"
            />
          </div>
        )}
      </Panel>
    </div>
  );
};

export default FeeRatingsTab;
