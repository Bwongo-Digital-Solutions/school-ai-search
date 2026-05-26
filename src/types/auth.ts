export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

export interface UserProfile {
  id: string;
  auth_email: string;
  display_name: string;
  role: 'admin' | 'teacher';
  avatar_url?: string;
  created_at: string;
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
