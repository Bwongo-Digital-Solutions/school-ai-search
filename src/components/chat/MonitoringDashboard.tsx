import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, ClipboardList, DoorOpen, Loader2,
  LogIn, LogOut, MapPin, RefreshCw, ShieldCheck, UtensilsCrossed, XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, formatDateTime, todayIso } from '@/lib/format';
import StatTile from '@/components/common/StatTile';

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
  icon: React.ElementType;
  children: React.ReactNode;
}> = ({ title, subtitle, icon: Icon, children }) => (
  <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2">
        <Icon className="w-4 h-4 text-indigo-500" />
        {title}
      </h3>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-4 py-6 text-xs text-gray-400 text-center">{children}</p>
);

const Initials: React.FC<{ name: string }> = ({ name }) => (
  <span className="w-7 h-7 shrink-0 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold flex items-center justify-center">
    {name.split(/\s+/).map((part) => part[0] || '').slice(0, 2).join('').toUpperCase()}
  </span>
);

const MonitoringDashboard: React.FC = () => {
  const [date, setDate] = useState(todayIso());
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
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-indigo-500" />
              Monitoring
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Gate movements, exam clearance and the day&apos;s registers
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="px-3 py-1.5 rounded-md text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            />
            <button
              onClick={() => load(date)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-800 disabled:opacity-50"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading monitoring data…
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Signed out" value={data.gate.counts.out} icon={LogOut} />
              <StatTile label="Signed in" value={data.gate.counts.in} icon={LogIn} tone="success" />
              <StatTile
                label="Turned back"
                value={data.gate.counts.declined}
                icon={XCircle}
                tone={data.gate.counts.declined > 0 ? 'danger' : 'default'}
              />
              <StatTile
                label="Off premises now"
                value={data.off_premises.length}
                icon={MapPin}
                tone={data.off_premises.length > 0 ? 'warning' : 'default'}
              />
            </div>

            {/* Who is out right now is the one thing here that is not about a date — it is a
                headcount question, and a stale one is worse than none. */}
            <Section
              title="Off the premises right now"
              subtitle="Signed out and not yet signed back in, whichever day they left"
              icon={MapPin}
            >
              {data.off_premises.length === 0
                ? <Empty>Every student is accounted for on the premises.</Empty>
                : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.off_premises.map((student) => (
                      <li key={student.student_number} className="px-4 py-3 flex items-center gap-3">
                        <Initials name={student.full_name} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{student.full_name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {student.student_number}
                            {student.destination ? ` · ${student.destination}` : ''}
                            {student.authorised_by ? ` · allowed by ${student.authorised_by}` : ''}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          since {formatDateTime(student.since)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section
              title="Gate movements"
              subtitle={`${data.gate.counts.total} recorded on ${formatDate(data.date)}`}
              icon={ArrowLeftRight}
            >
              {data.gate.movements.length === 0
                ? <Empty>Nobody passed the gate on this day.</Empty>
                : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.gate.movements.map((movement) => {
                      const declined = movement.decision === 'declined';
                      const Icon = declined ? XCircle : movement.direction === 'out' ? LogOut : LogIn;
                      return (
                        <li key={movement.id} className="px-4 py-3 flex items-center gap-3">
                          <Icon className={`w-4 h-4 shrink-0 ${
                            declined ? 'text-red-500'
                              : movement.direction === 'out' ? 'text-amber-500' : 'text-emerald-500'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                              {movement.full_name}
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                                {movement.direction}
                              </span>
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {movement.student_number}
                              {movement.authorised_by ? ` · allowed by ${movement.authorised_by}` : ''}
                              {movement.destination ? ` · ${movement.destination}` : ''}
                              {movement.note ? ` · ${movement.note}` : ''}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatDateTime(movement.recorded_at)}
                          </span>
                          {declined && (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                              Declined
                            </span>
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
              icon={DoorOpen}
            >
              {data.gate.active_permissions.length === 0
                ? <Empty>No permission slips are outstanding.</Empty>
                : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.gate.active_permissions.map((permission) => (
                      <li key={permission.id} className="px-4 py-3 flex items-center gap-3">
                        <Initials name={permission.full_name} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                            {permission.full_name}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {permission.reason} · {permission.destination} · allowed by {permission.granted_by}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          {permission.expected_return
                            ? `back by ${formatDate(permission.expected_return)}`
                            : formatDateTime(permission.granted_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section
                title="Exam clearance"
                subtitle={`${data.exams.active_clearances} active · ${data.exams.admitted} admitted · ${data.exams.rejected} turned away`}
                icon={ShieldCheck}
              >
                {data.exams.admissions.length === 0 && data.exams.clearances.length === 0
                  ? <Empty>No clearance has been granted or checked yet.</Empty>
                  : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {data.exams.admissions.slice(0, 8).map((admission) => (
                        <li key={admission.id} className="px-4 py-3 flex items-center gap-3">
                          {admission.decision === 'approved'
                            ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                            : <XCircle className="w-4 h-4 shrink-0 text-red-500" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                              {admission.full_name}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {admission.decision === 'approved' ? 'Admitted' : 'Turned away'}
                              {admission.note ? ` · ${admission.note}` : ''}
                              {admission.recorded_by ? ` · ${admission.recorded_by}` : ''}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatDateTime(admission.recorded_at)}
                          </span>
                        </li>
                      ))}
                      {data.exams.clearances.filter((c) => c.status === 'active').slice(0, 6).map((clearance) => (
                        <li key={clearance.id} className="px-4 py-3 flex items-center gap-3">
                          <ShieldCheck className="w-4 h-4 shrink-0 text-indigo-500" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                              {clearance.full_name}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              Cleared by {clearance.granted_by}
                              {clearance.note ? ` · ${clearance.note}` : ''}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatDate(clearance.granted_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </Section>

              <Section
                title="Register"
                subtitle={`${data.attendance.marked} marked on ${formatDate(data.attendance.date)}`}
                icon={ClipboardList}
              >
                <div className="px-4 py-3 grid grid-cols-4 gap-2 border-b border-gray-100 dark:border-gray-700">
                  {([
                    ['Present', data.attendance.present],
                    ['Absent', data.attendance.absent],
                    ['Late', data.attendance.late],
                    ['Excused', data.attendance.excused],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="text-center">
                      <p className="text-lg font-bold text-gray-800 dark:text-white">{value}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {data.attendance.by_class.length === 0
                  ? <Empty>No register has been called on this day.</Empty>
                  : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {data.attendance.by_class.map((row) => (
                        <li
                          key={`${row.grade_level}-${row.class_section}`}
                          className="px-4 py-2.5 flex items-center justify-between gap-3"
                        >
                          <span className="text-sm text-gray-700 dark:text-gray-200">
                            Grade {row.grade_level} · {row.class_section}
                          </span>
                          <span className="text-xs text-gray-400">
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
              icon={UtensilsCrossed}
            >
              <div className="px-4 py-4 grid grid-cols-3 gap-3">
                {([
                  ['Breakfast', data.meals.breakfast],
                  ['Lunch', data.meals.lunch],
                  ['Supper', data.meals.supper],
                ] as const).map(([label, value]) => (
                  <div key={label} className="text-center">
                    <p className="text-lg font-bold text-gray-800 dark:text-white">{value}</p>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

export default MonitoringDashboard;
