import { buildApiUrl } from './supabase';

/** Calls the public control-plane endpoint POST /api/provision. */
export const callProvision = async <T>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const response = await fetch(buildApiUrl('/api/provision'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.error) {
    throw new Error(json?.error || `Request failed (${response.status})`);
  }
  return json.data as T;
};

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
  subdomain?: string;
}

export interface SignupResult {
  subdomain: string;
  purpose: 'provision' | 'renewal';
  reference: string;
  status: string;
  instructions?: string;
}

export interface TenantStatus {
  tenant: { subdomain: string; status: string; current_period_end: string | null } | null;
}
