import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  Loader2,
  RefreshCw,
  Repeat2,
  School,
  Shield,
  UserCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { callFees } from '@/lib/fees';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Student } from '@/types/chat';

type SectionKey = 'admissions' | 'attendance' | 'academic' | 'discipline' | 'allocation' | 'lifecycle';
type FieldValue = string | number | boolean;
type SchoolRecord = Record<string, unknown> & { id?: string; student_id?: string };

const today = () => new Date().toISOString().split('T')[0];
const academicYear = () => {
  const year = new Date().getFullYear();
  return `${year}/${year + 1}`;
};

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');
const studentName = (student?: Student) => student ? `${student.first_name} ${student.last_name}` : 'Unknown student';
const ADMISSIONS_PAGE_SIZE = 8;

const emptyAdmission = {
  application_number: '',
  applicant_first_name: '',
  applicant_last_name: '',
  grade_level: 9,
  status: 'submitted',
  documents: '',
  notes: '',
};

const emptyAttendance = {
  attendance_date: today(),
  status: 'present',
  reason: '',
  marked_by: '',
  notified_parent: false,
};

const emptyAcademic = {
  score: 0,
  max_score: 100,
  grade: '',
  remarks: '',
  rank: 0,
};

const emptyDiscipline = {
  incident_date: today(),
  category: 'Conduct',
  severity: 'minor',
  description: '',
  action_taken: '',
  reported_by: '',
  guardian_notified: false,
  status: 'open',
};

const emptyAllocation = {
  grade_level: 9,
  section_name: 'A',
  stream: '',
  room: '',
  academic_year: academicYear(),
  capacity: 40,
};

const emptyLifecycle = {
  action: 'promotion',
  to_grade_level: 10,
  to_class_section: 'A',
  effective_date: today(),
  decision: 'promoted',
  destination_school: '',
  reason: '',
  notes: '',
  approved_by: '',
};

const StatTile = ({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ElementType }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3">
    <div className="flex items-center justify-between">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
      <Icon className="w-4 h-4 text-indigo-500" />
    </div>
    <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{value}</p>
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  options,
  min,
  max,
  step,
}: {
  label: string;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  type?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}) => (
  <label className="block">
    <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</span>
    {options ? (
      <select
        value={String(value ?? '')}
        onChange={event => onChange(event.target.value)}
        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    ) : type === 'textarea' ? (
      <textarea
        value={String(value ?? '')}
        onChange={event => onChange(event.target.value)}
        rows={3}
        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none"
      />
    ) : type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={event => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
    ) : (
      <input
        type={type}
        value={String(value ?? '')}
        min={min}
        max={max}
        step={step}
        onChange={event => onChange(type === 'number' ? Number(event.target.value) : event.target.value)}
        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
      />
    )}
  </label>
);

