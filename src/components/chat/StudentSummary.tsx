import React, { useCallback, useEffect, useState } from 'react';
import { Button, InlineLoading, InlineNotification, Tag } from '@carbon/react';
import {
  ArrowLeft,
  ChartLine,
  Download,
  Money,
  Printer,
  UserFollow,
  UserProfile,
  Warning,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { classAndSection } from '@/lib/classLevels';
import { downloadFromUrl, printFromUrl } from '@/lib/download';
import { formatAmount, formatDate } from '@/lib/format';
import { loadStudentSummary, studentReportUrl, type StudentSummary as Summary } from '@/lib/studentSummary';
import { CardHeader, EmptyState, PageHeader, StatRow, StatTile, WidgetCard } from '@/components/common';
import styles from './student-summary.module.scss';

/**
 * Everything the school holds about one student, on one screen.
 *
 * Where a search result lands. Somebody at a desk with a parent in front of them was previously
 * expected to visit the roster, the records workspace and the ledger to answer one question about
 * one child; this is that question answered in a single place, and printable in a single click.
 *
 * Sections appear only when the server sent them, and the server sends only what the reader's role
 * may see. So a section missing here means "not yours", and one that is present but empty means
 * "nothing on file" — which is why an absent section renders nothing at all rather than an empty
 * card that would read as the second thing while meaning the first.
 */

const Facts: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (shown.length === 0) return <p className={styles.none}>Nothing recorded.</p>;

  return (
    <dl className={styles.facts}>
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <WidgetCard>
    <CardHeader title={title} />
    <div className={styles.sectionBody}>{children}</div>
  </WidgetCard>
);

const SEVERITY_TONE: Record<string, 'red' | 'magenta' | 'warm-gray'> = {
  major: 'red',
  moderate: 'magenta',
  minor: 'warm-gray',
};

const StudentSummary: React.FC = () => {
  const { focus, clearFocus, setActiveView } = useChatContext();
  const { user, isLoading: authLoading } = useAuth();
  const { settings } = useSettings();
  const { notify } = useNotifications();

  // Held here rather than read from focus on every render: focus is cleared as soon as it is
  // consumed, so that the screen can be revisited without re-triggering, and the code has to
  // outlive it.
  const [code, setCode] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (focus?.view !== 'student' || !focus.studentId) return;
    setCode(focus.studentId);
    clearFocus();
  }, [focus, clearFocus]);

  const load = useCallback(async () => {
    if (authLoading || !user || !code) return;
    setError(null);
    try {
      setSummary(await loadStudentSummary(code));
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : 'The summary could not be loaded.');
    }
  }, [authLoading, user, code]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      notify.error(label, err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!code) {
    return (
      <div className={styles.screen}>
        <PageHeader title="Student summary" illustration={<UserProfile size={32} />} />
        <div className={styles.body}>
          <EmptyState
            headerTitle="Student summary"
            displayText="student open"
            helperText="Search for a student in the bar at the top, and their whole record opens here."
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.screen}>
        <PageHeader title="Student summary" illustration={<UserProfile size={32} />} />
        <div className={styles.body}>
          <InlineNotification
            kind="error"
            title="That student's summary could not be opened"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className={styles.screen}>
        <PageHeader title="Student summary" illustration={<UserProfile size={32} />} />
        <div className={styles.body}>
          <InlineLoading description="Gathering this student's record…" />
        </div>
      </div>
    );
  }

  const { student } = summary;
  const reportUrl = studentReportUrl(student.student_id || student.id);

  return (
    <div className={styles.screen}>
      <PageHeader
        title={student.full_name}
        illustration={
          student.photo_url ? (
            <img src={student.photo_url} alt="" className={styles.portrait} />
          ) : (
            <UserProfile size={32} />
          )
        }
      >
        <Tag type="cool-gray" size="sm">
          {student.student_id}
        </Tag>
        <Tag type="blue" size="sm">
          {classAndSection(settings.school_level, student.grade_level, student.class_section)}
        </Tag>
        {student.status !== 'active' && (
          <Tag type="warm-gray" size="sm">
            {student.status}
          </Tag>
        )}
        <Button kind="ghost" size="sm" renderIcon={ArrowLeft} onClick={() => setActiveView('students')}>
          Back to roster
        </Button>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Download}
          disabled={busy}
          onClick={() =>
            run('The record could not be downloaded', () =>
              downloadFromUrl(reportUrl, `${student.student_id}-record.pdf`),
            )
          }
        >
          Download
        </Button>
        <Button
          kind="primary"
          size="sm"
          renderIcon={Printer}
          disabled={busy}
          onClick={() => run('The record could not be printed', () => printFromUrl(reportUrl))}
        >
          Print everything
        </Button>
      </PageHeader>

      <div className={styles.controls}>
        <StatRow>
          {summary.academics && (
            <StatTile label="Average" value={`${summary.academics.average.toFixed(1)}%`} icon={ChartLine} />
          )}
          {summary.attendance && (
            <StatTile
              label="Attendance"
              value={`${summary.attendance.rate.toFixed(0)}%`}
              icon={UserFollow}
              tone={summary.attendance.rate >= 90 ? 'success' : 'warning'}
            />
          )}
          {summary.fees && (
            <StatTile
              label="Balance"
              value={formatAmount(summary.fees.balance_due, summary.fees.currency)}
              icon={Money}
              tone={summary.fees.balance_due > 0 ? 'warning' : 'success'}
            />
          )}
          {summary.discipline && (
            <StatTile
              label="Incidents"
              value={summary.discipline.entries.length}
              icon={Warning}
              tone={summary.discipline.entries.length > 0 ? 'warning' : 'default'}
            />
          )}
        </StatRow>
      </div>

      <div className={styles.body}>
        <div className={styles.columns}>
          {summary.bio && (
            <Section title="Biodata">
              <Facts
                rows={[
                  ['Date of birth', formatDate(summary.bio.date_of_birth)],
                  ['Gender', summary.bio.gender],
                  ['Blood group', summary.bio.blood_group],
                  ['Registered', formatDate(summary.bio.enrollment_date)],
                  ['Address', summary.bio.address],
                  ['Email', summary.bio.email],
                  ['Phone', summary.bio.phone],
                  ['Notes', summary.bio.notes],
                ]}
              />
            </Section>
          )}

          {summary.parents && (
            <Section title="Parents and emergency contact">
              <Facts
                rows={[
                  ['Parent or guardian', summary.parents.parent_name],
                  ['Phone', summary.parents.parent_phone],
                  ['Email', summary.parents.parent_email],
                  ['Emergency contact', summary.parents.emergency_contact_name],
                  ['Emergency phone', summary.parents.emergency_contact_phone],
                  ['Relationship', summary.parents.emergency_contact_relation],
                ]}
              />
            </Section>
          )}

          {summary.academics && (
            <Section title="Grades">
              {summary.academics.subjects.length === 0 ? (
                <p className={styles.none}>No marks recorded yet.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th className={styles.numeric}>Score</th>
                        <th>Grade</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.academics.subjects.map((row, index) => (
                        <tr key={`${row.subject}-${index}`}>
                          <td>{row.subject}</td>
                          <td className={styles.numeric}>
                            {row.score} / {row.max_score}
                          </td>
                          <td>{row.grade || '—'}</td>
                          <td>{row.remarks || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {summary.attendance && (
            <Section title="Attendance">
              <Facts
                rows={[
                  ['Days recorded', summary.attendance.total],
                  ['Present', summary.attendance.counts.present || 0],
                  ['Absent', summary.attendance.counts.absent || 0],
                  ['Late', summary.attendance.counts.late || 0],
                  ['Excused', summary.attendance.counts.excused || 0],
                ]}
              />
              {summary.attendance.entries.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.attendance.entries.map((row) => (
                        <tr key={`${row.attendance_date}-${row.status}`}>
                          <td>{formatDate(row.attendance_date)}</td>
                          <td>{row.status}</td>
                          <td>{row.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {summary.fees && (
            <Section title="Fees">
              <Facts
                rows={[
                  ['Invoices', summary.fees.invoice_count],
                  ['Invoiced', formatAmount(summary.fees.total_invoiced, summary.fees.currency)],
                  ['Paid', formatAmount(summary.fees.total_paid, summary.fees.currency)],
                  ['Outstanding', formatAmount(summary.fees.balance_due, summary.fees.currency)],
                ]}
              />
            </Section>
          )}

          {summary.payments && (
            <Section title="Payments">
              {summary.payments.entries.length === 0 ? (
                <p className={styles.none}>Nothing has been paid yet.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className={styles.numeric}>Amount</th>
                        <th>Method</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.payments.entries.map((row, index) => (
                        <tr key={`${row.paid_at}-${index}`}>
                          <td>{formatDate(row.paid_at)}</td>
                          <td className={styles.numeric}>{formatAmount(row.amount, row.currency)}</td>
                          <td>{row.method || '—'}</td>
                          <td>{row.receipt_number || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {summary.discipline && (
            <Section title="Discipline">
              {summary.discipline.entries.length === 0 ? (
                <p className={styles.none}>Nothing on record — which is worth saying plainly.</p>
              ) : (
                summary.discipline.entries.map((row) => (
                  <div key={row.id} className={styles.incident}>
                    <div className={styles.incidentHead}>
                      <span className={styles.strong}>{row.category}</span>
                      <Tag type={SEVERITY_TONE[row.severity] || 'warm-gray'} size="sm">
                        {row.severity}
                      </Tag>
                      <span className={styles.meta}>{formatDate(row.incident_date)}</span>
                    </div>
                    <p className={styles.incidentBody}>{row.description}</p>
                    {row.action_taken && <p className={styles.meta}>Action: {row.action_taken}</p>}
                  </div>
                ))
              )}
            </Section>
          )}

          {summary.movements && (
            <Section title="Admission and movements">
              {summary.movements.admissions.length === 0 &&
              summary.movements.promotions.length === 0 &&
              summary.movements.transfers.length === 0 ? (
                <p className={styles.none}>No admission, promotion or transfer on file.</p>
              ) : (
                <ul className={styles.timeline}>
                  {summary.movements.admissions.map((row) => (
                    <li key={row.id}>
                      <span className={styles.strong}>Admitted</span> · application {row.application_number} ·{' '}
                      {formatDate(row.submitted_at)} · {row.status}
                    </li>
                  ))}
                  {summary.movements.promotions.map((row) => (
                    <li key={row.id}>
                      <span className={styles.strong}>{row.decision}</span> ·{' '}
                      {classAndSection(settings.school_level, row.from_grade_level, row.from_class_section)} →{' '}
                      {classAndSection(settings.school_level, row.to_grade_level, row.to_class_section)} ·{' '}
                      {row.academic_year} · {formatDate(row.effective_date)}
                    </li>
                  ))}
                  {summary.movements.transfers.map((row) => (
                    <li key={row.id}>
                      <span className={styles.strong}>{row.movement_type}</span> ·{' '}
                      {row.destination_school || 'destination not recorded'} · {formatDate(row.effective_date)} ·{' '}
                      {row.status}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentSummary;
