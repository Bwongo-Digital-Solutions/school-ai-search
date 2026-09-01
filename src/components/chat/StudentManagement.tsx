import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Modal,
  NumberInput,
  InlineLoading,
  InlineNotification,
  Search,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  TextInput,
} from '@carbon/react';
import {
  Add,
  ArrowDown,
  ArrowUp,
  ArrowsVertical,
  Calendar,
  ChartLine,
  Download,
  CheckmarkFilled,
  Edit as EditIcon,
  Printer,
  ScanAlt as ScanIcon,
  TrashCan as TrashIcon,
  UserAdmin,
  UserMultiple,
  View,
  Wallet,
} from '@carbon/react/icons';
import { classAndSection, classFilterOptions, classLabel, classOptionsFor } from '@/lib/classLevels';
import { useSettings } from '@/contexts/SettingsContext';
import {
  AccessDenied,
  ColorPicker,
  Field,
  ImagePicker,
  PageHeader,
  StatRow,
  StatTile,
} from '@/components/common';
import styles from './student-management.module.scss';
import StudentIdScanner from './StudentIdScanner';
import { buildApiUrl, supabase } from '@/lib/supabase';
import { parseStudentCode } from '@/lib/studentCode';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { Student } from '@/types/chat';

const EMPTY_STUDENT = {
  student_id: '', first_name: '', last_name: '', grade_level: 9,
  class_section: 'A', date_of_birth: '', gender: 'Male', email: '',
  phone: '', parent_name: '', parent_phone: '', parent_email: '',
  address: '', enrollment_date: new Date().toISOString().split('T')[0],
  status: 'active', gpa: 0, attendance_rate: 100, subjects: [] as string[],
  notes: '', photo_url: '',
};

type StudentFormState = typeof EMPTY_STUDENT;
type SortKey = 'first_name' | 'last_name' | 'grade_level' | 'gpa' | 'attendance_rate' | 'status';

const GRADING_COUNTRIES = [
  { value: 'international', label: 'International' },
  { value: 'uganda', label: 'Uganda (UNEB, D1–F9)' },
  { value: 'uganda-cbc', label: 'Uganda (Competency-Based, A–E)' },
  { value: 'kenya', label: 'Kenya' },
  { value: 'united-states', label: 'United States' },
  { value: 'united-kingdom', label: 'United Kingdom' },
];

const ACADEMIC_LEVELS = [
  { value: 'nursery', label: 'Nursery' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'tertiary', label: 'Tertiary' },
  { value: 'university', label: 'University' },
];

const getDefaultAcademicYear = () => {
  const year = new Date().getFullYear();
  return `${year}/${year + 1}`;
};

const inferAcademicLevel = (gradeLevel: number) => {
  if (gradeLevel <= 0) return 'nursery';
  if (gradeLevel <= 7) return 'primary';
  if (gradeLevel <= 13) return 'secondary';
  return 'tertiary';
};

const DEFAULT_REPORT_THEME = '#2952a3';
const REPORT_BRANDING_KEY = 'schoolbot_report_branding';