const StudentRecordsWorkspace: React.FC = () => {
  const { students, refreshStudents } = useChatContext();
  const { isAuthenticated, isAdmin, isSupportStaff, user, logAudit } = useAuth();
  const [activeSection, setActiveSection] = useState<SectionKey>('admissions');
  const [admissionPane, setAdmissionPane] = useState('form');
  const [admissionPage, setAdmissionPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<Record<string, SchoolRecord[]>>({});
  const [admission, setAdmission] = useState(emptyAdmission);
  const [attendance, setAttendance] = useState(emptyAttendance);
  const [academic, setAcademic] = useState(emptyAcademic);
  const [discipline, setDiscipline] = useState(emptyDiscipline);
  const [allocation, setAllocation] = useState(emptyAllocation);
  const [lifecycle, setLifecycle] = useState(emptyLifecycle);

  const selectedStudent = students.find(student => student.id === selectedStudentId) || students[0];
  const canEdit = isAdmin;

  useEffect(() => {
    if (!selectedStudentId && students[0]) {
      setSelectedStudentId(students[0].id);
      setAdmission(prev => ({
        ...prev,
        applicant_first_name: students[0].first_name,
        applicant_last_name: students[0].last_name,
        grade_level: students[0].grade_level,
      }));
      setAllocation(prev => ({
        ...prev,
        grade_level: students[0].grade_level,
        section_name: students[0].class_section || 'A',
      }));
      setLifecycle(prev => ({
        ...prev,
        to_grade_level: students[0].grade_level + 1,
        to_class_section: students[0].class_section || 'A',
      }));
    }
  }, [students, selectedStudentId]);

  useEffect(() => {
    const student = selectedStudent;
    if (!student) return;
    setAdmission(prev => ({
      ...prev,
      applicant_first_name: student.first_name,
      applicant_last_name: student.last_name,
      grade_level: student.grade_level,
    }));
    setAllocation(prev => ({
      ...prev,
      grade_level: student.grade_level,
      section_name: student.class_section || 'A',
    }));
    setLifecycle(prev => ({
      ...prev,
      to_grade_level: student.grade_level + 1,
      to_class_section: student.class_section || 'A',
    }));
  }, [selectedStudent]);

  const loadRecords = useCallback(async () => {
    if (isSupportStaff) return;
    setLoading(true);
    const tables = [
      ['admissions', 'submitted_at'],
      ['attendance_records', 'attendance_date'],
      ['attendance_alerts', 'sent_at'],
      ['gradebook_entries', 'created_at'],
      ['discipline_records', 'incident_date'],
      ['classes', 'academic_year'],
      ['student_promotions', 'effective_date'],
      ['student_transfers', 'effective_date'],
    ] as const;

    const loaded: Record<string, SchoolRecord[]> = {};
    for (const [table, orderField] of tables) {
      const { data, error } = await supabase.from<SchoolRecord[]>(table).select('*').order(orderField, { ascending: false }).limit(100);
      if (error) {
        console.error(`Failed to load ${table}:`, error);
        loaded[table] = [];
      } else {
        loaded[table] = data || [];
      }
    }
    setRecords(loaded);
    setLoading(false);
  }, [isSupportStaff]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const selectedStudentRecords = useMemo(() => {
    const id = selectedStudent?.id;
    return {
      admissions: (records.admissions || []).filter(row => row.student_id === id),
      attendance: (records.attendance_records || []).filter(row => row.student_id === id),
      academic: (records.gradebook_entries || []).filter(row => row.student_id === id),
      discipline: (records.discipline_records || []).filter(row => row.student_id === id),
      promotions: (records.student_promotions || []).filter(row => row.student_id === id),
      transfers: (records.student_transfers || []).filter(row => row.student_id === id),
    };
  }, [records, selectedStudent?.id]);

  const admissionRows = useMemo(() => records.admissions || [], [records.admissions]);
  const admissionPageCount = Math.max(1, Math.ceil(admissionRows.length / ADMISSIONS_PAGE_SIZE));
  const paginatedAdmissions = admissionRows.slice(
    (admissionPage - 1) * ADMISSIONS_PAGE_SIZE,
    admissionPage * ADMISSIONS_PAGE_SIZE,
  );

  useEffect(() => {
    setAdmissionPage(1);
  }, [records.admissions?.length]);

  useEffect(() => {
    setAdmissionPage(page => Math.min(page, admissionPageCount));
  }, [admissionPageCount]);

  const parseDocuments = (value: string) =>
    value.split(',').map(item => item.trim()).filter(Boolean).map(name => ({ name, status: 'received' }));

  const saveRecord = async (label: string, handler: () => Promise<void>) => {
    if (!canEdit || !selectedStudent) return;
    setSaving(true);
    try {
      await handler();
      await loadRecords();
      await refreshStudents();
    } catch (error) {
      console.error(`${label} failed:`, error);
      alert(`${label} failed: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const resetAdmissionForm = () =>
    setAdmission({ ...emptyAdmission, applicant_first_name: selectedStudent.first_name, applicant_last_name: selectedStudent.last_name, grade_level: selectedStudent.grade_level });

  // A student should not be admitted twice — warn if a live (non-rejected) admission already exists.
  const existingLiveAdmission = () =>
    (selectedStudentRecords.admissions || []).find(row => !['rejected', 'withdrawn'].includes(String(row.status)));

  const createAdmission = () => saveRecord('Admission registration', async () => {
    const dup = existingLiveAdmission();
    if (dup && !window.confirm(`${studentName(selectedStudent)} already has an admission (${dup.application_number}, ${dup.status}). Add another anyway?`)) {
      return;
    }
    const applicationNumber = admission.application_number.trim() || `APP-${Date.now()}`;
    const { error } = await supabase.from('admissions').insert({
      ...admission,
      application_number: applicationNumber,
      student_id: selectedStudent.id,
      documents: parseDocuments(admission.documents),
    });
    if (error) throw error;
    await logAudit('admission', selectedStudent.id, studentName(selectedStudent), { application_number: applicationNumber, status: admission.status });
    resetAdmissionForm();
  });

  // Admit a student and immediately bill tuition from the matching fee structure. The admin
  // confirms the amount (computed by a preview) before the invoice is raised.
  const admitAndBill = () => saveRecord('Admitting student', async () => {
    if (existingLiveAdmission() && !window.confirm(`${studentName(selectedStudent)} already has an admission. Admit and bill again?`)) {
      return;
    }
    const preview = await callFees<{ amount: number; currency: string; feeStructure: { name: string } }>(
      'bill_student',
      { studentId: selectedStudent.id, preview: true },
      user,
    );
    const ok = window.confirm(
      `Admit ${studentName(selectedStudent)} and bill ${preview.currency} ${Math.round(preview.amount).toLocaleString()} tuition (${preview.feeStructure.name})?`,
    );
    if (!ok) return;

    const applicationNumber = admission.application_number.trim() || `APP-${Date.now()}`;
    const { error } = await supabase.from('admissions').insert({
      ...admission,
      application_number: applicationNumber,
      status: 'admitted',
      student_id: selectedStudent.id,
      documents: parseDocuments(admission.documents),
    });
    if (error) throw error;

    const result = await callFees<{ amount: number; currency: string; alreadyBilled?: boolean; invoice?: { invoice_number: string } }>(
      'bill_student',
      { studentId: selectedStudent.id, onAdmission: true },
      user,
    );
    await logAudit('admission', selectedStudent.id, studentName(selectedStudent), { application_number: applicationNumber, status: 'admitted', billed: result.amount }, 'invoice');
    resetAdmissionForm();
    window.alert(
      result.alreadyBilled
        ? `${studentName(selectedStudent)} admitted. Tuition was already billed (${result.invoice?.invoice_number ?? ''}).`
        : `${studentName(selectedStudent)} admitted and billed ${result.currency} ${Math.round(result.amount).toLocaleString()}.`,
    );
  });

  const markAttendance = () => saveRecord('Attendance marking', async () => {
    // One record per student per day: update the existing record for this date instead of adding
    // a duplicate (the database also enforces this with a unique index).
    const existing = (selectedStudentRecords.attendance || []).find(
      row => String(row.attendance_date).slice(0, 10) === attendance.attendance_date,
    );
    const markedBy = attendance.marked_by || user?.display_name || '';
    let recordId = existing?.id as string | undefined;

    if (existing) {
      const { error } = await supabase.from('attendance_records').update({
        status: attendance.status,
        reason: attendance.reason,
        marked_by: markedBy,
        notified_parent: attendance.notified_parent,
      }).eq('id', existing.id as string);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from<SchoolRecord>('attendance_records').insert({
        ...attendance,
        student_id: selectedStudent.id,
        marked_by: markedBy,
      }).select('*').single();
      if (error) throw error;
      recordId = data?.id;
    }

    if (attendance.notified_parent && selectedStudent.parent_phone) {
      const alert = await supabase.from('attendance_alerts').insert({
        student_id: selectedStudent.id,
        attendance_record_id: recordId,
        channel: 'sms',
        recipient: selectedStudent.parent_phone,
        status: 'pending',
        message: `${studentName(selectedStudent)} was marked ${attendance.status} on ${attendance.attendance_date}.`,
      });
      if (alert.error) throw alert.error;
    }
    await logAudit('attendance', selectedStudent.id, studentName(selectedStudent), attendance);
    setAttendance(emptyAttendance);
  });

  const saveAcademic = () => saveRecord('Academic history update', async () => {
    const { error } = await supabase.from('gradebook_entries').insert({
      ...academic,
      student_id: selectedStudent.id,
      rank: academic.rank || null,
    });
    if (error) throw error;
    await logAudit('academic_history', selectedStudent.id, studentName(selectedStudent), academic);
    setAcademic(emptyAcademic);
  });

  const saveDiscipline = () => saveRecord('Discipline record', async () => {
    const { error } = await supabase.from('discipline_records').insert({
      ...discipline,
      student_id: selectedStudent.id,
      reported_by: discipline.reported_by || user?.display_name || '',
    });
    if (error) throw error;
    await logAudit('discipline', selectedStudent.id, studentName(selectedStudent), discipline);
    setDiscipline(emptyDiscipline);
  });

  const allocateClass = () => saveRecord('Class allocation', async () => {
    const classId = `class-${allocation.grade_level}-${allocation.section_name}-${allocation.academic_year}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = (records.classes || []).find(row => row.id === classId);
    if (!existing) {
      const created = await supabase.from('classes').insert({ ...allocation, id: classId });
      if (created.error) throw created.error;
    }
    const updated = await supabase.from('students').update({
      grade_level: allocation.grade_level,
      class_section: allocation.section_name,
      status: 'active',
      lifecycle_status: 'enrolled',
    }).eq('id', selectedStudent.id);
    if (updated.error) throw updated.error;
    await logAudit('class_allocation', selectedStudent.id, studentName(selectedStudent), allocation);
  });

  const saveLifecycle = () => saveRecord('Lifecycle update', async () => {
    if (lifecycle.action === 'promotion') {
      const created = await supabase.from('student_promotions').insert({
        student_id: selectedStudent.id,
        from_grade_level: selectedStudent.grade_level,
        from_class_section: selectedStudent.class_section,
        to_grade_level: lifecycle.to_grade_level,
        to_class_section: lifecycle.to_class_section,
        academic_year: academicYear(),
        effective_date: lifecycle.effective_date,
        decision: lifecycle.decision,
        notes: lifecycle.notes,
        approved_by: lifecycle.approved_by || user?.display_name || '',
      });
      if (created.error) throw created.error;
      const updated = await supabase.from('students').update({
        grade_level: lifecycle.to_grade_level,
        class_section: lifecycle.to_class_section,
        status: lifecycle.decision === 'graduated' ? 'graduated' : 'active',
        lifecycle_status: lifecycle.decision === 'graduated' ? 'graduated' : 'enrolled',
        graduation_date: lifecycle.decision === 'graduated' ? lifecycle.effective_date : null,
      }).eq('id', selectedStudent.id);
      if (updated.error) throw updated.error;
      await logAudit('promotion', selectedStudent.id, studentName(selectedStudent), lifecycle);
      return;
    }

    const movementType = lifecycle.action === 'withdrawal' ? 'withdrawal' : 'transfer';
    const created = await supabase.from('student_transfers').insert({
      student_id: selectedStudent.id,
      movement_type: movementType,
      effective_date: lifecycle.effective_date,
      destination_school: lifecycle.destination_school,
      reason: lifecycle.reason,
      documents: [],
      status: 'completed',
      processed_by: lifecycle.approved_by || user?.display_name || '',
    });
    if (created.error) throw created.error;
    const updated = await supabase.from('students').update({
      status: movementType === 'withdrawal' ? 'inactive' : 'transferred',
      lifecycle_status: movementType,
      transfer_date: lifecycle.effective_date,
      alumni_notes: lifecycle.reason,
    }).eq('id', selectedStudent.id);
    if (updated.error) throw updated.error;
    await logAudit(movementType, selectedStudent.id, studentName(selectedStudent), lifecycle);
  });

  const sections = [
    { key: 'admissions', label: 'Admissions', icon: FilePlus2 },
    { key: 'attendance', label: 'Attendance', icon: UserCheck },
    { key: 'academic', label: 'Academic', icon: BookOpen },
    { key: 'discipline', label: 'Discipline', icon: AlertTriangle },
    { key: 'allocation', label: 'Allocation', icon: School },
    { key: 'lifecycle', label: 'Lifecycle', icon: Repeat2 },
  ] as const;

  if (!isAuthenticated || isSupportStaff) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-8 text-center">
        <Shield className="w-10 h-10 text-indigo-500 mb-3" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
          {isSupportStaff ? 'Restricted to Teachers and Admins' : 'Authentication Required'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {isSupportStaff
            ? 'Support staff accounts can only view school fees payment status.'
            : 'Sign in to view student operational records.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-indigo-500" />
              Student Records
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Admissions, attendance, academic history, discipline, allocation, and lifecycle actions</p>
          </div>
          <button
            onClick={loadRecords}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-4">
          <StatTile label="Admissions" value={records.admissions?.length || 0} icon={FilePlus2} />
          <StatTile label="Attendance" value={records.attendance_records?.length || 0} icon={UserCheck} />
          <StatTile label="Academics" value={records.gradebook_entries?.length || 0} icon={BookOpen} />
          <StatTile label="Discipline" value={records.discipline_records?.length || 0} icon={AlertTriangle} />
          <StatTile label="Promotions" value={records.student_promotions?.length || 0} icon={GraduationCap} />
          <StatTile label="Movements" value={records.student_transfers?.length || 0} icon={Repeat2} />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-5">
          <aside className="space-y-4">
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-4">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Student</label>
              <select
                value={selectedStudent?.id || ''}
                onChange={event => setSelectedStudentId(event.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm"
              >
                {students.map(student => (
                  <option key={student.id} value={student.id}>{studentName(student)} - {student.student_id}</option>
                ))}
              </select>
              {selectedStudent && (
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  <p>Grade {selectedStudent.grade_level}-{selectedStudent.class_section}</p>
                  <p>Status: {selectedStudent.status}</p>
                  <p>Lifecycle: {selectedStudent.lifecycle_status || 'enrolled'}</p>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-2">
              {sections.map(section => (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                    activeSection === section.key
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <section.icon className="w-4 h-4" />
                  {section.label}
                </button>
              ))}
            </div>
          </aside>

          <main className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            {loading ? (
              <div className="h-72 flex items-center justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading records
              </div>
            ) : (
              <div className="p-5 space-y-5">
                {!canEdit && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-lg px-3 py-2">
                    <Shield className="w-4 h-4" />
                    Teacher accounts can view records. Administrator access is required to add or update records.
                  </div>
                )}

                {activeSection === 'admissions' && (
                  <>
                    <SectionTitle icon={FilePlus2} title="Student Registration / Admission" description="Record applications, then review the full admissions register." />
                    <Tabs value={admissionPane} onValueChange={setAdmissionPane} className="space-y-4">
                      <TabsList className="grid w-full max-w-md grid-cols-2">
                        <TabsTrigger value="form">Admission</TabsTrigger>
                        <TabsTrigger value="list">Admissions List</TabsTrigger>
                      </TabsList>
                      <TabsContent value="form" className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Field label="Application Number" value={admission.application_number} onChange={value => setAdmission(prev => ({ ...prev, application_number: value }))} />
                          <Field label="Status" value={admission.status} onChange={value => setAdmission(prev => ({ ...prev, status: value }))} options={[
                            { value: 'submitted', label: 'Submitted' }, { value: 'reviewing', label: 'Reviewing' }, { value: 'accepted', label: 'Accepted' }, { value: 'admitted', label: 'Admitted' }, { value: 'rejected', label: 'Rejected' }, { value: 'registered', label: 'Registered' },
                          ]} />
                          <Field label="Applicant First Name" value={admission.applicant_first_name} onChange={value => setAdmission(prev => ({ ...prev, applicant_first_name: value }))} />
                          <Field label="Applicant Last Name" value={admission.applicant_last_name} onChange={value => setAdmission(prev => ({ ...prev, applicant_last_name: value }))} />
                          <Field label="Grade Level" value={admission.grade_level} type="number" onChange={value => setAdmission(prev => ({ ...prev, grade_level: value }))} />
                          <Field label="Documents" value={admission.documents} onChange={value => setAdmission(prev => ({ ...prev, documents: value }))} />
                          <div className="md:col-span-2"><Field label="Notes" value={admission.notes} type="textarea" onChange={value => setAdmission(prev => ({ ...prev, notes: value }))} /></div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SaveButton disabled={!canEdit || saving} onClick={createAdmission} label="Save Admission" />
                          {isAdmin && (
                            <button
                              onClick={admitAndBill}
                              disabled={saving}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50"
                            >
                              <GraduationCap className="w-4 h-4" /> Admit &amp; Bill Tuition
                            </button>
                          )}
                        </div>
                        {isAdmin && (
                          <p className="text-[11px] text-gray-400">
                            &ldquo;Admit &amp; Bill&rdquo; records the admission and raises a tuition invoice from the matching fee structure for this student&apos;s grade.
                          </p>
                        )}
                        <RecordList rows={selectedStudentRecords.admissions} empty="No admission records for this student." fields={['application_number', 'status', 'grade_level', 'submitted_at', 'notes']} />
                      </TabsContent>
                      <TabsContent value="list">
                        <AdmissionsZebraList
                          rows={paginatedAdmissions}
                          allRowsCount={admissionRows.length}
                          page={admissionPage}
                          pageCount={admissionPageCount}
                          onPageChange={setAdmissionPage}
                          students={students}
                        />
                      </TabsContent>
                    </Tabs>
                  </>
                )}

                {activeSection === 'attendance' && (
                  <>
                    <SectionTitle icon={UserCheck} title="Attendance Tracking" description="Mark daily attendance and optionally prepare a parent alert." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Attendance Date" type="date" value={attendance.attendance_date} onChange={value => setAttendance(prev => ({ ...prev, attendance_date: value }))} />
                      <Field label="Status" value={attendance.status} onChange={value => setAttendance(prev => ({ ...prev, status: value }))} options={[
                        { value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }, { value: 'late', label: 'Late' }, { value: 'excused', label: 'Excused' },
                      ]} />
                      <Field label="Marked By" value={attendance.marked_by} onChange={value => setAttendance(prev => ({ ...prev, marked_by: value }))} />
                      <Field label="Notify Parent" type="checkbox" value={attendance.notified_parent} onChange={value => setAttendance(prev => ({ ...prev, notified_parent: value }))} />
                      <div className="md:col-span-2"><Field label="Reason / Note" value={attendance.reason} type="textarea" onChange={value => setAttendance(prev => ({ ...prev, reason: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={markAttendance} label="Mark Attendance" />
                    <RecordList rows={selectedStudentRecords.attendance} empty="No attendance records for this student." fields={['attendance_date', 'status', 'reason', 'marked_by', 'notified_parent']} />
                  </>
                )}

                {activeSection === 'academic' && (
                  <>
                    <SectionTitle icon={BookOpen} title="Academic History" description="Store assessment results that can support transcripts and progress tracking." />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Field label="Score" type="number" value={academic.score} onChange={value => setAcademic(prev => ({ ...prev, score: value }))} />
                      <Field label="Max Score" type="number" value={academic.max_score} onChange={value => setAcademic(prev => ({ ...prev, max_score: value }))} />
                      <Field label="Grade" value={academic.grade} onChange={value => setAcademic(prev => ({ ...prev, grade: value }))} />
                      <Field label="Rank" type="number" value={academic.rank} onChange={value => setAcademic(prev => ({ ...prev, rank: value }))} />
                      <div className="md:col-span-2"><Field label="Remarks" value={academic.remarks} onChange={value => setAcademic(prev => ({ ...prev, remarks: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={saveAcademic} label="Save Academic Entry" />
                    <RecordList rows={selectedStudentRecords.academic} empty="No academic entries for this student." fields={['score', 'max_score', 'grade', 'rank', 'remarks', 'created_at']} />
                  </>
                )}

                {activeSection === 'discipline' && (
                  <>
                    <SectionTitle icon={AlertTriangle} title="Discipline Records" description="Record incidents, severity, actions taken, and guardian notification status." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Incident Date" type="date" value={discipline.incident_date} onChange={value => setDiscipline(prev => ({ ...prev, incident_date: value }))} />
                      <Field label="Category" value={discipline.category} onChange={value => setDiscipline(prev => ({ ...prev, category: value }))} />
                      <Field label="Severity" value={discipline.severity} onChange={value => setDiscipline(prev => ({ ...prev, severity: value }))} options={[
                        { value: 'minor', label: 'Minor' }, { value: 'moderate', label: 'Moderate' }, { value: 'serious', label: 'Serious' },
                      ]} />
                      <Field label="Status" value={discipline.status} onChange={value => setDiscipline(prev => ({ ...prev, status: value }))} options={[
                        { value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'escalated', label: 'Escalated' },
                      ]} />
                      <Field label="Reported By" value={discipline.reported_by} onChange={value => setDiscipline(prev => ({ ...prev, reported_by: value }))} />
                      <Field label="Guardian Notified" type="checkbox" value={discipline.guardian_notified} onChange={value => setDiscipline(prev => ({ ...prev, guardian_notified: value }))} />
                      <div className="md:col-span-2"><Field label="Description" type="textarea" value={discipline.description} onChange={value => setDiscipline(prev => ({ ...prev, description: value }))} /></div>
                      <div className="md:col-span-2"><Field label="Action Taken" type="textarea" value={discipline.action_taken} onChange={value => setDiscipline(prev => ({ ...prev, action_taken: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving || !discipline.description.trim()} onClick={saveDiscipline} label="Save Discipline Record" />
                    <RecordList rows={selectedStudentRecords.discipline} empty="No discipline records for this student." fields={['incident_date', 'category', 'severity', 'status', 'description', 'action_taken']} />
                  </>
                )}

                {activeSection === 'allocation' && (
                  <>
                    <SectionTitle icon={School} title="Class and Stream Allocation" description="Assign the selected student to a grade, section, stream, and room for the academic year." />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Field label="Grade Level" type="number" value={allocation.grade_level} onChange={value => setAllocation(prev => ({ ...prev, grade_level: value }))} />
                      <Field label="Section" value={allocation.section_name} onChange={value => setAllocation(prev => ({ ...prev, section_name: value }))} />
                      <Field label="Stream" value={allocation.stream} onChange={value => setAllocation(prev => ({ ...prev, stream: value }))} />
                      <Field label="Room" value={allocation.room} onChange={value => setAllocation(prev => ({ ...prev, room: value }))} />
                      <Field label="Academic Year" value={allocation.academic_year} onChange={value => setAllocation(prev => ({ ...prev, academic_year: value }))} />
                      <Field label="Capacity" type="number" value={allocation.capacity} onChange={value => setAllocation(prev => ({ ...prev, capacity: value }))} />
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={allocateClass} label="Allocate Student" />
                    <RecordList rows={records.classes || []} empty="No classes or streams configured." fields={['grade_level', 'section_name', 'stream', 'room', 'academic_year', 'capacity']} />
                  </>
                )}

                {activeSection === 'lifecycle' && (
                  <>
                    <SectionTitle icon={Repeat2} title="Promotion, Graduation, Transfer, and Withdrawal" description="Record formal student movement decisions and update the student profile." />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Field label="Action" value={lifecycle.action} onChange={value => setLifecycle(prev => ({ ...prev, action: value }))} options={[
                        { value: 'promotion', label: 'Promotion / Graduation' }, { value: 'transfer', label: 'Transfer' }, { value: 'withdrawal', label: 'Withdrawal' },
                      ]} />
                      <Field label="Effective Date" type="date" value={lifecycle.effective_date} onChange={value => setLifecycle(prev => ({ ...prev, effective_date: value }))} />
                      <Field label="Approved / Processed By" value={lifecycle.approved_by} onChange={value => setLifecycle(prev => ({ ...prev, approved_by: value }))} />
                      {lifecycle.action === 'promotion' ? (
                        <>
                          <Field label="To Grade" type="number" value={lifecycle.to_grade_level} onChange={value => setLifecycle(prev => ({ ...prev, to_grade_level: value }))} />
                          <Field label="To Section" value={lifecycle.to_class_section} onChange={value => setLifecycle(prev => ({ ...prev, to_class_section: value }))} />
                          <Field label="Decision" value={lifecycle.decision} onChange={value => setLifecycle(prev => ({ ...prev, decision: value }))} options={[
                            { value: 'promoted', label: 'Promoted' }, { value: 'repeated', label: 'Repeated' }, { value: 'graduated', label: 'Graduated' },
                          ]} />
                        </>
                      ) : (
                        <>
                          <Field label="Destination School" value={lifecycle.destination_school} onChange={value => setLifecycle(prev => ({ ...prev, destination_school: value }))} />
                          <div className="md:col-span-2"><Field label="Reason" value={lifecycle.reason} onChange={value => setLifecycle(prev => ({ ...prev, reason: value }))} /></div>
                        </>
                      )}
                      <div className="md:col-span-3"><Field label="Notes" type="textarea" value={lifecycle.notes} onChange={value => setLifecycle(prev => ({ ...prev, notes: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={saveLifecycle} label="Save Lifecycle Action" />
                    <RecordList rows={[...selectedStudentRecords.promotions, ...selectedStudentRecords.transfers]} empty="No promotion, graduation, transfer, or withdrawal records for this student." fields={['movement_type', 'decision', 'from_grade_level', 'to_grade_level', 'effective_date', 'status', 'reason', 'notes']} />
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

const SectionTitle = ({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) => (
  <div className="flex items-start gap-3">
    <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
      <Icon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
    </div>
    <div>
      <h3 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h3>
      <p className="text-xs text-gray-400 mt-0.5">{description}</p>
    </div>
  </div>
);

const SaveButton = ({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <CheckCircle2 className="w-4 h-4" />
    {label}
  </button>
);

const RecordList = ({ rows, fields, empty }: { rows: SchoolRecord[]; fields: string[]; empty: string }) => (
  <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
      <Bell className="w-4 h-4 text-gray-400" />
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Recent Records</h4>
      <span className="text-[10px] text-gray-400">{rows.length}</span>
    </div>
    {rows.length === 0 ? (
      <p className="px-4 py-8 text-center text-sm text-gray-400">{empty}</p>
    ) : (
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {rows.slice(0, 8).map(row => (
          <div key={row.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {fields.map(field => row[field] !== undefined && row[field] !== null && row[field] !== '' ? (
              <div key={field}>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">{field.replace(/_/g, ' ')}</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 break-words">
                  {typeof row[field] === 'boolean' ? (row[field] ? 'Yes' : 'No') : String(row[field])}
                </p>
              </div>
            ) : null)}
          </div>
        ))}
      </div>
    )}
  </div>
);

const formatAdmissionDocuments = (documents: unknown) => {
  if (!Array.isArray(documents)) return '';
  return documents
    .map(item => {
      if (item && typeof item === 'object' && 'name' in item) {
        return String((item as { name?: unknown }).name || '').trim();
      }
      return String(item || '').trim();
    })
    .filter(Boolean)
    .join(', ');
};

const AdmissionsZebraList = ({
  rows,
  allRowsCount,
  page,
  pageCount,
  onPageChange,
  students,
}: {
  rows: SchoolRecord[];
  allRowsCount: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  students: Student[];
}) => {
  const studentById = useMemo(() => new Map(students.map(student => [student.id, student])), [students]);

  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Admissions Register</h4>
          <p className="text-xs text-gray-400">{allRowsCount} total applications</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Previous admissions page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pageCount}</span>
          <button
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page === pageCount}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Next admissions page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-400">No admissions have been recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-[10px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Application</th>
                <th className="px-4 py-3 text-left font-medium">Applicant</th>
                <th className="px-4 py-3 text-left font-medium">Grade</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Submitted</th>
                <th className="px-4 py-3 text-left font-medium">Documents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const linkedStudent = typeof row.student_id === 'string' ? studentById.get(row.student_id) : undefined;
                const applicantName = `${row.applicant_first_name || linkedStudent?.first_name || ''} ${row.applicant_last_name || linkedStudent?.last_name || ''}`.trim();
                return (
                  <tr key={row.id || `${row.application_number}-${index}`} className={index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/70 dark:bg-gray-900/30'}>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{String(row.application_number || 'Pending')}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{applicantName || 'Unknown applicant'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{String(row.grade_level || '')}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">
                        {String(row.status || 'submitted')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{String(row.submitted_at || '').slice(0, 10)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-xs truncate">{formatAdmissionDocuments(row.documents) || 'None'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StudentRecordsWorkspace;
