import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  DatePicker,
  DatePickerInput,
  InlineLoading,
  InlineNotification,
  Tab,
  TabList,
  Tabs,
  Tag,
} from '@carbon/react';
import {
  CheckmarkFilled,
  Close,
  Education,
  Exit,
  ListChecked,
  Location,
  Login,
  Renew,
  Security,
} from '@carbon/react/icons';
import { supabase } from '@/lib/supabase';
import { formatDate, formatDateTime, todayIso } from '@/lib/format';
import { classAndSection } from '@/lib/classLevels';
import { CardHeader, PageHeader, StatRow, StatTile, WidgetCard } from '@/components/common';
import TeacherPerformance from './TeacherPerformance';
import styles from './workspace.module.scss';
import { useSettings } from '@/contexts/SettingsContext';

/* The shapes returned by POST /api/functions/monitoring. Everything is scoped to one day
   except off_premises, which is resolved over a rolling window — a student who left
   yesterday and has not come back is precisely what this screen exists to surface. */
interface NamedStudent {
  student_number: string;
  full_name: string;
  grade_level?: number;
  class_section?: string;
}

interface Movement extends NamedStudent {
  id: string;
  direction: 'out' | 'in';
  decision: 'approved' | 'declined';
  authorised_by: string;
  destination: string;
  note: string;
  recorded_by: string;
  recorded_at: string;
}

interface Permission {
  id: string;
  reason: string;
  destination: string;
  granted_by: string;
  granted_at: string;
  expected_return: string | null;
  student_number: string;
  full_name: string;
}

interface Clearance {
  id: string;
  status: 'active' | 'revoked';
  note: string;
  granted_by: string;
  granted_at: string;
  student_number: string;
  full_name: string;
}

interface Admission extends NamedStudent {
  id: string;
  decision: 'approved' | 'rejected';
  note: string;
  recorded_by: string;
  recorded_at: string;
}

interface ClassTally {
  grade_level: number;
  class_section: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

interface Monitoring {
  date: string;
  gate: {
    counts: { out: number; in: number; declined: number; total: number };
    movements: Movement[];
    active_permissions: Permission[];
  };
  off_premises: (NamedStudent & { since: string; destination: string; authorised_by: string })[];
  exams: {
    active_clearances: number;
    clearances: Clearance[];
    admissions: Admission[];
    admitted: number;
    rejected: number;
  };
  attendance: {
    date: string; marked: number; present: number; absent: number;
    late: number; excused: number; by_class: ClassTally[];
  };
  meals: { date: string; breakfast: number; lunch: number; supper: number; served: number };
}

const Section: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => (
  <WidgetCard>
    <CardHeader title={title}>{subtitle && <span className={styles.note}>{subtitle}</span>}</CardHeader>
    {children}
  </WidgetCard>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className={styles.empty}>{children}</p>
);

/** Two letters where a photograph would be, so a long list can still be scanned by name. */
const Initials: React.FC<{ name: string }> = ({ name }) => (
  <span className={styles.initials}>
    {name.split(/\s+/).map((part) => part[0] || '').slice(0, 2).join('').toUpperCase()}
  </span>
);

/** A count with its label under it, for the rows of tallies on the register and meals cards. */
const Tally: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className={styles.tallyItem}>
    <p className={styles.tallyValue}>{value}</p>
    <p className={styles.tallyLabel}>{label}</p>
  </div>
);

/**
 * The two things an administrator monitors: what happened today, and how the teaching is going.
 *
 * Teacher performance used to sit under Teaching, beside the lesson planner. It belongs here: it is
 * a report *about* teachers rather than a tool *for* them, and its audience is the same person who
 * reads the gate log and the register.
 */
