import { supabase } from './supabase';
import type { UserProfile } from '@/types/auth';

export type SchoolLevel =
  | 'pre_school'
  | 'kindergarten'
  | 'primary'
  | 'secondary_olevel'
  | 'secondary_alevel'
  | 'secondary'
  | 'technical'
  | 'tertiary';

export interface SchoolSettings {
  school_name: string;
  tagline: string;
  address: string;
  logo: string;
  theme_color: string;
  contact_phone: string;
  contact_email: string;
  /** Decides the grading system every report card uses. */
  school_level: SchoolLevel;
  /** Which national examination system that level maps onto. */
  grading_country: string;
}

/**
 * The levels an administrator can pick, with what each one grades on. `grades` is shown under the
 * picker so the consequence of the choice is visible before it is saved.
 */
export const SCHOOL_LEVEL_OPTIONS: { value: SchoolLevel; label: string; grades: string }[] = [
  { value: 'pre_school', label: 'Pre-school', grades: 'Development descriptors — no marks or aggregate' },
  {
    value: 'kindergarten',
    label: 'Kindergarten / Nursery',
    grades: 'Development descriptors — no marks or aggregate',
  },
  { value: 'primary', label: 'Primary (PLE)', grades: 'PLE aggregate points (best 4 subjects) and divisions' },
  {
    value: 'secondary_olevel',
    label: 'Secondary — O-Level only (UCE)',
    grades: 'UCE aggregate points and divisions',
  },
  {
    value: 'secondary_alevel',
    label: 'Secondary — A-Level only (UACE)',
    grades: 'UACE principal grades A–F',
  },
  {
    value: 'secondary',
    label: 'Secondary — O and A Level',
    grades: 'S1–S4: UCE aggregate points and divisions · S5–S6: UACE principal grades A–F',
  },
  { value: 'technical', label: 'Technical / Vocational', grades: 'Distinction / Credit / Pass' },
  { value: 'tertiary', label: 'Tertiary / University', grades: 'Grade Point Average (GPA)' },
];

export const GRADING_COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: 'uganda', label: 'Uganda — UNEB (PLE, UCE, UACE)' },
  { value: 'uganda-cbc', label: 'Uganda — Competency-Based Curriculum (NCDC)' },
  { value: 'international', label: 'International — letter grades and GPA' },
  { value: 'kenya', label: 'Kenya' },
  { value: 'united-states', label: 'United States' },
  { value: 'united-kingdom', label: 'United Kingdom' },
];

export const EMPTY_SETTINGS: SchoolSettings = {
  school_name: '',
  tagline: '',
  address: '',
  logo: '',
  theme_color: '#2952a3',
  contact_phone: '',
  contact_email: '',
  school_level: 'secondary',
  grading_country: 'uganda',
};

/**
 * The school's own name, colours and level.
 *
 * Failure is reported rather than swallowed. Falling back to `EMPTY_SETTINGS` silently is what made
 * a configured school render as an unnamed one with default branding — indistinguishable from a
 * school that had never filled the form in, and impossible to tell was broken.
 *
 * The caller still decides what to do about it: `SettingsContext` keeps the empty defaults on
 * screen, because a nameless header is a better outcome than no application at all.
 */
export const fetchSchoolSettings = async (): Promise<SchoolSettings> => {
  const { data, error } = await supabase.functions.invoke<{ settings: SchoolSettings }>('settings', {
    body: { action: 'get' },
  });
  if (error || !data?.settings) {
    throw new Error(
      (error instanceof Error ? error.message : null) || 'The school settings could not be loaded',
    );
  }
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
      schoolName: settings.school_name,
      tagline: settings.tagline,
      address: settings.address,
      logo: settings.logo,
      themeColor: settings.theme_color,
      contactPhone: settings.contact_phone,
      contactEmail: settings.contact_email,
      schoolLevel: settings.school_level,
      gradingCountry: settings.grading_country,
    },
  });
  if (error) throw error;
  if (data && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return { ...EMPTY_SETTINGS, ...(data?.settings || settings) };
};

/* -------------------------------------------------- the school's own AI provider keys --------- */

export interface ProviderCredential {
  provider: string;
  /** False for Ollama, which has an address but no key. */
  needsKey: boolean;
  /** Whose credentials this provider currently uses. */
  source: 'school' | 'platform';
  /** Masked — the key itself never leaves the server. */
  keyPreview: string;
  /** A key stored under a SECRETS_KEY that has since changed, so it can no longer be read. */
  keyUnreadable: boolean;
  baseUrl: string;
  platformHasKey: boolean;
  platformBaseUrl: string;
  updatedBy: string;
  updatedAt: string | null;
}

export interface ProviderCredentials {
  /** False when the server has no SECRETS_KEY, so a school cannot store a key at all. */
  secretsConfigured: boolean;
  providers: ProviderCredential[];
}

const callSettings = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('settings', { body });
  if (error) throw error;
  if (data && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
};

/** Admin-only. Which providers this school has overridden, and which it inherits. */
export const loadProviderCredentials = () =>
  callSettings<ProviderCredentials>({ action: 'list_provider_keys' });

/** Admin-only. Saving returns the refreshed list, so the screen never guesses at the new state. */
export const saveProviderCredential = (provider: string, apiKey: string, baseUrl: string) =>
  callSettings<ProviderCredentials>({ action: 'save_provider_key', provider, apiKey, baseUrl });

export const deleteProviderCredential = (provider: string) =>
  callSettings<ProviderCredentials>({ action: 'delete_provider_key', provider });
