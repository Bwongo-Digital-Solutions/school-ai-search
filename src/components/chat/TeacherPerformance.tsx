import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Slider,
  TextInput,
} from '@carbon/react';
import {
  Book,
  Calendar,
  CheckmarkFilled,
  Education,
  ListChecked,
  Renew,
  UserFollow,
  UserMultiple,
} from '@carbon/react/icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { academicYear, TERMS } from '@/lib/format';
import { classAndSection } from '@/lib/classLevels';
import { CardHeader, PageHeader, StatRow, StatTile, WidgetCard } from '@/components/common';
import workspace from './workspace.module.scss';
import styles from './teacher-performance.module.scss';

/* How a teacher's work is attributed. 'allocated' means it was read off the classes they are
   assigned to; 'inferred' means nothing assigns them anything, so it was taken from the work
   they demonstrably did — the plans they wrote, the registers they called. 'none' means no
   honest attribution was possible and nothing is claimed. */
type Source = 'allocated' | 'inferred' | 'none';

interface StaffRow {
  id: string;
  auth_email: string;
  display_name: string;
  role: string;
  teacher_id: string | null;
  allocation_rows: number;
}

interface SubjectResult {
  subject: string;
  entries: number;
  passed: number;
  failed: number;
  average_percent: number;
}

interface Summary {
  teacher: { id: string; name: string; email: string; role: string; allocated: boolean };
  pass_mark: number;
  classes: { grade_level: number; class_section: string; subjects: string[]; students: number }[];
  lessons: {
    total: number; draft: number; approved: number; delivered: number;
    minutes: number; timetabled_periods: number;
  };
  attendance: {
    source: Source; total: number; present: number; absent: number; late: number;
    excused: number; present_rate: number | null;
  };
  results: {
    source: Source; entries: number; passed: number; failed: number;
    pass_rate: number | null; average_percent: number | null; by_subject: SubjectResult[];
  };
}

const Section = ({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <WidgetCard>
    <CardHeader title={title}>
      {subtitle && <span className={workspace.note}>{subtitle}</span>}
      {right}
    </CardHeader>
    {children}
  </WidgetCard>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className={workspace.empty}>{children}</p>
);

/** A count with its label under it, for the tallies inside each card. */
const Tally = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className={workspace.tallyItem}>
    <p className={workspace.tallyValue}>{value}</p>
    <p className={workspace.tallyLabel}>{label}</p>
  </div>
);

/** Says plainly where a figure came from, so an estimate is never read as a record. */
const SourceNote = ({ source }: { source: Source }) => {
  if (source === 'allocated') return null;
  const text =
    source === 'inferred'
      ? 'No classes are assigned to this teacher, so this counts the registers they called rather '
        + 'than their own students.'
      : 'Nothing is assigned to this teacher, so no marks can be attributed to them.';
  return (
    <div className={styles.sourceNote}>
      <InlineNotification
        kind="info"
        title={source === 'inferred' ? 'Estimated' : 'Not attributable'}
        subtitle={text}
        lowContrast
        hideCloseButton
      />
    </div>
  );
};

/**
 * A pass/fail bar. Red across the full width with green over the passes, so it reads as "how much
 * of this got through" rather than as two colours competing for the same space.
 */
const PassBar = ({ passed, failed }: { passed: number; failed: number }) => {
  const total = passed + failed;
  if (!total) return null;
  return (
    <div className={styles.passBar} title={`${passed} passed, ${failed} failed`}>
      <div className={styles.passBarFill} style={{ width: `${(passed / total) * 100}%` }} />
    </div>
  );
};

/**
 * `embedded` drops the page header and the screen's own background, for when this is shown as a
 * section of Monitoring rather than as a screen of its own — two page titles stacked would read as
 * two screens.
 */
