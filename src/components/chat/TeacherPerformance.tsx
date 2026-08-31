import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  RefreshCw,
  UserCheck,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { academicYear, TERMS } from '@/lib/format';
import StatTile from '@/components/common/StatTile';

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
  title, subtitle, icon: Icon, right, children,
}: {
  title: string; subtitle?: string; icon: React.ElementType;
  right?: React.ReactNode; children: React.ReactNode;
}) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
      <Icon className="w-4 h-4 text-indigo-500" />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{title}</h3>
        {subtitle ? <p className="text-xs text-gray-400">{subtitle}</p> : null}
      </div>
      {right}
    </div>
    {children}
  </div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="px-4 py-6 text-xs text-gray-400 text-center">{children}</p>
);

/** Says plainly where a figure came from, so an estimate is never read as a record. */
const SourceNote = ({ source }: { source: Source }) => {
  if (source === 'allocated') return null;
  const text = source === 'inferred'
    ? 'Estimated: no classes are assigned to this teacher, so this counts the registers they '
      + 'called rather than their own students.'
    : 'Nothing is assigned to this teacher, so no marks can be attributed to them.';
  return (
    <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/40 flex items-start gap-2">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
      <p className="text-xs text-amber-700 dark:text-amber-300">{text}</p>
    </div>
  );
};

/** A pass/fail bar. One row per subject, weakest first, so the problem subject is at the top. */
const PassBar = ({ passed, failed }: { passed: number; failed: number }) => {
  const total = passed + failed;
  if (!total) return null;
  const pct = (passed / total) * 100;
  return (
    <div className="h-2 rounded-full bg-red-200 dark:bg-red-900/50 overflow-hidden" title={`${passed} passed, ${failed} failed`}>
      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </div>
  );
};

const TeacherPerformance: React.FC = () => {
  const { isAdmin } = useAuth();

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
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-indigo-500" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white">Teacher performance</h2>
            <p className="text-xs text-gray-400">
              Lessons, attendance and results for the classes a teacher is assigned to.
            </p>
          </div>
          <button
            onClick={() => loadSummary(selected, passMark)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">Teacher</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!isAdmin}
              className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white disabled:opacity-60"
            >
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}{row.allocation_rows ? '' : ' — nothing assigned'}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-gray-500">
            <span className="block mb-1">Pass mark</span>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={100} step={5}
                value={passMark}
                onChange={(e) => setPassMark(Number(e.target.value))}
                className="w-32"
              />
              <span className="text-sm font-semibold text-gray-800 dark:text-white w-10">{passMark}%</span>
            </div>
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {error ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {notice}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading these figures…
          </div>
        ) : null}

        {data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Lessons planned" value={data.lessons.total} icon={ClipboardList} />
              <StatTile label="Delivered" value={data.lessons.delivered} icon={CheckCircle2} tone="success" />
              <StatTile
                label="Attendance"
                value={data.attendance.present_rate === null ? '—' : `${data.attendance.present_rate}%`}
                icon={CalendarCheck}
                tone={data.attendance.present_rate !== null && data.attendance.present_rate < 80 ? 'warning' : 'default'}
              />
              <StatTile
                label={`Passing at ${data.pass_mark}%`}
                value={data.results.pass_rate === null ? '—' : `${data.results.pass_rate}%`}
                icon={GraduationCap}
                tone={data.results.pass_rate !== null && data.results.pass_rate < 50 ? 'danger' : 'success'}
              />
            </div>

            <Section
              title="Results"
              subtitle={`${data.results.entries} mark(s) across this teacher's subjects`}
              icon={GraduationCap}
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
                  <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                    {[
                      ['Passed', data.results.passed, 'text-emerald-600'],
                      ['Failed', data.results.failed, 'text-red-600'],
                      ['Average', `${data.results.average_percent}%`, 'text-gray-800 dark:text-white'],
                    ].map(([label, value, tone]) => (
                      <div key={String(label)}>
                        <p className={`text-lg font-bold ${tone}`}>{value}</p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.results.by_subject.map((row) => (
                      <li key={row.subject} className="px-4 py-3">
                        <div className="flex items-center gap-3 mb-1.5">
                          <span className="flex-1 text-sm text-gray-800 dark:text-white">{row.subject}</span>
                          <span className="text-xs text-gray-400">{row.average_percent}% avg</span>
                          <span className="text-xs font-medium text-emerald-600">{row.passed}</span>
                          <span className="text-xs text-gray-300">/</span>
                          <span className="text-xs font-medium text-red-600">{row.failed}</span>
                        </div>
                        <PassBar passed={row.passed} failed={row.failed} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Attendance" subtitle="Registers covering this teacher's students" icon={CalendarCheck}>
                <SourceNote source={data.attendance.source} />
                {data.attendance.total === 0 ? (
                  <Empty>No registers have been called for these students yet.</Empty>
                ) : (
                  <div className="grid grid-cols-4 gap-2 px-4 py-4">
                    {[
                      ['Present', data.attendance.present],
                      ['Absent', data.attendance.absent],
                      ['Late', data.attendance.late],
                      ['Excused', data.attendance.excused],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <p className="text-lg font-bold text-gray-800 dark:text-white">{value}</p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Lessons" subtitle="Plans written and periods timetabled" icon={BookOpen}>
                <div className="grid grid-cols-4 gap-2 px-4 py-4">
                  {[
                    ['Draft', data.lessons.draft],
                    ['Approved', data.lessons.approved],
                    ['Delivered', data.lessons.delivered],
                    ['Periods', data.lessons.timetabled_periods],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">{value}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            <Section
              title="Classes taught"
              subtitle={chosen ? `${chosen.display_name} · ${chosen.auth_email}` : undefined}
              icon={Users}
            >
              {data.classes.length === 0 ? (
                <Empty>Nothing is assigned to this teacher yet.</Empty>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.classes.map((row) => (
                    <li key={`${row.grade_level}${row.class_section}`} className="px-4 py-3 flex items-center gap-3">
                      <UserCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span className="text-sm text-gray-800 dark:text-white">
                        Grade {row.grade_level}{row.class_section}
                      </span>
                      <span className="flex-1 text-xs text-gray-400">{row.subjects.join(', ')}</span>
                      <span className="text-xs text-gray-500">{row.students} student(s)</span>
                    </li>
                  ))}
                </ul>
              )}

              {isAdmin ? (
                <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30">
                  <p className="text-xs text-gray-500 mb-2">
                    Assign a class. Until a teacher has one, their marks cannot be attributed to them.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Subject"
                      className="px-2 py-1.5 w-36 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    />
                    <input
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(e.target.value)}
                      placeholder="Grade"
                      inputMode="numeric"
                      className="px-2 py-1.5 w-20 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    />
                    <input
                      value={classSection}
                      onChange={(e) => setClassSection(e.target.value)}
                      placeholder="Section"
                      className="px-2 py-1.5 w-20 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    />
                    <select
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    >
                      {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      placeholder="Year"
                      className="px-2 py-1.5 w-24 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    />
                    <button
                      onClick={allocate}
                      disabled={saving || !subject.trim() || !gradeLevel.trim() || !classSection.trim()}
                      className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium disabled:opacity-50"
                    >
                      {saving ? 'Assigning…' : 'Assign'}
                    </button>
                  </div>
                </div>
              ) : null}
            </Section>
          </>
        ) : null}

        {!loading && !data && !error ? (
          <Empty>No teaching staff to report on yet.</Empty>
        ) : null}
      </div>
    </div>
  );
};

export default TeacherPerformance;
