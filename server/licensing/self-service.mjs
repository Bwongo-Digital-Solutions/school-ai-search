/**
 * A school changing its own plan.
 *
 * The tier work originally made this read-only, on the reasoning that a plan an administrator can
 * raise from inside the product is not really a plan. That was overruled deliberately: schools are
 * to upgrade and downgrade themselves, without an operator in the loop. So this is the path, and it
 * is written to be honest about what it does rather than to be hard to reach.
 *
 * Two consequences worth naming, because they are the price of the decision:
 *
 *   - **Nothing is charged here.** Changing the plan changes what the software allows, immediately.
 *     Billing is the control plane's business and is not wired to this, so an upgrade grants the
 *     features before anybody has paid for them. Whoever operates the platform reconciles that.
 *   - **A downgrade takes effect at once.** The features go the moment it is confirmed, mid-term,
 *     with no proration and no grace period. The screen says so before the button is pressed.
 *
 * Deliberately *not* licence-gated: whatever tier a school is on, it has to be able to reach the
 * screen that changes the tier. Gating this behind a feature would be a door locked from inside.
 */
import { randomUUID } from 'node:crypto';

import { requireRole, resolveActor } from '../auth/actor.mjs';
import { ACCOUNT_ADMIN_ROLES } from '../auth/roles.mjs';
import { clearLicenceCache, licenceFor } from './licence.mjs';
import { entitlements, TIERS, TIER_LABELS } from './plans.mjs';

/**
 * Where the change is written.
 *
 * The same order `licenceFor` reads in, so a school does not save a plan into a row that something
 * higher up is overriding. An environment-pinned licence is refused rather than silently written
 * somewhere that will never be read — the operator who typed it into the process meant it.
 */
const targetFor = (control, tenantId) => {
  if (String(process.env.LICENCE_PLAN || '').trim()) return 'environment';
  return control && tenantId ? 'control-plane' : 'settings';
};

const view = async (database, { control, tenantId }) => {
  const licence = await licenceFor(database, { tenantId, control, fresh: true });
  return {
    ...entitlements(licence),
    // Whether this deployment can act on a change at all, so the screen can say why not.
    changeable: targetFor(control, tenantId) !== 'environment',
    target: targetFor(control, tenantId),
  };
};

const change = async (database, body, actor, { control, tenantId, setTenantPlan }) => {
  const plan = String(body.plan || '').trim().toLowerCase();
  if (!TIERS.includes(plan)) {
    return { error: `Unsupported plan: ${body.plan}. Use one of ${TIERS.join(', ')}.` };
  }

  const current = await licenceFor(database, { tenantId, control, fresh: true });
  if (current.plan === plan) return { plan, unchanged: true };

  const target = targetFor(control, tenantId);
  if (target === 'environment') {
    return {
      error: 'This deployment pins its plan in its configuration (LICENCE_PLAN), so it cannot be changed here.',
    };
  }

  if (target === 'control-plane') {
    const tenant = await setTenantPlan(control, tenantId, plan);
    if (!tenant) return { error: 'This school is not in the platform registry, so its plan cannot be changed here.' };
  } else {
    await database.query(
      "UPDATE school_settings SET plan = $1, updated_at = NOW(), updated_by = $2 WHERE id = 'default'",
      [plan, actor?.email || ''],
    );
  }

  /* Cached for a minute otherwise, which is a long time to sit looking at a screen that still says
     the old tier after paying for a new one. */
  clearLicenceCache(tenantId);
  clearLicenceCache();

  /* On the audit trail beside every other act of authority. What a school may reach is exactly the
     kind of change somebody asks about three months later, and "who moved us off Professional?"
     needs an answer. */
  await database.query(
    `INSERT INTO audit_logs (id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes)
     VALUES ($1, $2, $3, $4, 'plan_changed', 'licence', NULL, $5, $6)`,
    [
      randomUUID(),
      actor?.email || '',
      actor?.name || '',
      actor?.role || '',
      `${TIER_LABELS[current.plan]} to ${TIER_LABELS[plan]}`,
      JSON.stringify({ from: current.plan, to: plan, target, direction: TIERS.indexOf(plan) > TIERS.indexOf(current.plan) ? 'upgrade' : 'downgrade' }),
    ],
  );

  const licence = await licenceFor(database, { tenantId, control, fresh: true });
  return { ...entitlements(licence), changed: true, from: current.plan, to: plan };
};

export const PLAN_ACTIONS = ['view', 'change'];

export const handlePlanFunction = async (
  database,
  body = {},
  { actor: authenticated, tenantId, control, setTenantPlan } = {},
) => {
  const actor = resolveActor(authenticated, body);

  /* Reading the plan is open to any signed-in member of staff — it is on the Settings screen and it
     is not a secret. Changing it is the account administrator's, the same fence as adding a user. */
  const action = String(body.action || 'view').trim();
  if (action === 'view') {
    return view(database, { control, tenantId });
  }

  if (action === 'change') {
    const refusal = requireRole(actor, ACCOUNT_ADMIN_ROLES);
    if (refusal) return refusal;
    return change(database, body, actor, { control, tenantId, setTenantPlan });
  }

  return { error: `Unsupported plan action: ${action}` };
};