// Uploaded images are inlined into the report-card request as base64 data URLs, so they need no
// storage of their own. Keep them small — the whole request is held in memory on both ends.
const MAX_REPORT_IMAGE_BYTES = 2 * 1024 * 1024;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (file.size > MAX_REPORT_IMAGE_BYTES) {
      reject(new Error('Image must be 2MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });

// School-wide branding (name, tagline, address, logo, theme) is reused across every report card,
// so remember the last values in the browser rather than re-entering them each time.
type ReportBranding = {
  schoolName: string;
  schoolTagline: string;
  schoolAddress: string;
  themeColor: string;
  schoolLogo: string;
};

const loadReportBranding = (): Partial<ReportBranding> => {
  try {
    return JSON.parse(localStorage.getItem(REPORT_BRANDING_KEY) || '{}');
  } catch {
    return {};
  }
};

const saveReportBranding = (branding: ReportBranding) => {
  try {
    localStorage.setItem(REPORT_BRANDING_KEY, JSON.stringify(branding));
  } catch {
    // Storage may be full or blocked; the report still generates, branding just isn't remembered.
  }
};

/** The dropdown needs a real item to mean "no filter"; null reads as nothing selected. */
const ALL_GRADES = 'all' as const;
const GRADE_ALL_ITEMS: (typeof ALL_GRADES | number)[] = [ALL_GRADES];

/** GPA and attendance colour bands, named once so the table markup does not carry the thresholds. */
const gpaBand = (gpa: number) => (gpa >= 3.5 ? 'high' : gpa >= 3 ? 'good' : gpa >= 2.5 ? 'fair' : 'low');
const attendanceBand = (rate: number) =>
  rate >= 95 ? 'high' : rate >= 90 ? 'good' : rate >= 85 ? 'fair' : 'low';

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

/**
 * One form field, on Carbon.
 *
 * Every field in the student form goes through here, so this is the whole form's appearance in one
 * place: Carbon's inputs bring their own label, invalid state and helper-text slots, which is why
 * the hand-built label and error paragraph below it are gone rather than restyled.
 */
const StudentField = ({ label, name, form, setForm, errors, type = 'text', required, options, numeric, min, max, step }: {
  label: string;
  name: keyof StudentFormState;
  form: StudentFormState;
  setForm: React.Dispatch<React.SetStateAction<StudentFormState>>;
  errors: Record<string, string>;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** Store the chosen option as a number. `grade_level` is an integer column. */
  numeric?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) => {
  const id = `student-${String(name)}`;
  const invalid = Boolean(errors[name]);
  const shared = { id, labelText: label, invalid, invalidText: errors[name] };

  if (options) {
    return (
      <Select
        {...shared}
        value={String(form[name])}
        onChange={(event) =>
          setForm((prev) => ({
            ...prev,
            [name]: numeric ? Number(event.target.value) : event.target.value,
          }))
        }
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} text={option.label} />
        ))}
      </Select>
    );
  }

  if (type === 'textarea') {
    return (
      <TextArea
        {...shared}
        rows={3}
        value={String(form[name] ?? '')}
        onChange={(event) =>
          setForm((prev) => ({
            ...prev,
            [name]: numeric ? Number(event.target.value) : event.target.value,
          }))
        }
      />
    );
  }

  if (type === 'number') {
    // Carbon's NumberInput owns the increment/decrement affordances and the min/max clamp, which
    // the plain input had to leave to the browser.
    return (
      <NumberInput
        {...shared}
        value={Number(form[name] ?? 0)}
        min={min}
        max={max}
        step={step}
        hideSteppers={step === undefined}
        onChange={(_event, { value }) =>
          setForm((prev) => ({ ...prev, [name]: value === '' ? 0 : Number(value) }))
        }
      />
    );
  }

  return (
    <TextInput
      {...shared}
      type={type}
      value={String(form[name] ?? '')}
      onChange={(event) => setForm((prev) => ({ ...prev, [name]: event.target.value }))}
      required={required}
    />
  );
};

