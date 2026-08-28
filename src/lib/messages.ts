import { supabase } from './supabase';

/**
 * The staff inbox: messages between colleagues, and the events the system raises.
 *
 * Both live in one table and one feed, distinguished by `category`, because the bell is one bell —
 * a gate refusal and a note from the head teacher are both "something you need to look at".
 */

export type MessageCategory = 'message' | 'event';
export type MessagePriority = 'normal' | 'high';
export type AudienceKind = 'user' | 'role' | 'designation' | 'all';

export interface StaffMessage {
  id: string;
  subject: string;
  body: string;
  category: MessageCategory;
  priority: MessagePriority;
  sender_name: string;
  audience_kind: AudienceKind;
  audience_value: string;
  student_id: string | null;
  created_at: string;
  read: boolean;
}

export interface StaffMember {
  id: string;
  auth_email: string;
  display_name: string;
  role: string;
  designation: string | null;
}

export interface StaffGroup {
  role: string;
  designation: string | null;
  members: number;
}

const call = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('messages', { body });
  if (error) throw error;
  if (data && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
};

export const loadInbox = (limit = 50) =>
  call<{ messages: StaffMessage[]; unread: number }>({ action: 'inbox', limit });

/**
 * Just the number, for the badge.
 *
 * The inbox counts unread in JavaScript over a page capped at 50, so past that it under-reports —
 * and asking for it costs the whole inbox. This is a COUNT.
 */
export const loadUnreadCount = () => call<{ unread: number }>({ action: 'unread_count' });

export const listStaff = () =>
  call<{ staff: StaffMember[]; groups: StaffGroup[] }>({ action: 'staff' });

export const markRead = (messageId: string) =>
  call<{ messages: StaffMessage[]; unread: number }>({ action: 'read', messageId });

export const markAllRead = () =>
  call<{ messages: StaffMessage[]; unread: number }>({ action: 'read_all' });

export interface SendMessageInput {
  subject: string;
  body: string;
  audienceKind: AudienceKind;
  /** The role or designation, when addressing a group. Ignored for a person or for everybody. */
  audienceValue?: string;
  /** The person's sign-in email, when addressing one person. */
  recipientEmail?: string;
  priority?: MessagePriority;
}

export const sendMessage = (input: SendMessageInput) =>
  call<{ message: StaffMessage }>({ action: 'send', ...input });

/** Who is connected right now. Derived from live connections, so it is never stale. */
export const loadPresence = () =>
  call<{ people: { id: string; name: string; role: string; connections: number }[] }>({
    action: 'presence',
  });
