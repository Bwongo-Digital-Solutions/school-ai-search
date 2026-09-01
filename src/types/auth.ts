export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

export type UserRole =
  | 'admin'
  | 'head_teacher'
  | 'accountant'
  | 'bursar'
  | 'teacher'
  | 'support_staff';

// Non-admin signups are 'pending' until an admin approves them; approval flips them to
// 'approved'. Rejection deletes the row, so 'rejected' never persists — it exists only as a
// transient label the UI may show.
export type AccountStatus = 'pending' | 'approved' | 'rejected';

/**
 * A support-staff member's post, which decides what a student ID scan reveals to them.
 *
 * `bursar` was once on this list. It is a role now — a bursar keeps the books, which is a job
 * rather than a posting — and existing accounts were migrated when it moved.
 */
export type UserDesignation = 'askari' | 'matron' | 'cook';

export interface UserProfile {
  id: string;
  auth_email: string;
  display_name: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
  approval_status?: AccountStatus;
  /** A specialisation within a role. Only support staff carry one; see UserDesignation. */
  designation?: UserDesignation | null;
}

export interface AuditLogEntry {
  id: string;
  user_email: string;
  user_name: string;
  user_role: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  entity_name?: string;
  changes?: JsonRecord;
  created_at: string;
}
