import { supabase } from './supabase';

/** The external systems a school runs alongside this one — its Moodle, and at most one ERP. */
export interface Integration {
  provider: 'moodle' | 'odoo' | 'erpnext' | 'dolibarr';
  label: string;
  kind: 'elearning' | 'erp';
  baseUrl: string;
  username: string;
  /** The last four characters of the stored token. The token itself never leaves the server. */
  tokenPreview: string;
  hasToken: boolean;
  /** Stored under a SECRETS_KEY that has since changed, so it can no longer be read. */
  tokenUnreadable: boolean;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastError: string;
  updatedBy: string;
}

export interface IntegrationList {
  secretsConfigured: boolean;
  integrations: Integration[];
}

const call = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('integrations', { body });
  if (error) throw error;
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
};

export const loadIntegrations = () => call<IntegrationList>({ action: 'list' });

/**
 * Save one system's settings.
 *
 * `apiToken` is optional on purpose: omitting it leaves the stored token alone, while passing an
 * empty string clears it. Sending an empty token every time the address changed would blank a
 * credential nobody meant to touch.
 */
export const saveIntegration = (payload: {
  provider: string;
  baseUrl: string;
  username?: string;
  apiToken?: string;
  enabled?: boolean;
}) => call<IntegrationList>({ action: 'save', ...payload });

export const disableIntegration = (provider: string) =>
  call<IntegrationList>({ action: 'disable', provider });

export const testIntegration = (provider: string) =>
  call<IntegrationList & { connected: boolean; connectionError: string }>({ action: 'test', provider });