const StudentManagement: React.FC = () => {
  const { notify } = useNotifications();
  const { settings } = useSettings();

  const { students, refreshStudents, focus, clearFocus } = useChatContext();
  const { user, isAuthenticated, isAdmin, isSupportStaff, logAudit } = useAuth();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last_name');
  const [sortAsc, setSortAsc] = useState(true);
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);

  // Arrived here from global search: filter the roster down to the student that was picked, so the
  // row is the only one on screen rather than one of four hundred.
  useEffect(() => {
    if (focus?.view !== 'students' || !focus.studentId) return;
    const student = students.find(entry => entry.id === focus.studentId);
    if (!student) return;
    setSearch(student.student_id);
    setGradeFilter(null);
    clearFocus();
  }, [focus, students, clearFocus]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_STUDENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [subjectInput, setSubjectInput] = useState('');
  const [reportCardStudent, setReportCardStudent] = useState<Student | null>(null);
  const [reportCardTerm, setReportCardTerm] = useState('Term 1');
  const [reportCardYear, setReportCardYear] = useState(getDefaultAcademicYear());
  const [reportCardGradingCountry, setReportCardGradingCountry] = useState('international');
  const [reportCardAcademicLevel, setReportCardAcademicLevel] = useState('secondary');
  const [reportCardTitle, setReportCardTitle] = useState('');
  const [reportCardSchoolName, setReportCardSchoolName] = useState('');
  const [reportCardSchoolTagline, setReportCardSchoolTagline] = useState('');
  const [reportCardTeacherName, setReportCardTeacherName] = useState('');
  const [reportCardHeadTeacherName, setReportCardHeadTeacherName] = useState('');
  const [reportCardTeacherComment, setReportCardTeacherComment] = useState('');
  const [reportCardNotes, setReportCardNotes] = useState('');
  const [isBuildingReport, setIsBuildingReport] = useState(false);
  const [reportCardAddress, setReportCardAddress] = useState('');
  const [reportCardThemeColor, setReportCardThemeColor] = useState(DEFAULT_REPORT_THEME);
  const [reportCardLogo, setReportCardLogo] = useState('');
  const [reportCardPhoto, setReportCardPhoto] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [idCardStudent, setIdCardStudent] = useState<Student | null>(null);

  const canEdit = isAdmin;
  // Support staff are limited to the school fees payment status view.
  const canView = isAuthenticated && !isSupportStaff;
  const isViewOnly = canView && !isAdmin;

  const filtered = useMemo(() => {
    let list = [...students];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        `${s.first_name} ${s.last_name} ${s.student_id} ${s.email}`.toLowerCase().includes(q)
      );
    }
    if (gradeFilter !== null) {
      list = list.filter(s => s.grade_level === gradeFilter);
    }
    list.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return list;
  }, [students, search, sortKey, sortAsc, gradeFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  // Which way a column is sorted. Grey arrows on the columns you could sort by, the school's
  // colour on the one you are sorting by.
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowsVertical size={16} className={styles.sortIdle} />;
    return sortAsc ? (
      <ArrowUp size={16} className={styles.sortActive} />
    ) : (
      <ArrowDown size={16} className={styles.sortActive} />
    );
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    if (!form.student_id.trim()) e.student_id = 'Required';
    if (!Number.isFinite(Number(form.grade_level))) e.grade_level = 'Choose a class';
    if (form.gpa < 0 || form.gpa > 4) e.gpa = 'Must be 0-4';
    if (form.attendance_rate < 0 || form.attendance_rate > 100) e.attendance_rate = 'Must be 0-100';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (form.parent_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.parent_email)) e.parent_email = 'Invalid email';
    const existing = students.find(s => s.student_id === form.student_id && s.id !== editingId);
    if (existing) e.student_id = 'ID already exists';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const openAdd = () => {
    if (!canEdit) return;
    setForm({ ...EMPTY_STUDENT, student_id: `STU-${new Date().getFullYear()}-${String(students.length + 1).padStart(3, '0')}` });
    setEditingId(null);
    setErrors({});
    setSubjectInput('');
    setShowForm(true);
  };

  const openEdit = (s: Student) => {
    if (!canEdit) return;
    setForm({
      student_id: s.student_id, first_name: s.first_name, last_name: s.last_name,
      grade_level: s.grade_level, class_section: s.class_section || 'A',
      date_of_birth: s.date_of_birth || '', gender: s.gender || 'Male',
      email: s.email || '', phone: s.phone || '', parent_name: s.parent_name || '',
      parent_phone: s.parent_phone || '', parent_email: s.parent_email || '',
      address: s.address || '', enrollment_date: s.enrollment_date || '',
      status: s.status || 'active', gpa: s.gpa ?? 0, attendance_rate: s.attendance_rate ?? 100,
      subjects: Array.isArray(s.subjects) ? s.subjects : [], notes: s.notes || '',
      photo_url: s.photo_url || '',
    });
    setEditingId(s.id);
    setErrors({});
    setSubjectInput('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!canEdit || !validate()) return;
    setSaving(true);
    try {
      const payload = { ...form, subjects: form.subjects };
      if (editingId) {
        const { error } = await supabase.from('students').update(payload).eq('id', editingId);
        if (error) throw error;
        await logAudit('update', editingId, `${form.first_name} ${form.last_name}`, payload);
      } else {
        // `from` is generic; naming the row shape is what lets the new id be read back. Without it
        // the builder hands back `unknown` and this line does not compile.
        const { data: newStudent, error } = await supabase
          .from<{ id: string }>('students')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        await logAudit('create', newStudent?.id, `${form.first_name} ${form.last_name}`, payload);
      }
      await refreshStudents();
      setShowForm(false);
    } catch (err: unknown) {
      console.error('Save failed:', err);
      notify.error('Could not save the student', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    try {
      const student = students.find(s => s.id === id);
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) throw error;
      if (student) {
        await logAudit('delete', id, `${student.first_name} ${student.last_name}`, {
          student_id: student.student_id,
          name: `${student.first_name} ${student.last_name}`,
        });
      }
      await refreshStudents();
      setDeleteConfirm(null);
    } catch (err: unknown) {
      console.error('Delete failed:', err);
      notify.error('Could not delete the student', getErrorMessage(err));
    }
  };

  const addSubject = () => {
    const s = subjectInput.trim();
    if (s && !form.subjects.includes(s)) {
      setForm(prev => ({ ...prev, subjects: [...prev.subjects, s] }));
      setSubjectInput('');
    }
  };

  const removeSubject = (sub: string) => {
    setForm(prev => ({ ...prev, subjects: prev.subjects.filter(s => s !== sub) }));
  };

  const openReportCardBuilder = (student: Student) => {
    const branding = loadReportBranding();
    setReportCardStudent(student);
    setReportCardTerm('Term 1');
    setReportCardYear(getDefaultAcademicYear());
    setReportCardAcademicLevel(inferAcademicLevel(student.grade_level));
    setReportCardGradingCountry('international');
    setReportCardTitle('');
    // Reuse the school's saved branding; a fresh browser falls back to server defaults.
    setReportCardSchoolName(branding.schoolName || '');
    setReportCardSchoolTagline(branding.schoolTagline || '');
    setReportCardAddress(branding.schoolAddress || '');
    setReportCardThemeColor(branding.themeColor || DEFAULT_REPORT_THEME);
    setReportCardLogo(branding.schoolLogo || '');
    setReportCardPhoto('');
    setReportCardTeacherName('');
    setReportCardHeadTeacherName('');
    setReportCardTeacherComment('');
    setReportCardNotes(student.notes || '');
  };

  const handleReportImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setter(await readFileAsDataUrl(file));
    } catch (err: unknown) {
      notify.error('Could not read that image', getErrorMessage(err) || undefined);
    }
  };

  const handleReportCardDownload = async () => {
    if (!reportCardStudent) return;

    setIsBuildingReport(true);
    try {
      // Images and the theme are too large or awkward for a query string, so the whole set is
      // sent as a JSON POST body instead. The server accepts both shapes.
      const payload: Record<string, string> = {
        term: reportCardTerm,
        academicYear: reportCardYear,
        gradingCountry: reportCardGradingCountry,
        academicLevel: reportCardAcademicLevel,
        themeColor: reportCardThemeColor,
      };
      const optionalReportFields: Record<string, string> = {
        reportTitle: reportCardTitle,
        schoolName: reportCardSchoolName,
        schoolTagline: reportCardSchoolTagline,
        schoolAddress: reportCardAddress,
        schoolLogo: reportCardLogo,
        studentPhoto: reportCardPhoto,
        teacherName: reportCardTeacherName,
        headTeacherName: reportCardHeadTeacherName,
        teacherComment: reportCardTeacherComment,
        reportNotes: reportCardNotes,
      };
      Object.entries(optionalReportFields).forEach(([key, value]) => {
        const trimmedValue = value.trim();
        if (trimmedValue) {
          payload[key] = trimmedValue;
        }
      });

      // Remember the school-wide branding for next time (not the per-student photo).
      saveReportBranding({
        schoolName: reportCardSchoolName.trim(),
        schoolTagline: reportCardSchoolTagline.trim(),
        schoolAddress: reportCardAddress.trim(),
        themeColor: reportCardThemeColor,
        schoolLogo: reportCardLogo,
      });

      const response = await fetch(buildApiUrl(`/api/report-cards/${reportCardStudent.id}.pdf`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Failed to build report card (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportCardStudent.student_id}-${reportCardTerm.replace(/\s+/g, '-').toLowerCase()}-report-card.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setReportCardStudent(null);
    } catch (err: unknown) {
      console.error('Report card download failed:', err);
      notify.error('Could not build the report card', getErrorMessage(err) || undefined);
    } finally {
      setIsBuildingReport(false);
    }
  };

  const downloadIdCards = async (path: string, filename: string) => {
    try {
      const response = await fetch(buildApiUrl(path));
      if (!response.ok) {
        throw new Error(`Failed to build ID cards (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error('ID card download failed:', err);
      notify.error('Could not build the ID cards', getErrorMessage(err) || undefined);
    }
  };

  // The school's own classes, plus any class a student is actually in that the level does not
  // list — so changing the level never makes a student unreachable through the filter.
  const grades = classFilterOptions(settings.school_level, students.map(s => s.grade_level));
  const avgGpa = students.length ? (students.reduce((s, st) => s + (st.gpa || 0), 0) / students.length).toFixed(2) : '0';
  const avgAtt = students.length ? (students.reduce((s, st) => s + (st.attendance_rate || 0), 0) / students.length).toFixed(1) : '0';

  // Not authenticated, or a support staff account that may only see fees status
  if (!canView) {
    return (
      <AccessDenied
        title={isSupportStaff ? 'Restricted to teachers and administrators' : 'Sign in to continue'}
        message={
          isSupportStaff
            ? 'Support staff accounts can only see school fees payment status. Student records are available to teachers and administrators.'
            : 'You need to sign in to open student management. Use the sign-in button in the header.'
        }
        roles={
          isSupportStaff
            ? undefined
            : [
                { icon: UserAdmin, name: 'Administrator', access: 'full access — add, edit and delete' },
                { icon: View, name: 'Teacher', access: 'view only' },
                { icon: Wallet, name: 'Support staff', access: 'fees payment status only' },
              ]
        }
      />
    );
  }

  return (
    <div className={styles.screen}>
      <PageHeader title="Student management" illustration={<UserMultiple size={32} />}>
        {isViewOnly && <Tag type="warm-gray" size="sm" renderIcon={View}>View only</Tag>}
        {isAdmin && <Tag type="blue" size="sm" renderIcon={UserAdmin}>Full access</Tag>}
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Printer}
          onClick={() =>
            downloadIdCards(
              `/api/id-cards.pdf?layout=a4${gradeFilter !== null ? `&grade=${gradeFilter}` : ''}`,
              `student-id-cards${gradeFilter !== null ? `-grade-${gradeFilter}` : ''}.pdf`,
            )
          }
          title="Print QR ID cards for the current grade filter, ten per A4 sheet"
        >
          Print ID cards
        </Button>
        {canEdit && (
          <Button kind="primary" size="sm" renderIcon={Add} onClick={openAdd}>
            Add student
          </Button>
        )}
      </PageHeader>

      <div className={styles.controls}>
        <StatRow>
          <StatTile label="Students" value={students.length} icon={UserMultiple} />
          <StatTile label="Average GPA" value={avgGpa} icon={ChartLine} tone="success" />
          <StatTile label="Average attendance" value={`${avgAtt}%`} icon={Calendar} />
          <StatTile
            label="Active"
            value={students.filter(s => s.status === 'active').length}
            icon={CheckmarkFilled}
            tone="success"
          />
        </StatRow>

        {/* Search and filters */}
        <div className={styles.toolbar}>
          <Search
            id="student-search"
            labelText="Search students"
            placeholder="Search by name, ID, or email…"
            size="lg"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
          />

          <Button kind="tertiary" size="lg" renderIcon={ScanIcon} onClick={() => setScannerOpen(true)}>
            Scan ID
          </Button>

          {/* One grade at a time, which is what the row of buttons did.

              A Dropdown rather than a ContentSwitcher: the switcher is built for a fixed handful of
              options — it types its children as a single element and keeps its own selection state —
              whereas the grade list is whatever grades the school actually has, and is driven from
              gradeFilter. */}
          <Dropdown
            id="grade-filter"
            className={styles.grades}
            size="lg"
            titleText="Grade"
            hideLabel
            label="All classes"
            items={GRADE_ALL_ITEMS.concat(grades.map(option => option.value))}
            selectedItem={gradeFilter === null ? ALL_GRADES : gradeFilter}
            itemToString={(item) =>
              item === ALL_GRADES || item === null
                ? 'All classes'
                : classLabel(settings.school_level, Number(item))
            }
            onChange={({ selectedItem }) =>
              setGradeFilter(selectedItem === ALL_GRADES || selectedItem == null ? null : Number(selectedItem))
            }
          />
        </div>
      </div>

      {/* The roster.

          Carbon's Table primitives rather than its DataTable: this component already owns search,
          the grade filter and sorting, and DataTable wants to own all three through a render prop.
          Handing them over would be a rewrite of working behaviour for no visible gain, so the
          markup becomes Carbon and the logic stays put. */}
      <div className={styles.tableWrap}>
        <Table size="lg" useZebraStyles={false}>
          <TableHead>
            <TableRow>
              {([
                ['Student ID', null],
                ['Name', 'last_name'],
                ['Grade', 'grade_level'],
                ['GPA', 'gpa'],
                ['Attendance', 'attendance_rate'],
                ['Status', 'status'],
                ['Subjects', null],
                ...(canView ? [['Documents', null]] : []),
                ...(canEdit ? [['Actions', null]] : []),
              ] as [string, SortKey | null][]).map(([label, key]) => (
                <TableHeader
                  key={label}
                  isSortable={Boolean(key)}
                  isSortHeader={Boolean(key) && sortKey === key}
                  sortDirection={sortAsc ? 'ASC' : 'DESC'}
                  onClick={key ? () => handleSort(key) : undefined}
                >
                  {label}
                </TableHeader>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7 + (canView ? 1 : 0) + (canEdit ? 1 : 0)}>
                  <div className={styles.empty}>No students match this search.</div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className={styles.mono}>{s.student_id}</TableCell>

                  <TableCell>
                    <div className={styles.name}>{s.first_name} {s.last_name}</div>
                    <div className={styles.sub}>{s.email}</div>
                  </TableCell>

                  <TableCell>
                    <Tag type="cool-gray" size="sm">
                      {classAndSection(settings.school_level, s.grade_level, s.class_section)}
                    </Tag>
                  </TableCell>

                  <TableCell>
                    <span className={styles.gpa} data-band={gpaBand(s.gpa)}>
                      {Number(s.gpa).toFixed(2)}
                    </span>
                  </TableCell>

                  <TableCell>
                    <div className={styles.meterRow}>
                      <span className={styles.meter} data-band={attendanceBand(s.attendance_rate)}>
                        <span style={{ width: `${s.attendance_rate}%` }} />
                      </span>
                      {Number(s.attendance_rate).toFixed(1)}%
                    </div>
                  </TableCell>

                  <TableCell>
                    <Tag type={s.status === 'active' ? 'green' : 'gray'} size="sm">{s.status}</Tag>
                  </TableCell>

                  <TableCell>
                    <div className={styles.subjects}>
                      {(Array.isArray(s.subjects) ? s.subjects : []).slice(0, 3).map((sub, index) => (
                        <Tag key={index} type="outline" size="sm">{sub}</Tag>
                      ))}
                      {(Array.isArray(s.subjects) ? s.subjects : []).length > 3 && (
                        <span className={styles.sub}>+{s.subjects.length - 3}</span>
                      )}
                    </div>
                  </TableCell>

                  {canView && (
                    <TableCell>
                      <div className={styles.rowActions}>
                        <Button kind="ghost" size="sm" onClick={() => openReportCardBuilder(s)}>
                          Report card
                        </Button>
                        <Button kind="ghost" size="sm" onClick={() => setIdCardStudent(s)}>
                          ID card
                        </Button>
                      </div>
                    </TableCell>
                  )}

                  {canEdit && (
                    <TableCell>
                      <div className={styles.rowActions}>
                        <Button
                          hasIconOnly
                          kind="ghost"
                          size="sm"
                          renderIcon={EditIcon}
                          iconDescription="Edit"
                          tooltipPosition="left"
                          onClick={() => openEdit(s)}
                        />
                        <Button
                          hasIconOnly
                          kind="danger--ghost"
                          size="sm"
                          renderIcon={TrashIcon}
                          iconDescription="Delete"
                          tooltipPosition="left"
                          onClick={() => setDeleteConfirm(s.id)}
                        />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <p className={styles.tableFoot}>
          Showing {filtered.length} of {students.length} students
          {isViewOnly && ' (view-only mode)'}
          {isAdmin && ' (admin mode)'}
        </p>
      </div>

      {/* The QR code on a student's plastic card, big enough to test with a phone before a batch
          of ten is printed — which is the whole reason this preview exists. */}
      {idCardStudent && (
        <Modal
          open
          passiveModal
          modalHeading="Student ID card"
          modalLabel={`${idCardStudent.first_name} ${idCardStudent.last_name} · ${idCardStudent.student_id}`}
          onRequestClose={() => setIdCardStudent(null)}
          size="sm"
        >
          <div className={styles.idCard}>
            <img
              src={buildApiUrl(`/api/id-cards/${idCardStudent.id}.png`)}
              alt={`QR code for ${idCardStudent.student_id}`}
              className={styles.qr}
            />
            <p className={styles.modalNote}>
              Point a phone camera at this code to check it scans before printing a batch.
            </p>
            <Button
              renderIcon={Download}
              onClick={() =>
                downloadIdCards(
                  `/api/id-cards/${idCardStudent.id}.pdf`,
                  `${idCardStudent.student_id}-id-card.pdf`,
                )
              }
            >
              Download card PDF
            </Button>
          </div>
        </Modal>
      )}

      <StudentIdScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={code => {
          setSearch(parseStudentCode(code));
          setGradeFilter(null);
          setScannerOpen(false);
        }}
        hint="Scan the QR code on the plastic card to jump straight to that student's record."
      />

      {/* Deleting a student.

          Carbon's danger modal, which brings the destructive button treatment, the focus trap and
          the escape handling that the hand-rolled overlay had to be trusted to get right. */}
      {canEdit && (
        <Modal
          open={Boolean(deleteConfirm)}
          danger
          modalHeading="Delete this student?"
          modalLabel="Student records"
          primaryButtonText="Delete"
          secondaryButtonText="Cancel"
          onRequestSubmit={() => deleteConfirm && handleDelete(deleteConfirm)}
          onRequestClose={() => setDeleteConfirm(null)}
          size="sm"
        >
          <p className={styles.modalCopy}>
            This permanently removes the student record. The deletion is written to the audit trail,
            but the record itself cannot be brought back.
          </p>
        </Modal>
      )}

      {/* Building a report card.
          Every field here overrides a school default; blank means "use the default", which is why
          the placeholders name the default rather than showing an example. */}
      {reportCardStudent && (
        <Modal
          open
          modalHeading="Build a report card"
          modalLabel={`${reportCardStudent.first_name} ${reportCardStudent.last_name} · ${reportCardStudent.student_id}`}
          primaryButtonText={isBuildingReport ? 'Building the PDF…' : 'Download PDF'}
          secondaryButtonText="Cancel"
          primaryButtonDisabled={isBuildingReport}
          onRequestSubmit={handleReportCardDownload}
          onRequestClose={() => !isBuildingReport && setReportCardStudent(null)}
          size="lg"
          hasScrollingContent
        >
          <div className={styles.formStack}>
            <div className={styles.grid2}>
              <Field label="Report name" value={reportCardTitle} onChange={setReportCardTitle} placeholder="Student Report Card" />
              <Field label="School name" value={reportCardSchoolName} onChange={setReportCardSchoolName} placeholder="The school's saved name" />
            </div>

            <Field label="School tagline" value={reportCardSchoolTagline} onChange={setReportCardSchoolTagline} placeholder="The school's saved tagline" />
            <Field label="School address" value={reportCardAddress} onChange={setReportCardAddress} placeholder="P.O. Box 123, Kampala, Uganda" />

            <ColorPicker
              label="Theme colour"
              value={reportCardThemeColor}
              onChange={setReportCardThemeColor}
              hint="Colours the school name, the headings and the results table on the report card."
            />

            <div className={styles.grid2}>
              <ImagePicker label="School logo" value={reportCardLogo} onChange={setReportCardLogo} shape="logo" />
              <ImagePicker label="Student photo" value={reportCardPhoto} onChange={setReportCardPhoto} shape="photo" />
            </div>

            <div className={styles.grid2}>
              <Field
                label="Term"
                value={reportCardTerm}
                onChange={setReportCardTerm}
                options={[
                  { value: 'Term 1', label: 'Term 1' },
                  { value: 'Term 2', label: 'Term 2' },
                  { value: 'Term 3', label: 'Term 3' },
                ]}
              />
              <Field label="Academic year" value={reportCardYear} onChange={setReportCardYear} placeholder="2026/2027" />
            </div>

            <div className={styles.grid2}>
              <Field label="Country / system" value={reportCardGradingCountry} onChange={setReportCardGradingCountry} options={GRADING_COUNTRIES} />
              <Field label="Academic level" value={reportCardAcademicLevel} onChange={setReportCardAcademicLevel} options={ACADEMIC_LEVELS} />
            </div>

            <div className={styles.grid2}>
              <Field label="Class teacher" value={reportCardTeacherName} onChange={setReportCardTeacherName} placeholder="Class Teacher" />
              <Field label="Head teacher" value={reportCardHeadTeacherName} onChange={setReportCardHeadTeacherName} placeholder="Head of School" />
            </div>

            <Field
              label="Teacher comment"
              type="textarea"
              value={reportCardTeacherComment}
              onChange={setReportCardTeacherComment}
              placeholder="Leave blank to generate one from GPA and attendance."
            />

            <Field
              label="Report notes"
              type="textarea"
              value={reportCardNotes}
              onChange={setReportCardNotes}
              placeholder="Leave blank to use the student's saved notes."
            />

            <InlineNotification
              kind="info"
              title="Blank fields use the defaults"
              subtitle="An empty field falls back to the school's saved setting, the generated teacher comment, or the student's own notes."
              lowContrast
              hideCloseButton
            />

            {isBuildingReport && <InlineLoading description="Building the PDF…" />}
          </div>
        </Modal>
      )}

      {/* Adding or editing a student.

          Carbon's Modal owns the overlay, the focus trap, escape-to-close and the button row, so
          the sticky header and footer this had to build by hand are gone. The fields inside are
          already Carbon, through StudentField. */}
      {canEdit && (
        <Modal
          open={showForm}
          modalHeading={editingId ? 'Edit student' : 'Add a student'}
          modalLabel={`Logged as ${user?.display_name ?? 'you'}`}
          primaryButtonText={saving ? 'Saving…' : editingId ? 'Update student' : 'Add student'}
          secondaryButtonText="Cancel"
          primaryButtonDisabled={saving}
          onRequestSubmit={handleSave}
          onRequestClose={() => setShowForm(false)}
          size="lg"
          hasScrollingContent
        >
          <div className={styles.formStack}>
            <ImagePicker
              label="Student photo"
              value={form.photo_url}
              onChange={(value) => setForm(prev => ({ ...prev, photo_url: value }))}
              shape="photo"
              hint="Appears on the student's ID card and report card."
            />

              {/* Basic Info */}
              <div>
                <h4 className={styles.formSection}>Basic information</h4>
                <div className={styles.grid2}>
                  <StudentField form={form} setForm={setForm} errors={errors} label="Student ID" name="student_id" required />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Gender" name="gender" options={[
                    { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }
                  ]} />
                  <StudentField form={form} setForm={setForm} errors={errors} label="First Name" name="first_name" required />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Last Name" name="last_name" required />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Date of Birth" name="date_of_birth" type="date" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Email" name="email" type="email" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Phone" name="phone" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Address" name="address" />
                </div>
              </div>

              {/* Academic Info */}
              <div>
                <h4 className={styles.formSection}>Academic information</h4>
                <div className={styles.grid3}>
                  <StudentField
                    form={form}
                    setForm={setForm}
                    errors={errors}
                    label="Class"
                    name="grade_level"
                    required
                    numeric
                    options={classOptionsFor(settings.school_level).map(option => ({
                      value: String(option.value),
                      label: option.label,
                    }))}
                  />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Section" name="class_section" options={[
                    { value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }
                  ]} />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Status" name="status" options={[
                    { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'graduated', label: 'Graduated' }, { value: 'transferred', label: 'Transferred' }
                  ]} />
                  <StudentField form={form} setForm={setForm} errors={errors} label="GPA (0-4)" name="gpa" type="number" min={0} max={4} step={0.01} />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Attendance Rate (%)" name="attendance_rate" type="number" min={0} max={100} step={0.1} />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Enrollment Date" name="enrollment_date" type="date" />
                </div>
              </div>

              {/* Subjects */}
              <div>
                <h4 className={styles.formSection}>Subjects</h4>
                <div className={styles.subjectEntry}>
                  <TextInput
                    id="subject-input"
                    labelText="Add a subject"
                    hideLabel
                    size="md"
                    value={subjectInput}
                    onChange={e => setSubjectInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSubject();
                      }
                    }}
                    placeholder="Type a subject and press Enter…"
                  />
                  <Button kind="tertiary" size="md" onClick={addSubject}>
                    Add
                  </Button>
                </div>
                <div className={styles.subjects}>
                  {form.subjects.map((sub, i) => (
                    <Tag key={i} type="blue" size="md" filter onClose={() => removeSubject(sub)}>
                      {sub}
                    </Tag>
                  ))}
                  {form.subjects.length === 0 && (
                    <span className={styles.modalNote}>No subjects yet.</span>
                  )}
                </div>
              </div>

              {/* Parent Info */}
              <div>
                <h4 className={styles.formSection}>Parent or guardian</h4>
                <div className={styles.grid3}>
                  <StudentField form={form} setForm={setForm} errors={errors} label="Parent Name" name="parent_name" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Parent Phone" name="parent_phone" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Parent Email" name="parent_email" type="email" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <h4 className={styles.formSection}>Notes</h4>
                <StudentField form={form} setForm={setForm} errors={errors} label="Additional Notes" name="notes" type="textarea" />
              </div>
            </div>

            <p className={styles.modalNote}>
              {editingId
                ? 'Changes are written to the audit trail.'
                : 'The new student is written to the audit trail.'}
            </p>
        </Modal>
      )}
    </div>
  );
};

export default StudentManagement;
