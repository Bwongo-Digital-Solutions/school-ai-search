import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionableNotification,
  Button,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from '@carbon/react';
import {
  Book,
  Checkmark,
  ChevronLeft,
  ChevronRight,
  ListChecked,
  DocumentAdd,
  Education,
  Renew,
  Repeat,
  Result,
  UserFollow,
  Warning,
} from '@carbon/react/icons';
import { supabase } from '@/lib/supabase';
import { callFees } from '@/lib/fees';
import { classAndSection, classOptionsFor } from '@/lib/classLevels';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
  AccessDenied,
  CardHeader,
  Field,
  PageHeader,
  StatRow,
  StatTile,
  StudentPicker,
  WidgetCard,
} from '@/components/common';
import styles from './student-records.module.scss';
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

const StudentRecordsWorkspace: React.FC = () => {
  const { students, refreshStudents, focus, clearFocus } = useChatContext();
  const { isAuthenticated, isAdmin, isSupportStaff, user, isLoading: authLoading, logAudit } = useAuth();
  const { notify, confirm } = useNotifications();

  // Arrived from a search hit on an attendance record: open that student's file.
  useEffect(() => {
    if (focus?.view !== 'records' || !focus.studentId) return;
    setSelectedStudentId(focus.studentId);
    setActiveSection('attendance');
    clearFocus();
  }, [focus, clearFocus]);
  const { settings } = useSettings();
  const [activeSection, setActiveSection] = useState<SectionKey>('admissions');
  const [admissionPane, setAdmissionPane] = useState('form');
  const [admissionPage, setAdmissionPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<Record<string, SchoolRecord[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
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

  /**
   * Every record table this workspace shows, for whoever is signed in.
   *
   * `user` is a dependency for the same reason it is one in ChatContext's roster load: all eight
   * of these tables are gated to teaching roles, so a fetch made before the session was restored
   * was refused, and without `user` here nothing ever asked again. Signing in reloads them.
   */
  const loadRecords = useCallback(async () => {
    if (authLoading) return;
    if (!user || isSupportStaff) {
      setRecords({});
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const failures: string[] = [];
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
        failures.push(table);
        loaded[table] = [];
      } else {
        loaded[table] = data || [];
      }
    }
    setRecords(loaded);
    // Named rather than counted: knowing it was attendance that would not load is the difference
    // between "the register is missing" and "the whole workspace is broken".
    setLoadError(failures.length ? failures.join(', ').replace(/_/g, ' ') : null);
    setLoading(false);
  }, [authLoading, user, isSupportStaff]);

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
      notify.error(`${label} failed`, getErrorMessage(error));
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
    if (
      dup &&
      !(await confirm({
        title: 'This student already has an admission',
        message: `${studentName(selectedStudent)} has admission ${dup.application_number} (${dup.status}). Add another anyway?`,
        confirmLabel: 'Add another',
      }))
    ) {
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
    if (
      existingLiveAdmission() &&
      !(await confirm({
        title: 'This student already has an admission',
        message: `${studentName(selectedStudent)} has already been admitted. Admit and bill again?`,
        confirmLabel: 'Admit and bill again',
      }))
    ) {
      return;
    }
    const preview = await callFees<{ amount: number; currency: string; feeStructure: { name: string } }>(
      'bill_student',
      { studentId: selectedStudent.id, preview: true },
      user,
    );
    // The amount is shown before the invoice exists, because this is the last point at which a
    // wrong fee structure can be caught for free.
    const ok = await confirm({
      title: 'Admit and bill this student?',
      message: `${studentName(selectedStudent)} will be admitted and invoiced ${preview.currency} ${Math.round(
        preview.amount,
      ).toLocaleString()} for tuition, from the “${preview.feeStructure.name}” structure.`,
      confirmLabel: 'Admit and bill',
    });
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
    notify.success(
      `${studentName(selectedStudent)} admitted`,
      result.alreadyBilled
        ? `Tuition was already billed${result.invoice?.invoice_number ? ` (${result.invoice.invoice_number})` : ''}.`
        : `Billed ${result.currency} ${Math.round(result.amount).toLocaleString()} for tuition.`,
    );
  });

  const markAttendance = () => saveRecord('Attendance marking', async () => {
    // One record per student per day. Updating in place when this date is already loaded saves a
    // round trip and keeps the edit obvious, but it is only an optimisation — this list can be
    // stale, so the guarantee comes from the server, which upserts on (student_id, attendance_date).
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
    { key: 'admissions', label: 'Admissions', icon: DocumentAdd },
    { key: 'attendance', label: 'Attendance', icon: UserFollow },
    { key: 'academic', label: 'Academic', icon: Book },
    { key: 'discipline', label: 'Discipline', icon: Warning },
    { key: 'allocation', label: 'Allocation', icon: Result },
    { key: 'lifecycle', label: 'Lifecycle', icon: Repeat },
  ] as const;

  if (!isAuthenticated || isSupportStaff) {
    return (
      <AccessDenied
        title={isSupportStaff ? 'Restricted to teachers and administrators' : 'Sign in to continue'}
        message={
          isSupportStaff
            ? 'Support staff accounts can see school fees payment status. Student records are available to teachers and administrators.'
            : 'Sign in to open student records.'
        }
      />
    );
  }

  return (
    <div className={styles.screen}>
      <PageHeader title="Student records" illustration={<ListChecked size={32} />}>
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={loadRecords} disabled={loading}>
          Refresh
        </Button>
      </PageHeader>

      {loadError && (
        <ActionableNotification
          inline
          kind="error"
          title="Some records could not be loaded"
          subtitle={`${loadError}. What is shown below is incomplete.`}
          lowContrast
          actionButtonLabel="Try again"
          onActionButtonClick={loadRecords}
          onClose={() => setLoadError(null)}
        />
      )}

      <div className={styles.controls}>
        <StatRow>
          <StatTile label="Admissions" value={records.admissions?.length || 0} icon={DocumentAdd} />
          <StatTile label="Attendance" value={records.attendance_records?.length || 0} icon={UserFollow} />
          <StatTile label="Academics" value={records.gradebook_entries?.length || 0} icon={Book} />
          <StatTile
            label="Discipline"
            value={records.discipline_records?.length || 0}
            icon={Warning}
            tone={(records.discipline_records?.length || 0) > 0 ? 'warning' : 'default'}
          />
          <StatTile label="Promotions" value={records.student_promotions?.length || 0} icon={Education} />
          <StatTile label="Movements" value={records.student_transfers?.length || 0} icon={Repeat} />
        </StatRow>
      </div>

      <div className={styles.body}>
        <div className={styles.columns}>
          <aside className={styles.aside}>
            <WidgetCard>
              <CardHeader title="Student" />
              <div className={styles.asideBody}>
                <StudentPicker
                  id="records-student"
                  value={selectedStudent?.id || ''}
                  onChange={setSelectedStudentId}
                  students={students}
                  hideLabel
                />
                {selectedStudent && (
                  <dl className={styles.studentFacts}>
                    <div>
                      <dt>Class</dt>
                      <dd>
                        {classAndSection(settings.school_level, selectedStudent.grade_level, selectedStudent.class_section)}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{selectedStudent.status}</dd>
                    </div>
                    <div>
                      <dt>Lifecycle</dt>
                      <dd>{selectedStudent.lifecycle_status || 'enrolled'}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </WidgetCard>

            <WidgetCard>
              <nav className={styles.sectionNav} aria-label="Record sections">
                {sections.map(section => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`${styles.sectionLink} ${
                      activeSection === section.key ? styles.sectionCurrent : ''
                    }`}
                    aria-current={activeSection === section.key ? 'page' : undefined}
                  >
                    <section.icon size={16} />
                    {section.label}
                  </button>
                ))}
              </nav>
            </WidgetCard>
          </aside>

          <WidgetCard className={styles.main}>
            {loading ? (
              <div className={styles.loading}>
                <InlineLoading description="Loading records…" />
              </div>
            ) : (
              <div className={styles.pane}>
                {!canEdit && (
                  <InlineNotification
                    kind="info"
                    title="View only"
                    subtitle="Teacher accounts can read these records. Adding or changing them needs an administrator."
                    lowContrast
                    hideCloseButton
                  />
                )}

                {activeSection === 'admissions' && (
                  <>
                    <SectionTitle icon={DocumentAdd} title="Student Registration / Admission" description="Record applications, then review the full admissions register." />
                    <Tabs
                      selectedIndex={admissionPane === 'form' ? 0 : 1}
                      onChange={({ selectedIndex }) => setAdmissionPane(selectedIndex === 0 ? 'form' : 'list')}
                    >
                      <TabList aria-label="Admissions" contained>
                        <Tab>New admission</Tab>
                        <Tab>Admissions register</Tab>
                      </TabList>
                      <TabPanels>
                        <TabPanel className={styles.tabPanel}>
                        <div className={styles.grid2}>
                          <Field label="Application Number" value={admission.application_number} onChange={value => setAdmission(prev => ({ ...prev, application_number: value }))} />
                          <Field label="Status" value={admission.status} onChange={value => setAdmission(prev => ({ ...prev, status: value }))} options={[
                            { value: 'submitted', label: 'Submitted' }, { value: 'reviewing', label: 'Reviewing' }, { value: 'accepted', label: 'Accepted' }, { value: 'admitted', label: 'Admitted' }, { value: 'rejected', label: 'Rejected' }, { value: 'registered', label: 'Registered' },
                          ]} />
                          <Field label="Applicant First Name" value={admission.applicant_first_name} onChange={value => setAdmission(prev => ({ ...prev, applicant_first_name: value }))} />
                          <Field label="Applicant Last Name" value={admission.applicant_last_name} onChange={value => setAdmission(prev => ({ ...prev, applicant_last_name: value }))} />
                          <Field
                            label="Class"
                            value={admission.grade_level}
                            onChange={value => setAdmission(prev => ({ ...prev, grade_level: Number(value) }))}
                            options={classOptionsFor(settings.school_level).map(option => ({
                              value: String(option.value),
                              label: option.label,
                            }))}
                          />
                          <Field label="Documents" value={admission.documents} onChange={value => setAdmission(prev => ({ ...prev, documents: value }))} />
                          <div className={styles.spanAll}><Field label="Notes" value={admission.notes} type="textarea" onChange={value => setAdmission(prev => ({ ...prev, notes: value }))} /></div>
                        </div>
                        <div className={styles.actions}>
                          <Button
                            kind="primary"
                            size="md"
                            renderIcon={Checkmark}
                            onClick={createAdmission}
                            disabled={!canEdit || saving}
                          >
                            Save admission
                          </Button>
                          {isAdmin && (
                            <Button
                              kind="tertiary"
                              size="md"
                              renderIcon={Education}
                              onClick={admitAndBill}
                              disabled={saving}
                            >
                              Admit &amp; bill tuition
                            </Button>
                          )}
                        </div>
                        {isAdmin && (
                          <p className={styles.actionNote}>
                            &ldquo;Admit &amp; Bill&rdquo; records the admission and raises a tuition invoice from the matching fee structure for this student&apos;s grade.
                          </p>
                        )}
                        <RecordList rows={selectedStudentRecords.admissions} empty="No admission records for this student." fields={['application_number', 'status', 'grade_level', 'submitted_at', 'notes']} />
                        </TabPanel>
                        <TabPanel className={styles.tabPanel}>
                        <AdmissionsZebraList
                          rows={paginatedAdmissions}
                          allRowsCount={admissionRows.length}
                          page={admissionPage}
                          pageCount={admissionPageCount}
                          onPageChange={setAdmissionPage}
                          students={students}
                        />
                        </TabPanel>
                      </TabPanels>
                    </Tabs>
                  </>
                )}

                {activeSection === 'attendance' && (
                  <>
                    <SectionTitle icon={UserFollow} title="Attendance Tracking" description="Mark daily attendance and optionally prepare a parent alert." />
                    <div className={styles.grid2}>
                      <Field label="Attendance Date" type="date" value={attendance.attendance_date} onChange={value => setAttendance(prev => ({ ...prev, attendance_date: value }))} />
                      <Field label="Status" value={attendance.status} onChange={value => setAttendance(prev => ({ ...prev, status: value }))} options={[
                        { value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }, { value: 'late', label: 'Late' }, { value: 'excused', label: 'Excused' },
                      ]} />
                      <Field label="Marked By" value={attendance.marked_by} onChange={value => setAttendance(prev => ({ ...prev, marked_by: value }))} />
                      <Field label="Notify Parent" type="checkbox" value={attendance.notified_parent} onChange={value => setAttendance(prev => ({ ...prev, notified_parent: value }))} />
                      <div className={styles.spanAll}><Field label="Reason / Note" value={attendance.reason} type="textarea" onChange={value => setAttendance(prev => ({ ...prev, reason: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={markAttendance} label="Mark Attendance" />
                    <RecordList rows={selectedStudentRecords.attendance} empty="No attendance records for this student." fields={['attendance_date', 'status', 'reason', 'marked_by', 'notified_parent']} />
                  </>
                )}

                {activeSection === 'academic' && (
                  <>
                    <SectionTitle icon={Book} title="Academic History" description="Store assessment results that can support transcripts and progress tracking." />
                    <div className={styles.grid3}>
                      <Field label="Score" type="number" value={academic.score} onChange={value => setAcademic(prev => ({ ...prev, score: value }))} />
                      <Field label="Max Score" type="number" value={academic.max_score} onChange={value => setAcademic(prev => ({ ...prev, max_score: value }))} />
                      <Field label="Grade" value={academic.grade} onChange={value => setAcademic(prev => ({ ...prev, grade: value }))} />
                      <Field label="Rank" type="number" value={academic.rank} onChange={value => setAcademic(prev => ({ ...prev, rank: value }))} />
                      <div className={styles.spanAll}><Field label="Remarks" value={academic.remarks} onChange={value => setAcademic(prev => ({ ...prev, remarks: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={saveAcademic} label="Save Academic Entry" />
                    <RecordList rows={selectedStudentRecords.academic} empty="No academic entries for this student." fields={['score', 'max_score', 'grade', 'rank', 'remarks', 'created_at']} />
                  </>
                )}

                {activeSection === 'discipline' && (
                  <>
                    <SectionTitle icon={Warning} title="Discipline Records" description="Record incidents, severity, actions taken, and guardian notification status." />
                    <div className={styles.grid2}>
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
                      <div className={styles.spanAll}><Field label="Description" type="textarea" value={discipline.description} onChange={value => setDiscipline(prev => ({ ...prev, description: value }))} /></div>
                      <div className={styles.spanAll}><Field label="Action Taken" type="textarea" value={discipline.action_taken} onChange={value => setDiscipline(prev => ({ ...prev, action_taken: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving || !discipline.description.trim()} onClick={saveDiscipline} label="Save Discipline Record" />
                    <RecordList rows={selectedStudentRecords.discipline} empty="No discipline records for this student." fields={['incident_date', 'category', 'severity', 'status', 'description', 'action_taken']} />
                  </>
                )}

                {activeSection === 'allocation' && (
                  <>
                    <SectionTitle icon={Result} title="Class and Stream Allocation" description="Assign the selected student to a grade, section, stream, and room for the academic year." />
                    <div className={styles.grid3}>
                      <Field
                        label="Class"
                        value={allocation.grade_level}
                        onChange={value => setAllocation(prev => ({ ...prev, grade_level: Number(value) }))}
                        options={classOptionsFor(settings.school_level).map(option => ({
                          value: String(option.value),
                          label: option.label,
                        }))}
                      />
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
                    <SectionTitle icon={Repeat} title="Promotion, Graduation, Transfer, and Withdrawal" description="Record formal student movement decisions and update the student profile." />
                    <div className={styles.grid3}>
                      <Field label="Action" value={lifecycle.action} onChange={value => setLifecycle(prev => ({ ...prev, action: value }))} options={[
                        { value: 'promotion', label: 'Promotion / Graduation' }, { value: 'transfer', label: 'Transfer' }, { value: 'withdrawal', label: 'Withdrawal' },
                      ]} />
                      <Field label="Effective Date" type="date" value={lifecycle.effective_date} onChange={value => setLifecycle(prev => ({ ...prev, effective_date: value }))} />
                      <Field label="Approved / Processed By" value={lifecycle.approved_by} onChange={value => setLifecycle(prev => ({ ...prev, approved_by: value }))} />
                      {lifecycle.action === 'promotion' ? (
                        <>
                          <Field
                            label="Promote to"
                            value={lifecycle.to_grade_level}
                            onChange={value => setLifecycle(prev => ({ ...prev, to_grade_level: Number(value) }))}
                            options={classOptionsFor(settings.school_level).map(option => ({
                              value: String(option.value),
                              label: option.label,
                            }))}
                          />
                          <Field label="To Section" value={lifecycle.to_class_section} onChange={value => setLifecycle(prev => ({ ...prev, to_class_section: value }))} />
                          <Field label="Decision" value={lifecycle.decision} onChange={value => setLifecycle(prev => ({ ...prev, decision: value }))} options={[
                            { value: 'promoted', label: 'Promoted' }, { value: 'repeated', label: 'Repeated' }, { value: 'graduated', label: 'Graduated' },
                          ]} />
                        </>
                      ) : (
                        <>
                          <Field label="Destination Result" value={lifecycle.destination_school} onChange={value => setLifecycle(prev => ({ ...prev, destination_school: value }))} />
                          <div className={styles.spanAll}><Field label="Reason" value={lifecycle.reason} onChange={value => setLifecycle(prev => ({ ...prev, reason: value }))} /></div>
                        </>
                      )}
                      <div className={styles.spanAll}><Field label="Notes" type="textarea" value={lifecycle.notes} onChange={value => setLifecycle(prev => ({ ...prev, notes: value }))} /></div>
                    </div>
                    <SaveButton disabled={!canEdit || saving} onClick={saveLifecycle} label="Save Lifecycle Action" />
                    <RecordList rows={[...selectedStudentRecords.promotions, ...selectedStudentRecords.transfers]} empty="No promotion, graduation, transfer, or withdrawal records for this student." fields={['movement_type', 'decision', 'from_grade_level', 'to_grade_level', 'effective_date', 'status', 'reason', 'notes']} />
                  </>
                )}
              </div>
            )}
          </WidgetCard>
        </div>
      </div>
    </div>
  );
};

const SectionTitle = ({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) => (
  <div className={styles.sectionTitle}>
    <span className={styles.sectionMark}>
      <Icon size={20} />
    </span>
    <div>
      <h3 className={styles.sectionHeading}>{title}</h3>
      <p className={styles.sectionDescription}>{description}</p>
    </div>
  </div>
);

const SaveButton = ({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) => (
  <div className={styles.actions}>
    <Button kind="primary" size="md" renderIcon={Checkmark} onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  </div>
);

/**
 * The last few entries of whatever was just written.
 *
 * Shown under every form because the question after saving is always "did that go in?", and the
 * honest answer is the record itself rather than a toast that disappears.
 */
const RecordList = ({ rows, fields, empty }: { rows: SchoolRecord[]; fields: string[]; empty: string }) => (
  <WidgetCard>
    <CardHeader title="Recent records">
      <Tag type="cool-gray" size="sm">{rows.length}</Tag>
    </CardHeader>
    {rows.length === 0 ? (
      <p className={styles.empty}>{empty}</p>
    ) : (
      rows.slice(0, 8).map(row => (
        <div key={row.id} className={styles.recordRow}>
          {fields.map(field =>
            row[field] !== undefined && row[field] !== null && row[field] !== '' ? (
              <div key={field}>
                <p className={styles.recordLabel}>{field.replace(/_/g, ' ')}</p>
                <p className={styles.recordValue}>
                  {typeof row[field] === 'boolean' ? (row[field] ? 'Yes' : 'No') : String(row[field])}
                </p>
              </div>
            ) : null,
          )}
        </div>
      ))
    )}
  </WidgetCard>
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
    <WidgetCard>
      <CardHeader title="Admissions register">
        <span className={styles.note}>{allRowsCount} applications</span>
        <div className={styles.pager}>
          <Button
            hasIconOnly
            kind="ghost"
            size="sm"
            renderIcon={ChevronLeft}
            iconDescription="Previous page"
            tooltipPosition="bottom"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
          />
          <span className={styles.note}>
            Page {page} of {pageCount}
          </span>
          <Button
            hasIconOnly
            kind="ghost"
            size="sm"
            renderIcon={ChevronRight}
            iconDescription="Next page"
            tooltipPosition="bottom"
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page === pageCount}
          />
        </div>
      </CardHeader>

      {rows.length === 0 ? (
        <p className={styles.empty}>No admissions have been recorded.</p>
      ) : (
        <div className={styles.tableWrap}>
          <Table size="sm" useZebraStyles>
            <TableHead>
              <TableRow>
                <TableHeader>Application</TableHeader>
                <TableHeader>Applicant</TableHeader>
                <TableHeader>Grade</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Submitted</TableHeader>
                <TableHeader>Documents</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, index) => {
                const linkedStudent =
                  typeof row.student_id === 'string' ? studentById.get(row.student_id) : undefined;
                const applicantName = `${row.applicant_first_name || linkedStudent?.first_name || ''} ${
                  row.applicant_last_name || linkedStudent?.last_name || ''
                }`.trim();
                return (
                  <TableRow key={row.id || `${row.application_number}-${index}`}>
                    <TableCell className={styles.strong}>
                      {String(row.application_number || 'Pending')}
                    </TableCell>
                    <TableCell>{applicantName || 'Unknown applicant'}</TableCell>
                    <TableCell>{String(row.grade_level || '')}</TableCell>
                    <TableCell>
                      <Tag type="blue" size="sm">
                        {String(row.status || 'submitted')}
                      </Tag>
                    </TableCell>
                    <TableCell>{String(row.submitted_at || '').slice(0, 10)}</TableCell>
                    <TableCell className={styles.truncate}>
                      {formatAdmissionDocuments(row.documents) || 'None'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </WidgetCard>
  );
};

export default StudentRecordsWorkspace;
