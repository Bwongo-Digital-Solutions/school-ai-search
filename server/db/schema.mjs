import { randomUUID } from 'node:crypto';

import { createSeedStudents } from './seed-data.mjs';
import { ensureCurriculumSeeded } from '../rag/seed-corpus.mjs';

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

-- A staff member's specialisation within their role, which decides what a student ID scan
-- reveals to them: an admin may keep the books (bursar), and support staff split into the
-- gate (askari), the dormitories (matron) and the kitchen (cook). NULL means the role carries
-- no specialisation, which is how every account created before this migration reads.
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_designation_check;
ALTER TABLE users ADD CONSTRAINT users_designation_check
  CHECK (designation IS NULL OR designation IN ('bursar', 'askari', 'matron', 'cook'));


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

-- The school's academic level, set once by an administrator, which decides the grading system every
-- report card uses: development descriptors for the early years, PLE/UCE aggregate points and
-- divisions for primary and O-Level, principal letter grades for A-Level, and a GPA for tertiary.
-- 'secondary' resolves to two different scales depending on the student's own grade, because one
-- secondary school runs both O-Level and A-Level. Defaults to 'secondary' so an existing database
-- keeps grading exactly as it did before this column existed.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_level TEXT NOT NULL DEFAULT 'secondary';
ALTER TABLE school_settings DROP CONSTRAINT IF EXISTS school_settings_level_check;
ALTER TABLE school_settings ADD CONSTRAINT school_settings_level_check
  CHECK (school_level IN ('pre_school', 'kindergarten', 'primary', 'secondary', 'technical', 'tertiary'));

-- Which national examination system the level maps onto. Uganda schools grade on UNEB scales;
-- international schools and institutions report a GPA. Kept separate from school_level because the
-- two are independent: an international primary school and a Ugandan one are both 'primary'.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS grading_country TEXT NOT NULL DEFAULT 'uganda';

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

-- The curriculum corpus that grounds the Lesson Planner and the Digital Examiner. A document is
-- either one of the bundled topic outlines (source_type 'seed'), a file a teacher uploaded, or
-- something pulled in over MCP. content_hash makes re-ingesting idempotent: an unchanged upload is
-- recognised and skipped rather than duplicating every chunk.
CREATE TABLE IF NOT EXISTS curriculum_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  curriculum TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  grade_level INTEGER,
  academic_year TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('seed', 'upload', 'mcp')),
  source_uri TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'text/markdown',
  content_hash TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One retrievable passage. curriculum/subject/grade_level are denormalised from the parent so the
-- metadata filter runs without a join, and embedding holds a plain JSONB float array rather than a
-- pgvector column: pg-mem backs both the test suite and the Vercel demo and supports no extensions,
-- and a single school's corpus is small enough to rank in Node. embedding is NULL when no embedding
-- provider is configured, which is the normal case — retrieval then falls back to BM25.
CREATE TABLE IF NOT EXISTS curriculum_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES curriculum_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  heading TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding JSONB,
  embedding_model TEXT,
  curriculum TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  grade_level INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- External MCP servers an admin has registered. auth_token is stored plaintext, the same posture as
