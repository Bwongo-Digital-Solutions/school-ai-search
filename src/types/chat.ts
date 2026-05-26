import type { JsonRecord } from './auth';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  metadata?: JsonRecord;
  createdAt: Date;
  isStreaming?: boolean;
}

export interface Attachment {
  type: 'image' | 'voice' | 'document';
  url?: string;
  data?: string;
  name?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
  lastMessage?: string;
}

export interface AiModelOption {
  id: string;
  label: string;
  provider: string;
  model: string;
  type: 'local' | 'commercial' | 'open_source' | string;
  description: string;
  configured: boolean;
}

export interface Student {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  class_section: string;
  date_of_birth: string;
  gender: string;
  email: string;
  phone: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  address: string;
  enrollment_date: string;
  status: string;
  gpa: number;
  attendance_rate: number;
  blood_group?: string;
  medical_record?: JsonRecord;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relation?: string;
  lifecycle_status?: string;
  graduation_date?: string;
  transfer_date?: string;
  alumni_notes?: string;
  subjects: string[];
  notes: string;
  photo_url?: string;
}

export interface FilterOptions {
  gradeLevel?: number;
  classSection?: string;
  status?: string;
}
