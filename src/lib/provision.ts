import { buildApiUrl } from './supabase';

/**
 * Calls the control-plane endpoint POST /api/provision.
 *
 * `ownerToken` is the platform operator's credential, sent for the actions that act on the platform
 * rather than on one school (list, create, set_status, sweep). It is passed in per call and held
 * only in the console's React state — never in localStorage, where every script on the page could
 * read it, and never on a request that does not need it.
 */
export const callProvision = async <T>(
  action: string,
  payload: Record<string, unknown> = {},
  ownerToken?: string,
): Promise<T> => {
  const response = await fetch(buildApiUrl('/api/provision'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ownerToken ? { Authorization: `Bearer ${ownerToken}` } : {}),
    },
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

/** A school as the control plane describes it. Connection details never appear here. */
export interface PlatformTenant {
  id: string;
  subdomain: string;
  school_name: string;
  contact_email: string;
  status: 'pending' | 'active' | 'past_due' | 'suspended';
  plan: string | null;
  current_period_end: string | null;
  created_at: string;
  activated_at: string | null;
}
