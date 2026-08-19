export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

export type UserRole = 'admin' | 'teacher' | 'support_staff';

// Non-admin signups are 'pending' until an admin approves them; approval flips them to
// 'approved'. Rejection deletes the row, so 'rejected' never persists — it exists only as a
// transient label the UI may show.
export type AccountStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  auth_email: string;
  display_name: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
  approval_status?: AccountStatus;
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