const SECTIONS = [
  { key: 'today', label: 'Today', icon: ListChecked },
  { key: 'teaching', label: 'Teacher performance', icon: Education },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const MonitoringDashboard: React.FC = () => {
  const [section, setSection] = useState<SectionKey>('today');
  const [date, setDate] = useState(todayIso());
  const { settings } = useSettings();
  const [data, setData] = useState<Monitoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (forDate: string) => {
    setLoading(true);
    setError('');
    const { data: result, error: failure } = await supabase.functions.invoke<Monitoring>(
      'monitoring', { body: { date: forDate } },
    );
    if (failure) {
      setError(failure.message || 'Could not load the monitoring data.');
      setData(null);
    } else {
      setData(result ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  return (
    <div className={styles.screen}>
      <PageHeader title="Monitoring" illustration={<ListChecked size={32} />}>
        {section === 'today' && (
          <>
        <DatePicker
          datePickerType="single"
          dateFormat="Y-m-d"
          value={date}
          onChange={(dates) => {
            const [picked] = dates;
            if (picked) setDate(picked.toISOString().slice(0, 10));
          }}
        >
          <DatePickerInput
            id="monitoring-date"
            labelText="Day"
            hideLabel
            placeholder="yyyy-mm-dd"
            size="sm"
          />
        </DatePicker>
            <Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => load(date)} disabled={loading}>
              Refresh
            </Button>
          </>
        )}
      </PageHeader>

      <div className={styles.controls}>
        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex(entry => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="Monitoring sections" contained>
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>
                  {label}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      {section === 'teaching' && <TeacherPerformance embedded />}

      {section === 'today' && (
        <div className={`${styles.body} ${styles.bodyTop}`}>
        {error && (
          <InlineNotification
            kind="error"
            title="Could not load the monitoring data"
            subtitle={error}
            onCloseButtonClick={() => setError('')}
            lowContrast
          />
        )}

        {loading && !data && (
          <div className={styles.loading}>
            <InlineLoading description="Loading monitoring data…" />
          </div>
        )}

        {data && (
          <>
            <StatRow>
              <StatTile label="Signed out" value={data.gate.counts.out} icon={Exit} />
              <StatTile label="Signed in" value={data.gate.counts.in} icon={Login} tone="success" />
              <StatTile
                label="Turned back"
                value={data.gate.counts.declined}
                icon={Close}
                tone={data.gate.counts.declined > 0 ? 'danger' : 'default'}
              />
              <StatTile
                label="Off premises now"
                value={data.off_premises.length}
                icon={Location}
                tone={data.off_premises.length > 0 ? 'warning' : 'default'}
              />
            </StatRow>

            {/* Who is out right now is the one thing here that is not about a date — it is a
                headcount question, and a stale answer is worse than none. */}
            <Section
              title="Off the premises right now"
              subtitle="Signed out and not yet back, whichever day they left"
            >
              {data.off_premises.length === 0 ? (
                <Empty>Every student is accounted for on the premises.</Empty>
              ) : (
                <ul className={styles.list}>
                  {data.off_premises.map((student) => (
                    <li key={student.student_number} className={styles.entry}>
                      <Initials name={student.full_name} />
                      <div className={styles.entryMain}>
                        <p className={styles.entryTitle}>{student.full_name}</p>
                        <p className={styles.entrySub}>
                          {student.student_number}
                          {student.destination ? ` · ${student.destination}` : ''}
                          {student.authorised_by ? ` · allowed by ${student.authorised_by}` : ''}
                        </p>
                      </div>
                      <span className={styles.entryTime}>since {formatDateTime(student.since)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="Gate movements"
              subtitle={`${data.gate.counts.total} recorded on ${formatDate(data.date)}`}
            >
              {data.gate.movements.length === 0 ? (
                <Empty>Nobody passed the gate on this day.</Empty>
              ) : (
                <ul className={styles.list}>
                  {data.gate.movements.map((movement) => {
                    const declined = movement.decision === 'declined';
                    const Icon = declined ? Close : movement.direction === 'out' ? Exit : Login;
                    const tone = declined
                      ? styles.iconDeclined
                      : movement.direction === 'out'
                        ? styles.iconOut
                        : styles.iconIn;
                    return (
                      <li key={movement.id} className={styles.entry}>
                        <Icon size={16} className={tone} />
                        <div className={styles.entryMain}>
                          <p className={styles.entryTitle}>
                            {movement.full_name}
                            <span className={styles.entryTag}>{movement.direction}</span>
                          </p>
                          <p className={styles.entrySub}>
                            {movement.student_number}
                            {movement.authorised_by ? ` · allowed by ${movement.authorised_by}` : ''}
                            {movement.destination ? ` · ${movement.destination}` : ''}
                            {movement.note ? ` · ${movement.note}` : ''}
                          </p>
                        </div>
                        <span className={styles.entryTime}>{formatDateTime(movement.recorded_at)}</span>
                        {declined && (
                          <Tag type="red" size="sm">
                            Declined
                          </Tag>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section
              title="Gate passes awaiting the gate"
              subtitle="Granted and not yet used, declined or cancelled"
            >
              {data.gate.active_permissions.length === 0 ? (
                <Empty>No permission slips are outstanding.</Empty>
              ) : (
                <ul className={styles.list}>
                  {data.gate.active_permissions.map((permission) => (
                    <li key={permission.id} className={styles.entry}>
                      <Initials name={permission.full_name} />
                      <div className={styles.entryMain}>
                        <p className={styles.entryTitle}>{permission.full_name}</p>
                        <p className={styles.entrySub}>
                          {permission.reason} · {permission.destination} · allowed by{' '}
                          {permission.granted_by}
                        </p>
                      </div>
                      <span className={styles.entryTime}>
                        {permission.expected_return
                          ? `back by ${formatDate(permission.expected_return)}`
                          : formatDateTime(permission.granted_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div className={styles.grid2}>
              <Section
                title="Exam clearance"
                subtitle={`${data.exams.active_clearances} active · ${data.exams.admitted} admitted · ${data.exams.rejected} turned away`}
              >
                {data.exams.admissions.length === 0 && data.exams.clearances.length === 0 ? (
                  <Empty>No clearance has been granted or checked yet.</Empty>
                ) : (
                  <ul className={styles.list}>
                    {data.exams.admissions.slice(0, 8).map((admission) => (
                      <li key={admission.id} className={styles.entry}>
                        {admission.decision === 'approved' ? (
                          <CheckmarkFilled size={16} className={styles.iconIn} />
                        ) : (
                          <Close size={16} className={styles.iconDeclined} />
                        )}
                        <div className={styles.entryMain}>
                          <p className={styles.entryTitle}>{admission.full_name}</p>
                          <p className={styles.entrySub}>
                            {admission.decision === 'approved' ? 'Admitted' : 'Turned away'}
                            {admission.note ? ` · ${admission.note}` : ''}
                            {admission.recorded_by ? ` · ${admission.recorded_by}` : ''}
                          </p>
                        </div>
                        <span className={styles.entryTime}>{formatDateTime(admission.recorded_at)}</span>
                      </li>
                    ))}
                    {data.exams.clearances
                      .filter((c) => c.status === 'active')
                      .slice(0, 6)
                      .map((clearance) => (
                        <li key={clearance.id} className={styles.entry}>
                          <Security size={16} className={styles.iconNeutral} />
                          <div className={styles.entryMain}>
                            <p className={styles.entryTitle}>{clearance.full_name}</p>
                            <p className={styles.entrySub}>
                              Cleared by {clearance.granted_by}
                              {clearance.note ? ` · ${clearance.note}` : ''}
                            </p>
                          </div>
                          <span className={styles.entryTime}>{formatDate(clearance.granted_at)}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </Section>

              <Section
                title="Register"
                subtitle={`${data.attendance.marked} marked on ${formatDate(data.attendance.date)}`}
              >
                <div className={styles.tally}>
                  <Tally label="Present" value={data.attendance.present} />
                  <Tally label="Absent" value={data.attendance.absent} />
                  <Tally label="Late" value={data.attendance.late} />
                  <Tally label="Excused" value={data.attendance.excused} />
                </div>
                {data.attendance.by_class.length === 0 ? (
                  <Empty>No register has been called on this day.</Empty>
                ) : (
                  <ul className={styles.list}>
                    {data.attendance.by_class.map((row) => (
                      <li key={`${row.grade_level}-${row.class_section}`} className={styles.entry}>
                        <span className={styles.entryMain}>
                          <span className={styles.entryTitle}>
                            {classAndSection(settings.school_level, row.grade_level, row.class_section)}
                          </span>
                        </span>
                        <span className={styles.entryTime}>
                          {row.present} present · {row.absent} absent
                          {row.late ? ` · ${row.late} late` : ''}
                          {row.excused ? ` · ${row.excused} excused` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            <Section
              title="Meals served"
              subtitle={`${data.meals.served} servings on ${formatDate(data.meals.date)}`}
            >
              <div className={styles.tally}>
                <Tally label="Breakfast" value={data.meals.breakfast} />
                <Tally label="Lunch" value={data.meals.lunch} />
                <Tally label="Supper" value={data.meals.supper} />
              </div>
            </Section>
          </>
        )}
        </div>
      )}
    </div>
  );
};

export default MonitoringDashboard;
