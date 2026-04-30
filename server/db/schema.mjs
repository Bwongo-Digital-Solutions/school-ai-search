import { randomUUID } from 'node:crypto';

import { createSeedStudents } from './seed-data.mjs';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade_level INTEGER NOT NULL,
  class_section TEXT NOT NULL,
  date_of_birth DATE,
  gender TEXT,
  email TEXT,
  phone TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  parent_email TEXT,
  address TEXT,
  enrollment_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  gpa NUMERIC(4, 2) NOT NULL DEFAULT 0,
  attendance_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  blood_group TEXT,
  medical_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'enrolled',
  graduation_date DATE,
  transfer_date DATE,
  alumni_notes TEXT NOT NULL DEFAULT '',
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT ''
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS blood_group TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS medical_record JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'enrolled';
ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS transfer_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS alumni_notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  auth_email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
  avatar_url TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_name TEXT,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admissions (
  id TEXT PRIMARY KEY,
  application_number TEXT NOT NULL UNIQUE,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  applicant_first_name TEXT NOT NULL,
  applicant_last_name TEXT NOT NULL,
  grade_level INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  grade_level INTEGER NOT NULL,
  section_name TEXT NOT NULL,
  stream TEXT,
  room TEXT,
  academic_year TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subjects_catalog (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  grade_level INTEGER,
  department TEXT
);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  department TEXT
);

CREATE TABLE IF NOT EXISTS subject_allocations (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timetables (
  id TEXT PRIMARY KEY,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  room TEXT,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  reason TEXT,
  marked_by TEXT,
  notified_parent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_alerts (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attendance_record_id TEXT REFERENCES attendance_records(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  exam_type TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS exam_schedules (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  exam_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room TEXT
);

CREATE TABLE IF NOT EXISTS gradebook_entries (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id TEXT REFERENCES exams(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  score NUMERIC(6, 2) NOT NULL,
  max_score NUMERIC(6, 2) NOT NULL DEFAULT 100,
  grade TEXT,
  remarks TEXT,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade_level INTEGER,
  student_type TEXT NOT NULL DEFAULT 'day',
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  due_date DATE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_structure_id TEXT REFERENCES fee_structures(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  payment_method TEXT,
  reference TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12, 2) NOT NULL,
  balance_due NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  due_date DATE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('mtn_momo', 'airtel_money', 'bank')),
  charge_type TEXT NOT NULL DEFAULT 'school_fees',
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  phone_number TEXT,
  bank_code TEXT,
  account_reference TEXT,
  external_reference TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  customer_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_accounts (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('parent', 'student')),
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  priority TEXT NOT NULL DEFAULT 'normal',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS internal_messages (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_books (
  id TEXT PRIMARY KEY,
  isbn TEXT,
  title TEXT NOT NULL,
  author TEXT,
  category TEXT,
  copies_total INTEGER NOT NULL DEFAULT 1,
  copies_available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS library_loans (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issued_at DATE NOT NULL,
  due_at DATE NOT NULL,
  returned_at DATE,
  fine_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued'
);

CREATE TABLE IF NOT EXISTS transport_routes (
  id TEXT PRIMARY KEY,
  route_name TEXT NOT NULL,
  bus_number TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  stops JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS transport_assignments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  pickup_point TEXT NOT NULL,
  dropoff_point TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS hostel_rooms (
  id TEXT PRIMARY KEY,
  hostel_name TEXT NOT NULL,
  room_number TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  inventory JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS hostel_assignments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES hostel_rooms(id) ON DELETE CASCADE,
  bed_number TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  location TEXT,
  reorder_level INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('stock_in', 'stock_out', 'adjustment')),
  quantity INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,
  academic_year TEXT,
  term TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_last_name ON students(last_name);
CREATE INDEX IF NOT EXISTS idx_students_grade_level ON students(grade_level);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admissions_status ON admissions(status);
CREATE INDEX IF NOT EXISTS idx_timetables_class_term ON timetables(class_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_gradebook_student_exam ON gradebook_entries(student_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_invoices_student_status ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_student_status ON payment_transactions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_reference ON payment_transactions(provider_reference);
CREATE INDEX IF NOT EXISTS idx_library_loans_student_status ON library_loans(student_id, status);
CREATE INDEX IF NOT EXISTS idx_transport_assignments_student ON transport_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_hostel_assignments_student ON hostel_assignments(student_id);
`;

const STUDENT_COLUMNS = [
  'id',
  'student_id',
  'first_name',
  'last_name',
  'grade_level',
  'class_section',
  'date_of_birth',
  'gender',
  'email',
  'phone',
  'parent_name',
  'parent_phone',
  'parent_email',
  'address',
  'enrollment_date',
  'status',
  'gpa',
  'attendance_rate',
  'subjects',
  'notes',
];

export const initializeDatabase = async (database) => {
  await database.query(SCHEMA_SQL);
  await ensureStudentsSeeded(database);
};

const ensureStudentsSeeded = async (database) => {
  const { rows } = await database.query('SELECT COUNT(*)::int AS count FROM students');
  if ((rows[0]?.count ?? 0) > 0) {
    return;
  }

  const seedStudents = createSeedStudents();

  for (const student of seedStudents) {
    await database.query(
      `
        INSERT INTO students (
          ${STUDENT_COLUMNS.join(', ')}
        ) VALUES (
          ${STUDENT_COLUMNS.map((_, index) => `$${index + 1}`).join(', ')}
        )
      `,
      STUDENT_COLUMNS.map((column) => (column === 'subjects' ? JSON.stringify(student[column]) : student[column])),
    );
  }
};

export const createConversationRecord = (title) => ({
  id: randomUUID(),
  title,
});
