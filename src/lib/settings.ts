import { supabase } from './supabase';
import type { UserProfile } from '@/types/auth';

export interface SchoolSettings {
  school_name: string;
  tagline: string;
  address: string;
  logo: string;
  theme_color: string;
  contact_phone: string;
  contact_email: string;
}

export const EMPTY_SETTINGS: SchoolSettings = {
  school_name: '',
  tagline: '',
  address: '',
  logo: '',
  theme_color: '#2952a3',
  contact_phone: '',
  contact_email: '',
};

export const fetchSchoolSettings = async (): Promise<SchoolSettings> => {
  const { data, error } = await supabase.functions.invoke<{ settings: SchoolSettings }>('settings', {
    body: { action: 'get' },
  });
  if (error || !data?.settings) return EMPTY_SETTINGS;
  return { ...EMPTY_SETTINGS, ...data.settings };
};

/** Admin-only. Sends the whole form (the server does a full-row replace). */
export const saveSchoolSettings = async (
  settings: SchoolSettings,
  user: UserProfile | null,
): Promise<SchoolSettings> => {
  const { data, error } = await supabase.functions.invoke<{ settings: SchoolSettings }>('settings', {
    body: {
      action: 'update',
      requesterRole: user?.role,
      actorEmail: user?.auth_email,
      actorName: user?.display_name,
      schoolName: settings.school_name,
      tagline: settings.tagline,
      address: settings.address,
      logo: settings.logo,
      themeColor: settings.theme_color,
      contactPhone: settings.contact_phone,
      contactEmail: settings.contact_email,
    },
  });
  if (error) throw error;
  if (data && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return { ...EMPTY_SETTINGS, ...(data?.settings || settings) };
};