-- the provider API keys that already live in the environment, but it is never returned to the
-- browser: the settings handler masks it on every read and only overwrites it when a new value is
-- supplied. discovered_tools caches the last successful tools/list so the chat can render the tool
-- menu without a round trip to the server on every page load.
-- A school's own AI provider credentials, overriding the platform's for that school only.
--
-- One deployment now serves many schools, and the provider keys were process-global: every school
-- spent the operator's Anthropic budget and could not bring its own. A row here overrides the
-- environment for one school; no row means it inherits the platform's.
--
-- api_key is stored encrypted (AES-256-GCM under SECRETS_KEY), not merely masked on read: a tenant
-- database dump is a normal operational artefact — backups, a support copy — and it must not hand
-- over the school's key. base_url is not secret and is stored plainly.
CREATE TABLE IF NOT EXISTS provider_credentials (
  provider TEXT PRIMARY KEY,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  auth_token TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL DEFAULT 'http' CHECK (transport IN ('http')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  discovered_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Which staff record this login teaches under. A login and a teacher record were previously
-- joinable only by hoping auth_email and teachers.email matched, which nothing checked and nothing
-- maintained; this makes the link a real one. NULL until the account is given something to teach.
ALTER TABLE users ADD COLUMN IF NOT EXISTS teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS subject_allocations (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL
);

-- A class here is the (grade, section) pair the register already works in — the same definition
-- roll call uses, taken off the students themselves. The classes table is the other, unpopulated
-- notion of a class; class_id stays available for schools that fill it, but nothing has to for an
-- allocation to be complete.
ALTER TABLE subject_allocations ADD COLUMN IF NOT EXISTS grade_level INTEGER;
ALTER TABLE subject_allocations ADD COLUMN IF NOT EXISTS class_section TEXT;

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

-- Lesson Planner. One row per lesson a teacher plans, generated against the curriculum corpus and
-- then edited freely — the generated version is a first draft, not a finished artefact, so every
-- field stays editable, and refs records which syllabus passages the draft came from.
-- activities holds the lesson's shape: [{stage, minutes, teacher_activity, learner_activity}].
CREATE TABLE IF NOT EXISTS lesson_plans (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  curriculum TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  grade_level INTEGER,
  topic TEXT NOT NULL DEFAULT '',
  subtopic TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  lesson_date DATE,
  period TEXT NOT NULL DEFAULT '',
  competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  activities JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment JSONB NOT NULL DEFAULT '[]'::jsonb,
  differentiation TEXT NOT NULL DEFAULT '',
  homework TEXT NOT NULL DEFAULT '',
  -- The retrieval citations this plan was grounded in. Named refs, not references, because
  -- REFERENCES is a SQL reserved word and would need quoting at every single use site.
  refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'delivered')),
  generated_by JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Digital Examiner. A blueprint is the teacher's fine-tuning object: it fixes the curriculum, the
-- year, subject and grade, and the shape of the paper (how marks split across topics, difficulty,
-- Bloom levels and question types). Generation reads it; nothing else does.
CREATE TABLE IF NOT EXISTS exam_blueprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  curriculum TEXT NOT NULL DEFAULT '',
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  grade_level INTEGER,
  academic_year TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  paper_label TEXT NOT NULL DEFAULT '',
  assessment_type TEXT NOT NULL DEFAULT 'exam'
    CHECK (assessment_type IN ('quiz', 'assignment', 'test', 'exam', 'mock')),
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  total_marks INTEGER NOT NULL DEFAULT 100,
  topic_weights JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  bloom_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  question_type_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The reusable question bank. Questions outlive the paper they were generated for, so a blueprint
-- can be deleted without losing them, and a teacher can approve once and reuse for years.
-- source_references holds the retrieval citations the question was grounded in, which is what makes
-- a generated question auditable against the syllabus rather than taken on trust.
CREATE TABLE IF NOT EXISTS exam_questions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT REFERENCES exam_blueprints(id) ON DELETE SET NULL,
  curriculum TEXT NOT NULL DEFAULT '',
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  grade_level INTEGER,
  topic TEXT NOT NULL DEFAULT '',
  subtopic TEXT NOT NULL DEFAULT '',
  question_type TEXT NOT NULL DEFAULT 'short_answer',
  difficulty TEXT NOT NULL DEFAULT 'moderate' CHECK (difficulty IN ('easy', 'moderate', 'challenging')),
  bloom_level TEXT NOT NULL DEFAULT 'understand',
  command_word TEXT NOT NULL DEFAULT '',
  stem TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer TEXT NOT NULL DEFAULT '',
  marking_scheme JSONB NOT NULL DEFAULT '[]'::jsonb,
  marks INTEGER NOT NULL DEFAULT 1,
  expected_time_minutes INTEGER NOT NULL DEFAULT 2,
  assessment_objective TEXT NOT NULL DEFAULT '',
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  review_notes TEXT NOT NULL DEFAULT '',
  generated_by JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An assembled paper. exam_id is NULL until it is published, at which point a real row is written
-- into exams (and exam_schedules) so the rest of the school system — timetabling, the gradebook,
-- report cards — sees it as any other exam. ON DELETE SET NULL so removing the exam leaves the
-- paper itself intact as a draft.
CREATE TABLE IF NOT EXISTS generated_papers (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT REFERENCES exam_blueprints(id) ON DELETE SET NULL,
  exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  curriculum TEXT NOT NULL DEFAULT '',
  subject_id TEXT REFERENCES subjects_catalog(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  grade_level INTEGER,
  academic_year TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  assessment_type TEXT NOT NULL DEFAULT 'exam',
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  total_marks INTEGER NOT NULL DEFAULT 100,
  instructions TEXT NOT NULL DEFAULT '',
  question_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Who a message is for. It was one named recipient; a staff room also needs "every teacher",
-- "the gate" and "everybody", so the audience is a kind and a value: 'user' with the
-- recipient_user_id above, 'role' or 'designation' with the group named in audience_value, or
-- 'all'. Existing rows are direct messages, which is what the defaults say.
ALTER TABLE internal_messages ADD COLUMN IF NOT EXISTS audience_kind TEXT NOT NULL DEFAULT 'user';
ALTER TABLE internal_messages DROP CONSTRAINT IF EXISTS internal_messages_audience_check;
ALTER TABLE internal_messages ADD CONSTRAINT internal_messages_audience_check
  CHECK (audience_kind IN ('user', 'role', 'designation', 'all'));
ALTER TABLE internal_messages ADD COLUMN IF NOT EXISTS audience_value TEXT NOT NULL DEFAULT '';
-- Denormalised so a message still says who sent it after the account is deleted.
ALTER TABLE internal_messages ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '';
ALTER TABLE internal_messages ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
-- 'message' is staff writing to each other; 'event' is the system reporting something that
-- happened. They share a feed because the bell is one bell.
ALTER TABLE internal_messages ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'message';

-- Read state per person, because one message now reaches many. The row on
-- internal_messages could only ever describe a single reader.
CREATE TABLE IF NOT EXISTS internal_message_reads (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES internal_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- One row per movement through the school gate, written when the askari scans an ID card.
-- The authoriser is the person who permitted the movement (a parent, the matron, a teacher)
-- and is recorded as free text, because that person is often not a system user.
CREATE TABLE IF NOT EXISTS gate_passes (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  authorised_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permission for a student to leave, granted ahead of time by a teacher, the matron or an
-- administrator. The gate does not grant permission, it checks one: the askari scans the card,
-- reads who allowed the trip and where the student is going, and then approves or declines.
-- Separating the two means the person at the gate is never the person authorising the exit.
CREATE TABLE IF NOT EXISTS gate_permissions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL DEFAULT '',
  granted_by_email TEXT NOT NULL DEFAULT '',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  expected_return DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'declined', 'cancelled')),
  closed_at TIMESTAMPTZ,
  closed_by TEXT NOT NULL DEFAULT '',
  decline_reason TEXT NOT NULL DEFAULT ''
);

-- The gate's own verdict on a movement. A declined attempt is still recorded — a student turned
-- back at the gate is exactly the event a security log exists to capture — so presence is read
-- from approved movements only. Defaults to 'approved' so movements written before the gate
-- could decline continue to read as approved.
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE gate_passes DROP CONSTRAINT IF EXISTS gate_passes_decision_check;
ALTER TABLE gate_passes ADD CONSTRAINT gate_passes_decision_check
  CHECK (decision IN ('approved', 'declined'));
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS permission_id TEXT
  REFERENCES gate_permissions(id) ON DELETE SET NULL;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS destination TEXT NOT NULL DEFAULT '';
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

-- Permission to sit an examination, granted by the bursar or an administrator once the
-- student's obligations are settled. The invigilator does not grant clearance, they check
-- one: they scan at the exam room door and admit or turn the student away.
CREATE TABLE IF NOT EXISTS exam_clearances (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  note TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL DEFAULT '',
  granted_by_email TEXT NOT NULL DEFAULT '',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT NOT NULL DEFAULT ''
);

-- The invigilator's verdict at the exam room door. A rejection is recorded rather than
-- dropped, so a student turned away can be accounted for afterwards.
CREATE TABLE IF NOT EXISTS exam_admissions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL,
  clearance_id TEXT REFERENCES exam_clearances(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per meal a student has actually been served, written when the cook scans an ID
-- card at the serving point. The absence of a row is what "has not eaten" means, so the
-- unique index is what stops a second helping being recorded as a first.
CREATE TABLE IF NOT EXISTS meal_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  meal_date DATE NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'supper')),
  served_by TEXT NOT NULL DEFAULT '',
  served_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS meal_records_student_meal_idx
  ON meal_records (student_id, meal_date, meal);

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
-- The gate polls its pending list every minute and only ever wants the active slips.
CREATE INDEX IF NOT EXISTS idx_gate_permissions_status ON gate_permissions(status, granted_at DESC);
-- Backs the metadata narrowing that retrieval does before it ranks anything in Node.
CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_filter ON curriculum_chunks(curriculum, subject, grade_level);
CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_document ON curriculum_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_curriculum_documents_lookup ON curriculum_documents(curriculum, subject);
-- Backs the question bank's default listing: "approved questions for this subject and grade".
CREATE INDEX IF NOT EXISTS idx_exam_questions_bank ON exam_questions(subject_id, grade_level, status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_topic ON exam_questions(curriculum, topic);
CREATE INDEX IF NOT EXISTS idx_exam_questions_blueprint ON exam_questions(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_generated_papers_status ON generated_papers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_blueprints_subject ON exam_blueprints(subject_id, grade_level);
-- Backs a teacher's "my plans" listing and the scheme-of-work sequence for a term.
CREATE INDEX IF NOT EXISTS idx_lesson_plans_owner ON lesson_plans(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_scope ON lesson_plans(subject_id, grade_level, academic_year, term);
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

export const initializeDatabase = async (database, { httpClient = fetch } = {}) => {
  await database.query(SCHEMA_SQL);
  await ensureStudentsSeeded(database);
  await ensureSchoolSettingsSeeded(database);
  await ensureAttendanceUniqueness(database);
  await ensureMessageReadUniqueness(database);
  await ensureMessageIndexes(database);
  await seedCurriculumCorpus(database, httpClient);
};

// The bundled curriculum outlines. Guarded rather than awaited bare, because seeding may reach an
// embedding provider: a network failure there must not stop the server from booting, and the
// corpus still works lexically with no embeddings at all.
const seedCurriculumCorpus = async (database, httpClient) => {
  try {
    await ensureCurriculumSeeded(database, { httpClient });
  } catch (error) {
    console.warn(
      'Skipped seeding the curriculum corpus; the Lesson Planner and Digital Examiner will start empty:',
      error instanceof Error ? error.message : error,
    );
  }
};

/**
 * One attendance record per student per day.
 *
 * Created here rather than in SCHEMA_SQL and guarded, so a database that already holds duplicate
 * rows logs a warning and keeps booting instead of failing outright. The write path upserts on the
 * same key (see `conflictTarget` on attendance_records in local-backend.mjs), which is what stops
 * new duplicates — but that upsert needs this index to exist, so a database with duplicates cannot
 * record attendance until they are cleaned up. The warning says so.
 */
/** One read per person per message; re-reading is a no-op rather than a duplicate row. */
const ensureMessageReadUniqueness = async (database) => {
  try {
    await database.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_read_unique ON internal_message_reads(message_id, user_id)',
    );
  } catch (error) {
    console.warn(
      'Could not create the unique index on internal_message_reads:',
      error instanceof Error ? error.message : error,
    );
  }
};

/**
 * `internal_messages` had no index at all, which was survivable while the only reader was a rare
 * inbox query. It is not survivable now: a reconnecting client replays by `created_at`, and a phone
 * on a bad network reconnects often enough to make a sequential scan of every message a school has
 * ever sent into the hottest query in the app.
 */
const ensureMessageIndexes = async (database) => {
  for (const statement of [
    // Replay, and the inbox's own ORDER BY created_at DESC.
    'CREATE INDEX IF NOT EXISTS idx_internal_messages_created_at ON internal_messages(created_at)',
    // The `audience_kind = 'user'` arm of the audience predicate.
    'CREATE INDEX IF NOT EXISTS idx_internal_messages_recipient ON internal_messages(recipient_user_id)',
  ]) {
    try {
      await database.query(statement);
    } catch (error) {
      console.warn(
        'Could not create a message index:',
        error instanceof Error ? error.message : error,
      );
    }
  }
};

const ensureAttendanceUniqueness = async (database) => {
  try {
    await database.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance_records(student_id, attendance_date)',
    );

    // idx_attendance_student_date covers the same two columns, so the unique index above fully
    // subsumes it — keeping both would cost an extra write on every attendance record for nothing.
    // It is dropped only once the unique index exists, so a database still carrying duplicates
    // keeps its index and its query performance until it is cleaned up.
    //
    // This also works around a pg-mem limitation that would otherwise break the upsert on the test
    // and demo databases: with a non-unique index present on the same columns, pg-mem matches that
    // one for ON CONFLICT and rejects the statement, never finding the unique index beside it.
    await database.query('DROP INDEX IF EXISTS idx_attendance_student_date');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isDuplicateData = error?.code === '23505' || /could not create unique index|duplicate key/i.test(message);

    if (!isDuplicateData) {
      // Not a uniqueness problem — say what it actually was rather than misdiagnosing it.
      console.warn('Could not create the unique attendance index:', message);
      return;
    }

    console.warn(
      [
        'Skipped the unique attendance index — duplicate (student, date) rows exist.',
        // Postgres names the offending key in DETAIL; without it this message is a dead end.
        error?.detail ? `  ${error.detail}` : null,
        '  Attendance saves will fail until these are cleaned up. To inspect and fix:',
        '    node scripts/dedupe-attendance.mjs           # dry run, shows what it would remove',
        '    node scripts/dedupe-attendance.mjs --apply   # collapse duplicates and add the index',
      ]
        .filter(Boolean)
        .join('\n'),
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
