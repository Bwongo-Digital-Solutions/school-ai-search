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
-- Passport photo as a base64 data URL, uploaded on the student form and reused on ID cards and
-- report cards so it is captured once rather than per document.
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  auth_email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'support_staff')),
  avatar_url TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Non-admin signups need administrator approval before they can sign in. The default is
-- 'approved' so existing accounts are grandfathered in on migration; the signup handler is the
-- only writer for new accounts and sets this explicitly ('approved' for the first/admin account,
-- 'pending' otherwise). A rejected account is deleted outright, so only 'pending' and 'approved'
-- are ever stored.
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';

-- Widen the role list on databases created before 'support_staff' (non-teaching staff) existed.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'teacher', 'support_staff'));

-- The school's global identity: one row (id = 'default'), edited by an admin under Settings and
-- read by every document (report cards, ID cards, receipts, statements, finance reports) and the
-- app header. In a multi-tenant deployment each tenant database carries its own row.
CREATE TABLE IF NOT EXISTS school_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  school_name TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  theme_color TEXT NOT NULL DEFAULT '#2952a3',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
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

CREATE TABLE IF NOT EXISTS discipline_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  incident_date DATE NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor',
  description TEXT NOT NULL,
  action_taken TEXT,
  reported_by TEXT,
  guardian_notified BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_promotions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_grade_level INTEGER NOT NULL,
  from_class_section TEXT,
  to_grade_level INTEGER NOT NULL,
  to_class_section TEXT,
  academic_year TEXT NOT NULL,
  effective_date DATE NOT NULL,
  decision TEXT NOT NULL DEFAULT 'promoted',
  notes TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_transfers (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('transfer', 'withdrawal')),
  effective_date DATE NOT NULL,
  destination_school TEXT,
  reason TEXT NOT NULL DEFAULT '',
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_by TEXT,
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

-- A tier that has already produced invoices is archived rather than deleted, so historical
-- invoices keep pointing at the terms they were actually raised under.
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

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

-- total_amount stays NET of any bursary so every existing reader (the fee-status aggregation,
-- resolveFeeStatus, the gateway's balance arithmetic) keeps working untouched. gross_amount and
-- discount_total are carried alongside purely for reporting.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fee_structure_id TEXT REFERENCES fee_structures(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS academic_year TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS term TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_total NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
-- NULL for hand-made invoices, '<fee_structure_id>:<student_id>' for generated ones. A unique
-- index permits unlimited NULLs, so this makes a billing run idempotent — re-running it cannot
-- double-bill anyone, even if two admins press the button at the same moment.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_key TEXT;

-- Declared after invoices exists, since it points at them. Without this link the rating cannot
-- tell whether a family paid on time, only that money arrived at some point.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS student_id TEXT REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS issued_by TEXT;

-- Scholarships, sponsorships and sibling discounts. A NULL fee_structure_id, academic_year or
-- term is a wildcard, so a whole-school hardship grant is a single row.
CREATE TABLE IF NOT EXISTS fee_bursaries (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sponsor TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  fee_structure_id TEXT REFERENCES fee_structures(id) ON DELETE SET NULL,
  academic_year TEXT,
  term TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  notes TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An admin's manual override of the computed payment rating. Kept as an event log rather than
-- columns on students for three reasons: superseded rows are the audit trail; students is loaded
-- wholesale into the AI chat prompt, and a note like "guardian disputes the bill" must never go
-- there; and the students table stays untouched.
CREATE TABLE IF NOT EXISTS student_fee_standings (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  standing TEXT NOT NULL CHECK (standing IN ('excellent', 'good', 'fair', 'watch', 'delinquent')),
  note TEXT NOT NULL DEFAULT '',
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleared')),
  set_by TEXT NOT NULL DEFAULT '',
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_by TEXT,
  cleared_at TIMESTAMPTZ
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
CREATE INDEX IF NOT EXISTS idx_discipline_student_date ON discipline_records(student_id, incident_date);
CREATE INDEX IF NOT EXISTS idx_promotions_student_year ON student_promotions(student_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_transfers_student_type ON student_transfers(student_id, movement_type);
CREATE INDEX IF NOT EXISTS idx_invoices_student_status ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_student_status ON payment_transactions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_reference ON payment_transactions(provider_reference);
CREATE INDEX IF NOT EXISTS idx_library_loans_student_status ON library_loans(student_id, status);
CREATE INDEX IF NOT EXISTS idx_transport_assignments_student ON transport_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_hostel_assignments_student ON hostel_assignments(student_id);
-- Enforces "one live override per student"; superseded rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_fee_standings_active
  ON student_fee_standings(student_id) WHERE status = 'active';
-- Backs billing-run idempotency. NULLs are unconstrained, so hand-made invoices are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_billing_key ON invoices(billing_key);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_fee_structure ON invoices(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_paid_at ON payments(student_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_fee_bursaries_student_status ON fee_bursaries(student_id, status);
CREATE INDEX IF NOT EXISTS idx_student_fee_standings_student ON student_fee_standings(student_id, status);
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
  await ensureSchoolSettingsSeeded(database);
  await ensureAttendanceUniqueness(database);
};

// One attendance record per student per day. Created here (not in SCHEMA_SQL) and guarded, so a
// database that already holds duplicate rows logs a warning and keeps booting instead of failing;
// the write path also upserts, so new duplicates cannot be created.
const ensureAttendanceUniqueness = async (database) => {
  try {
    await database.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance_records(student_id, attendance_date)',
    );
  } catch (error) {
    console.warn(
      'Skipped the unique attendance index — duplicate (student, date) rows exist. Clean them up to enforce it:',
      error instanceof Error ? error.message : error,
    );
  }
};

// Guarantee the single settings row exists, seeded from the school's env branding so an existing
// deployment keeps its identity until an admin edits it under Settings.
const ensureSchoolSettingsSeeded = async (database) => {
  const { rows } = await database.query("SELECT COUNT(*)::int AS count FROM school_settings WHERE id = 'default'");
  if ((rows[0]?.count ?? 0) > 0) {
    return;
  }

  await database.query(
    `
      INSERT INTO school_settings (id, school_name, tagline, address)
      VALUES ('default', $1, $2, $3)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      process.env.SCHOOL_NAME || '',
      process.env.SCHOOL_TAGLINE || '',
      process.env.SCHOOL_ADDRESS || '',
    ],
  );
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
