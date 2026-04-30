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
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT ''
);

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

CREATE INDEX IF NOT EXISTS idx_students_last_name ON students(last_name);
CREATE INDEX IF NOT EXISTS idx_students_grade_level ON students(grade_level);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
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