const TeacherPerformance: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const { isAdmin } = useAuth();
  const { settings } = useSettings();

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passMark, setPassMark] = useState(50);
  const [term, setTerm] = useState(TERMS[0]);
  const [year, setYear] = useState(academicYear());

  // Allocation form (admins only) — the thing that makes any of these figures attributable.
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [classSection, setClassSection] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data: result, error: failure } = await supabase.functions.invoke<unknown>(
      'teacher-performance', { body },
    );
    if (failure) throw new Error(failure.message || 'Could not reach the server.');
    return result;
  }, []);

  const loadStaff = useCallback(async () => {
    try {
      const res = (await call({ action: 'staff' })) as { staff: StaffRow[] };
      setStaff(res.staff || []);
      setSelected((prev) => prev || res.staff?.[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the teaching staff.');
      setLoading(false);
    }
  }, [call]);

  const loadSummary = useCallback(async (userId: string, mark: number) => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      setData((await call({ action: 'summary', userId, passMark: mark })) as Summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load these figures.');
      setData(null);
    }
    setLoading(false);
  }, [call]);

  useEffect(() => { loadStaff(); }, [loadStaff]);
  useEffect(() => { loadSummary(selected, passMark); }, [selected, passMark, loadSummary]);

  const allocate = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const res = (await call({
        action: 'allocate',
        userId: selected,
        subject,
        gradeLevel: Number(gradeLevel),
        classSection,
        academicYear: year,
        term,
      })) as { allocated: { students: number; subject: string } };
      setNotice(`${res.allocated.subject} assigned for ${res.allocated.students} student(s).`);
      setSubject('');
      setGradeLevel('');
      setClassSection('');
      await loadStaff();
      await loadSummary(selected, passMark);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that allocation.');
    }
    setSaving(false);
  };

  const chosen = useMemo(() => staff.find((row) => row.id === selected), [staff, selected]);

  return (
    <div className={embedded ? styles.embedded : workspace.screen}>
      {!embedded && (
        <PageHeader title="Teacher performance" illustration={<Education size={32} />}>
          <Button
            kind="ghost"
            size="sm"
            renderIcon={Renew}
            onClick={() => loadSummary(selected, passMark)}
            disabled={loading}
          >
            Refresh
          </Button>
        </PageHeader>
      )}

      <div className={workspace.controls}>
        <div className={styles.controls}>
          {embedded && (
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Renew}
              onClick={() => loadSummary(selected, passMark)}
              disabled={loading}
            >
              Refresh
            </Button>
          )}
          <Select
            id="teacher-picker"
            className={styles.teacherPicker}
            labelText="Teacher"
            value={selected}
            disabled={!isAdmin}
            onChange={(event) => setSelected(event.target.value)}
          >
            {staff.map((row) => (
              <SelectItem
                key={row.id}
                value={row.id}
                text={`${row.display_name}${row.allocation_rows ? '' : ' — nothing assigned'}`}
              />
            ))}
          </Select>

          {/* The pass mark is a judgement, not a fact, so it is adjustable here rather than fixed
              in the data — a school that marks out of 40 reads a different line as "passing". */}
          <Slider
            id="pass-mark"
            className={styles.slider}
            labelText="Pass mark"
            min={0}
            max={100}
            step={5}
            value={passMark}
            onChange={({ value }) => setPassMark(value)}
          />
        </div>
      </div>

      <div className={`${workspace.body} ${workspace.bodyTop}`}>
        {error && (
          <InlineNotification
            kind="error"
            title="Could not load these figures"
            subtitle={error}
            onCloseButtonClick={() => setError('')}
            lowContrast
          />
        )}

        {notice && (
          <InlineNotification
            kind="success"
            title={notice}
            onCloseButtonClick={() => setNotice('')}
            lowContrast
          />
        )}

        {loading && !data && (
          <div className={workspace.loading}>
            <InlineLoading description="Loading these figures…" />
          </div>
        )}

        {data && (
          <>
            <StatRow>
              <StatTile label="Lessons planned" value={data.lessons.total} icon={ListChecked} />
              <StatTile
                label="Delivered"
                value={data.lessons.delivered}
                icon={CheckmarkFilled}
                tone="success"
              />
              <StatTile
                label="Attendance"
                value={data.attendance.present_rate === null ? '—' : `${data.attendance.present_rate}%`}
                icon={Calendar}
                tone={
                  data.attendance.present_rate !== null && data.attendance.present_rate < 80
                    ? 'warning'
                    : 'default'
                }
              />
              <StatTile
                label={`Passing at ${data.pass_mark}%`}
                value={data.results.pass_rate === null ? '—' : `${data.results.pass_rate}%`}
                icon={Education}
                tone={data.results.pass_rate !== null && data.results.pass_rate < 50 ? 'danger' : 'success'}
              />
            </StatRow>

            <Section
              title="Results"
              subtitle={`${data.results.entries} mark${data.results.entries === 1 ? '' : 's'} across this teacher's subjects`}
            >
              <SourceNote source={data.results.source} />
              {data.results.entries === 0 ? (
                <Empty>
                  {data.teacher.allocated
                    ? 'No marks have been entered for these classes yet.'
                    : 'Assign this teacher a class below and their students’ marks will appear here.'}
                </Empty>
              ) : (
                <>
                  <div className={workspace.tally}>
                    <Tally label="Passed" value={data.results.passed} />
                    <Tally label="Failed" value={data.results.failed} />
                    <Tally label="Average" value={`${data.results.average_percent}%`} />
                  </div>
                  <ul className={workspace.list}>
                    {data.results.by_subject.map((row) => (
                      <li key={row.subject} className={styles.subject}>
                        <div className={styles.subjectHead}>
                          <span className={styles.subjectName}>{row.subject}</span>
                          <span className={styles.subjectStat}>{row.average_percent}% avg</span>
                          <span className={`${styles.subjectStat} ${styles.passed}`}>{row.passed}</span>
                          <span className={styles.subjectStat}>/</span>
                          <span className={`${styles.subjectStat} ${styles.failed}`}>{row.failed}</span>
                        </div>
                        <PassBar passed={row.passed} failed={row.failed} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <div className={workspace.grid2}>
              <Section title="Attendance" subtitle="Registers covering this teacher's students">
                <SourceNote source={data.attendance.source} />
                {data.attendance.total === 0 ? (
                  <Empty>No registers have been called for these students yet.</Empty>
                ) : (
                  <div className={workspace.tally}>
                    <Tally label="Present" value={data.attendance.present} />
                    <Tally label="Absent" value={data.attendance.absent} />
                    <Tally label="Late" value={data.attendance.late} />
                    <Tally label="Excused" value={data.attendance.excused} />
                  </div>
                )}
              </Section>

              <Section title="Lessons" subtitle="Plans written and periods timetabled">
                <div className={workspace.tally}>
                  <Tally label="Draft" value={data.lessons.draft} />
                  <Tally label="Approved" value={data.lessons.approved} />
                  <Tally label="Delivered" value={data.lessons.delivered} />
                  <Tally label="Periods" value={data.lessons.timetabled_periods} />
                </div>
              </Section>
            </div>

            <Section
              title="Classes taught"
              subtitle={chosen ? `${chosen.display_name} · ${chosen.auth_email}` : undefined}
            >
              {data.classes.length === 0 ? (
                <Empty>Nothing is assigned to this teacher yet.</Empty>
              ) : (
                <ul className={workspace.list}>
                  {data.classes.map((row) => (
                    <li key={`${row.grade_level}${row.class_section}`} className={styles.classRow}>
                      <UserFollow size={16} />
                      <span className={styles.className}>
                        {classAndSection(settings.school_level, row.grade_level, row.class_section)}
                      </span>
                      <span className={styles.classSubjects}>{row.subjects.join(', ')}</span>
                      <span className={styles.subjectStat}>
                        {row.students} student{row.students === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {isAdmin && (
                <div className={styles.assign}>
                  <p className={styles.assignNote}>
                    Assign a class. Until a teacher has one, their marks cannot be attributed to them.
                  </p>
                  <div className={styles.assignFields}>
                    <TextInput
                      id="assign-subject"
                      className={styles.fieldSubject}
                      labelText="Subject"
                      size="sm"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                    <TextInput
                      id="assign-grade"
                      className={styles.fieldNarrow}
                      labelText="Grade"
                      size="sm"
                      inputMode="numeric"
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(e.target.value)}
                    />
                    <TextInput
                      id="assign-section"
                      className={styles.fieldNarrow}
                      labelText="Section"
                      size="sm"
                      value={classSection}
                      onChange={(e) => setClassSection(e.target.value)}
                    />
                    <Select
                      id="assign-term"
                      className={styles.fieldTerm}
                      labelText="Term"
                      size="sm"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                    >
                      {TERMS.map((t) => (
                        <SelectItem key={t} value={t} text={t} />
                      ))}
                    </Select>
                    <TextInput
                      id="assign-year"
                      className={styles.fieldYear}
                      labelText="Year"
                      size="sm"
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                    />
                    <Button
                      kind="primary"
                      size="sm"
                      onClick={allocate}
                      disabled={saving || !subject.trim() || !gradeLevel.trim() || !classSection.trim()}
                    >
                      {saving ? 'Assigning…' : 'Assign'}
                    </Button>
                  </div>
                </div>
              )}
            </Section>
          </>
        )}

        {!loading && !data && !error && <Empty>No teaching staff to report on yet.</Empty>}
      </div>
    </div>
  );
};

export default TeacherPerformance;
