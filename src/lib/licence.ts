import { buildApiUrl } from './supabase';

/**
 * What this school has paid for, as the server sees it.
 *
 * Read rather than decided here. The server refuses a gated action whatever the browser believes,
 * so this exists to stop the app *offering* things the school does not have — an unreachable menu
 * entry is a worse experience than an absent one, and a locked screen the reader can understand is
 * better than a request that fails with a number.
 */

export type PlanTier = 'essential' | 'standard' | 'professional' | 'enterprise';
export type Deployment = 'cloud' | 'onsite';

export interface FeatureEntitlement {
  label: string;
  tier: PlanTier;
  allowed: boolean;
  /** 'plan' when the tier is too low, 'hosted_model' when on-premise needs a model of its own. */
  reason: 'plan' | 'hosted_model' | null;
  message: string;
}

export interface Entitlements {
  plan: PlanTier;
  planLabel: string;
  deployment: Deployment;
  deploymentLabel: string;
  ownModel: boolean;
  source: string;
  tiers: { value: PlanTier; label: string }[];
  features: Record<string, FeatureEntitlement>;
}

/**
 * What to believe when the server cannot be asked.
 *
 * Everything on, in the same direction as the server's own default. A licensing lookup that fails
 * must not be able to hide a school's own features from it: the server is what actually enforces
 * this, so an optimistic client costs a clear 402 at worst, while a pessimistic one would black out
 * a working application over a dropped request.
 */
export const UNKNOWN_ENTITLEMENTS: Entitlements = {
  plan: 'enterprise',
  planLabel: 'Enterprise',
  deployment: 'cloud',
  deploymentLabel: 'Cloud',
  ownModel: false,
  source: 'unknown',
  tiers: [],
  features: {},
};

export const fetchEntitlements = async (): Promise<Entitlements> => {
  const response = await fetch(buildApiUrl('/api/entitlements'));
  if (!response.ok) throw new Error(`The licence could not be read (${response.status})`);
  const payload = await response.json();
  return (payload?.data as Entitlements) ?? UNKNOWN_ENTITLEMENTS;
};

/** What the plan screen needs beyond the entitlements: whether this deployment can act at all. */
export interface PlanView extends Entitlements {
  /** False when the plan is pinned in the environment, so the screen can say why not. */
  changeable: boolean;
  target: 'environment' | 'control-plane' | 'settings';
}

const callPlan = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(buildApiUrl('/api/functions/plan'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `The plan could not be reached (${response.status})`);
  }
  return payload.data as T;
};

export const fetchPlanView = () => callPlan<PlanView>({ action: 'view' });

/**
 * Move the school to another tier.
 *
 * Takes effect immediately, in both directions — there is no proration and no grace period on a
 * downgrade, so the screen says so before the button is pressed.
 */
export const changePlan = (plan: PlanTier) => callPlan<PlanView>({ action: 'change', plan });
