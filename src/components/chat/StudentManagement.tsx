import React, { useState, useMemo } from 'react';
import {
  Search, Plus, Pencil, Trash2, X, ChevronUp, ChevronDown,
  Save, AlertTriangle, Users, GraduationCap, ArrowUpDown, Filter,
  Shield, Lock, Eye, FileText, Download, Loader2, Wallet, ScanLine, QrCode, Printer
} from 'lucide-react';
import StudentIdScanner from './StudentIdScanner';
import { buildApiUrl, supabase } from '@/lib/supabase';
import { parseStudentCode } from '@/lib/studentCode';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import type { Student } from '@/types/chat';

const EMPTY_STUDENT = {
  student_id: '', first_name: '', last_name: '', grade_level: 9,
  class_section: 'A', date_of_birth: '', gender: 'Male', email: '',
  phone: '', parent_name: '', parent_phone: '', parent_email: '',
  address: '', enrollment_date: new Date().toISOString().split('T')[0],
  status: 'active', gpa: 0, attendance_rate: 100, subjects: [] as string[],
  notes: '',
};

type StudentFormState = typeof EMPTY_STUDENT;
type SortKey = 'first_name' | 'last_name' | 'grade_level' | 'gpa' | 'attendance_rate' | 'status';

const GRADING_COUNTRIES = [
  { value: 'international', label: 'International' },
  { value: 'uganda', label: 'Uganda' },
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

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

const StudentField = ({ label, name, form, setForm, errors, type = 'text', required, options, min, max, step }: {
  label: string;
  name: keyof StudentFormState;
  form: StudentFormState;
  setForm: React.Dispatch<React.SetStateAction<StudentFormState>>;
  errors: Record<string, string>;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    {options ? (
      <select
        value={String(form[name])}
        onChange={e => setForm(prev => ({ ...prev, [name]: e.target.value }))}
        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : type === 'textarea' ? (
      <textarea
        value={String(form[name] ?? '')}
        onChange={e => setForm(prev => ({ ...prev, [name]: e.target.value }))}
        rows={3}
        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 resize-none"
      />
    ) : (
      <input
        type={type}
        value={String(form[name] ?? '')}
        onChange={e => setForm(prev => ({
          ...prev,
          [name]: type === 'number' ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value,
        }))}
        min={min} max={max} step={step}
        className={`w-full bg-gray-50 dark:bg-gray-700 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 ${
          errors[name] ? 'border-red-300 dark:border-red-600' : 'border-gray-200 dark:border-gray-600'
        }`}
      />
    )}
    {errors[name] && <p className="text-[10px] text-red-500 mt-0.5">{errors[name]}</p>}
  </div>
);

const StudentManagement: React.FC = () => {
  const { students, refreshStudents } = useChatContext();
  const { user, isAuthenticated, isAdmin, isSupportStaff, logAudit } = useAuth();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last_name');
  const [sortAsc, setSortAsc] = useState(true);
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);
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

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-gray-300" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-indigo-500" /> : <ChevronDown className="w-3 h-3 text-indigo-500" />;
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    if (!form.student_id.trim()) e.student_id = 'Required';
    if (form.grade_level < 0 || form.grade_level > 20) e.grade_level = 'Must be 0-20';
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
        const { data: newStudent, error } = await supabase.from('students').insert(payload).select('id').single();
        if (error) throw error;
        await logAudit('create', newStudent?.id, `${form.first_name} ${form.last_name}`, payload);
      }
      await refreshStudents();
      setShowForm(false);
    } catch (err: unknown) {
      console.error('Save failed:', err);
      alert('Failed to save student: ' + getErrorMessage(err));
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
      alert('Failed to delete student: ' + getErrorMessage(err));
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
    setReportCardStudent(student);
    setReportCardTerm('Term 1');
    setReportCardYear(getDefaultAcademicYear());
    setReportCardAcademicLevel(inferAcademicLevel(student.grade_level));
    setReportCardGradingCountry('international');
    setReportCardTitle('');
    setReportCardSchoolName('');
    setReportCardSchoolTagline('');
    setReportCardTeacherName('');
    setReportCardHeadTeacherName('');
    setReportCardTeacherComment('');
    setReportCardNotes(student.notes || '');
  };

  const handleReportCardDownload = async () => {
    if (!reportCardStudent) return;

    setIsBuildingReport(true);
    try {
      const params = new URLSearchParams({
        term: reportCardTerm,
        academicYear: reportCardYear,
        gradingCountry: reportCardGradingCountry,
        academicLevel: reportCardAcademicLevel,
      });
      const optionalReportFields = {
        reportTitle: reportCardTitle,
        schoolName: reportCardSchoolName,
        schoolTagline: reportCardSchoolTagline,
        teacherName: reportCardTeacherName,
        headTeacherName: reportCardHeadTeacherName,
        teacherComment: reportCardTeacherComment,
        reportNotes: reportCardNotes,
      };
      Object.entries(optionalReportFields).forEach(([key, value]) => {
        const trimmedValue = value.trim();
        if (trimmedValue) {
          params.set(key, trimmedValue);
        }
      });

      const response = await fetch(buildApiUrl(`/api/report-cards/${reportCardStudent.id}.pdf?${params.toString()}`));
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
      alert(getErrorMessage(err) || 'Failed to build report card.');
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
      alert(getErrorMessage(err) || 'Failed to build ID cards.');
    }
  };

  const grades = Array.from(new Set([...students.map(s => s.grade_level), 9, 10, 11, 12])).sort((a, b) => a - b);
  const avgGpa = students.length ? (students.reduce((s, st) => s + (st.gpa || 0), 0) / students.length).toFixed(2) : '0';
  const avgAtt = students.length ? (students.reduce((s, st) => s + (st.attendance_rate || 0), 0) / students.length).toFixed(1) : '0';

  // Not authenticated, or a support staff account that may only see fees status
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900 p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-indigo-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">
            {isSupportStaff ? 'Restricted to Teachers and Admins' : 'Authentication Required'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {isSupportStaff
              ? 'Support staff accounts can only view school fees payment status. Student records are available to teachers and administrators.'
              : 'You need to sign in to access the Student Management panel. Please use the Sign In button in the header to continue.'}
          </p>
          {!isSupportStaff && (
            <>
              <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-purple-500" />
                  <span><strong>Admin</strong> — Full access (add, edit, delete)</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mt-2">
                <div className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-blue-500" />
                  <span><strong>Teacher</strong> — View-only access</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mt-2">
                <div className="flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-emerald-500" />
                  <span><strong>Support Staff</strong> — Fees payment status only</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      {/* Top Stats */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-indigo-500" />
              Student Management
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-gray-400">Manage student records — changes sync with AI assistant automatically</p>
              {isViewOnly && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                  <Eye className="w-2.5 h-2.5" /> View Only
                </span>
              )}
              {isAdmin && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                  <Shield className="w-2.5 h-2.5" /> Full Access
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                downloadIdCards(
                  `/api/id-cards.pdf?layout=a4${gradeFilter !== null ? `&grade=${gradeFilter}` : ''}`,
                  `student-id-cards${gradeFilter !== null ? `-grade-${gradeFilter}` : ''}.pdf`,
                )
              }
              title="Print QR ID cards for the current grade filter, ten per A4 sheet"
              className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Printer className="w-4 h-4 text-emerald-500" />
              Print ID Cards
            </button>
            {canEdit && (
              <button
                onClick={openAdd}
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl px-4 py-2.5 text-sm font-medium hover:shadow-lg hover:shadow-indigo-200 dark:hover:shadow-indigo-900/30 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" /> Add Student
              </button>
            )}
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Total Students</p>
            <p className="text-2xl font-bold text-indigo-600">{students.length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Avg GPA</p>
            <p className="text-2xl font-bold text-emerald-600">{avgGpa}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Avg Attendance</p>
            <p className="text-2xl font-bold text-purple-600">{avgAtt}%</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Active</p>
            <p className="text-2xl font-bold text-blue-600">{students.filter(s => s.status === 'active').length}</p>
          </div>
        </div>

        {/* Search & Filter bar */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, ID, or email..."
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            />
          </div>
          <button
            onClick={() => setScannerOpen(true)}
            title="Scan a student ID card"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <ScanLine className="w-4 h-4 text-indigo-500" />
            Scan ID
          </button>
          <div className="flex items-center gap-1">
            <Filter className="w-4 h-4 text-gray-400" />
            <button
              onClick={() => setGradeFilter(null)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                gradeFilter === null ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'
              }`}
            >All</button>
            {grades.map(g => (
              <button
                key={g}
                onClick={() => setGradeFilter(gradeFilter === g ? null : g)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  gradeFilter === g ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'
                }`}
              >G{g}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-750 border-b border-gray-100 dark:border-gray-700">
                {([
                  ['Student ID', null],
                  ['Name', 'last_name'],
                  ['Grade', 'grade_level'],
                  ['GPA', 'gpa'],
                  ['Attendance', 'attendance_rate'],
                  ['Status', 'status'],
                  ['Subjects', null],
                  ...(canView ? [['Report Card', null]] : []),
                  ...(canEdit ? [['Actions', null]] : []),
                ] as [string, SortKey | null][]).map(([label, key]) => (
                  <th
                    key={label}
                    onClick={key ? () => handleSort(key) : undefined}
                    className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 ${key ? 'cursor-pointer hover:text-indigo-600 select-none' : ''}`}
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {key && <SortIcon col={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7 + (canView ? 1 : 0) + (canEdit ? 1 : 0)} className="text-center py-12 text-gray-400">
                    <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                    <p className="text-sm">No students found</p>
                  </td>
                </tr>
              ) : filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors group">
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">{s.student_id}</td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-800 dark:text-white">{s.first_name} {s.last_name}</p>
                      <p className="text-[10px] text-gray-400">{s.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full px-2 py-0.5 text-xs font-medium">
                      <GraduationCap className="w-3 h-3" /> {s.grade_level}-{s.class_section}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold text-xs ${
                      s.gpa >= 3.5 ? 'text-emerald-600' : s.gpa >= 3.0 ? 'text-blue-600' : s.gpa >= 2.5 ? 'text-amber-600' : 'text-red-500'
                    }`}>{Number(s.gpa).toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.attendance_rate >= 95 ? 'bg-emerald-500' : s.attendance_rate >= 90 ? 'bg-blue-500' : s.attendance_rate >= 85 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${s.attendance_rate}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{Number(s.attendance_rate).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      s.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-500'
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                      {(Array.isArray(s.subjects) ? s.subjects : []).slice(0, 3).map((sub, i) => (
                        <span key={i} className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded px-1.5 py-0.5 text-[10px]">{sub}</span>
                      ))}
                      {(Array.isArray(s.subjects) ? s.subjects : []).length > 3 && (
                        <span className="text-[10px] text-gray-400">+{s.subjects.length - 3}</span>
                      )}
                    </div>
                  </td>
                  {canView && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openReportCardBuilder(s)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                          title="Build report card PDF"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          PDF
                        </button>
                        <button
                          onClick={() => setIdCardStudent(s)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                          title="Preview and print the QR ID card"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          ID
                        </button>
                      </div>
                    </td>
                  )}
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-gray-400 hover:text-indigo-600 transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteConfirm(s.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-400 mt-2 px-1">
          Showing {filtered.length} of {students.length} students
          {isViewOnly && ' (view-only mode)'}
          {isAdmin && ' (admin mode)'}
        </p>
      </div>

      {/* ID Card Preview */}
      {idCardStudent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setIdCardStudent(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <QrCode className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-white">Student ID Card</h3>
                <p className="text-xs text-gray-400">
                  {idCardStudent.first_name} {idCardStudent.last_name} • {idCardStudent.student_id}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 rounded-xl p-4">
              <img
                src={buildApiUrl(`/api/id-cards/${idCardStudent.id}.png`)}
                alt={`QR code for ${idCardStudent.student_id}`}
                className="w-44 h-44 bg-white rounded-lg"
              />
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 text-center">
                Point a phone camera at this code to check it scans before printing a batch.
              </p>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setIdCardStudent(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Close
              </button>
              <button
                onClick={() =>
                  downloadIdCards(
                    `/api/id-cards/${idCardStudent.id}.pdf`,
                    `${idCardStudent.student_id}-id-card.pdf`,
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:shadow-lg transition-all"
              >
                <Download className="w-4 h-4" /> Card PDF
              </button>
            </div>
          </div>
        </div>
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

      {/* Delete Confirmation Modal */}
      {deleteConfirm && canEdit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-white">Delete Student</h3>
                <p className="text-xs text-gray-400">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to permanently delete this student record? This action will be logged in the audit trail.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Report Card Modal */}
      {reportCardStudent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !isBuildingReport && setReportCardStudent(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-white">Build PDF Report Card</h3>
                <p className="text-xs text-gray-400">
                  {reportCardStudent.first_name} {reportCardStudent.last_name} • {reportCardStudent.student_id}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Report Name</label>
                  <input
                    type="text"
                    value={reportCardTitle}
                    onChange={e => setReportCardTitle(e.target.value)}
                    placeholder="Student Report Card"
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">School Name</label>
                  <input
                    type="text"
                    value={reportCardSchoolName}
                    onChange={e => setReportCardSchoolName(e.target.value)}
                    placeholder="Default school name"
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">School Tagline</label>
                <input
                  type="text"
                  value={reportCardSchoolTagline}
                  onChange={e => setReportCardSchoolTagline(e.target.value)}
                  placeholder="Default school tagline"
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Term</label>
                <select
                  value={reportCardTerm}
                  onChange={e => setReportCardTerm(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                >
                  <option value="Term 1">Term 1</option>
                  <option value="Term 2">Term 2</option>
                  <option value="Term 3">Term 3</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Academic Year</label>
                <input
                  type="text"
                  value={reportCardYear}
                  onChange={e => setReportCardYear(e.target.value)}
                  placeholder="2026/2027"
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Country / System</label>
                  <select
                    value={reportCardGradingCountry}
                    onChange={e => setReportCardGradingCountry(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  >
                    {GRADING_COUNTRIES.map(country => (
                      <option key={country.value} value={country.value}>{country.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Academic Level</label>
                  <select
                    value={reportCardAcademicLevel}
                    onChange={e => setReportCardAcademicLevel(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  >
                    {ACADEMIC_LEVELS.map(level => (
                      <option key={level.value} value={level.value}>{level.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Class Teacher Name</label>
                  <input
                    type="text"
                    value={reportCardTeacherName}
                    onChange={e => setReportCardTeacherName(e.target.value)}
                    placeholder="Class Teacher"
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Head Teacher Name</label>
                  <input
                    type="text"
                    value={reportCardHeadTeacherName}
                    onChange={e => setReportCardHeadTeacherName(e.target.value)}
                    placeholder="Head of School"
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Teacher Comment</label>
                <textarea
                  value={reportCardTeacherComment}
                  onChange={e => setReportCardTeacherComment(e.target.value)}
                  rows={3}
                  placeholder="Leave blank to generate a default comment from GPA and attendance."
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Report Notes</label>
                <textarea
                  value={reportCardNotes}
                  onChange={e => setReportCardNotes(e.target.value)}
                  rows={3}
                  placeholder="Leave blank to use the student's saved notes."
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none"
                />
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-3 py-3">
                <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                  Blank fields use the school defaults, generated teacher comment, or the student's saved notes.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setReportCardStudent(null)}
                disabled={isBuildingReport}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReportCardDownload}
                disabled={isBuildingReport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg transition-all disabled:opacity-50"
              >
                {isBuildingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isBuildingReport ? 'Building PDF...' : 'Download PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && canEdit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Form Header */}
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                  {editingId ? 'Edit Student' : 'Add New Student'}
                </h3>
                <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                  <Shield className="w-2.5 h-2.5 text-purple-500" />
                  Logged as {user?.display_name} (Admin)
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Basic Info */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Basic Information</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Academic Information</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StudentField form={form} setForm={setForm} errors={errors} label="Class / Grade Level" name="grade_level" type="number" required min={0} max={20} />
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
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Subjects</h4>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={subjectInput}
                    onChange={e => setSubjectInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubject(); } }}
                    placeholder="Type a subject and press Enter..."
                    className="flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                  />
                  <button onClick={addSubject} className="px-3 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-200 transition-colors">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.subjects.map((sub, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg px-2.5 py-1 text-xs">
                      {sub}
                      <button onClick={() => removeSubject(sub)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {form.subjects.length === 0 && <span className="text-xs text-gray-400">No subjects added yet</span>}
                </div>
              </div>

              {/* Parent Info */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Parent / Guardian</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StudentField form={form} setForm={setForm} errors={errors} label="Parent Name" name="parent_name" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Parent Phone" name="parent_phone" />
                  <StudentField form={form} setForm={setForm} errors={errors} label="Parent Email" name="parent_email" type="email" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Notes</h4>
                <StudentField form={form} setForm={setForm} errors={errors} label="Additional Notes" name="notes" type="textarea" />
              </div>
            </div>

            {/* Form Footer */}
            <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-b-2xl">
              <p className="text-[10px] text-gray-400">
                {editingId ? 'Changes will be logged in the audit trail' : 'New student will be logged in the audit trail'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium hover:shadow-lg transition-all disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : editingId ? 'Update Student' : 'Add Student'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentManagement;
