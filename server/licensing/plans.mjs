/**
 * What a school has paid for.
 *
 * Four tiers, and a deployment. The tier decides which parts of the system are switched on; the
 * deployment decides whether the hosted-only ones can be offered at all. Both are held in one place
 * so that "is the examiner included in Standard?" has exactly one answer, and it is this file.
 *
 * ## The rules
 *
 * A tier includes everything below it. That is not decoration — it is the whole reason `rankOf`
 * exists rather than four hand-kept lists, which would drift the first time a feature moved.
 *
 * A one-off (on-premise) install is the same ladder with one exception: the AI features run on
 * hosted models this deployment meters, and an on-premise school is not on that meter. They are
 * still available to an on-site school that points the system at a model of its own — an Ollama
 * box, or any OpenAI-compatible endpoint — because at that point the school is paying for the
 * inference and there is nothing left to meter.
 *
 * The other things the pricing sheet reserves to cloud — offsite backup, multi-campus sync, a
 * hosted parent portal — are deliberately absent. None of them exists in this system yet, and a
 * gate on a feature nobody has written is a gate that will be wrong by the time somebody writes it.
 *
 * ## What this file will not do
 *
 * It does not read the database, call the control plane, or know how a licence is discovered. It
 * takes a licence and answers questions about it. `licence.mjs` is what finds one.
 */

/** Cheapest first. Position is meaning here: a tier includes every feature at or below its rank. */
export const TIERS = ['essential', 'standard', 'professional', 'enterprise'];

export const TIER_LABELS = {
  essential: 'Essential',
  standard: 'Standard',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export const DEPLOYMENTS = ['cloud', 'onsite'];

export const DEPLOYMENT_LABELS = {
  cloud: 'Cloud',
  onsite: 'On-premise',
};

const rankOf = (tier) => {
  const index = TIERS.indexOf(String(tier || '').trim().toLowerCase());
  return index === -1 ? -1 : index;
};

/**
 * Every gated part of the system, and the tier it starts at.
 *
 * `hostedModelOnly` marks the features that run on models this deployment meters. See the note at
 * the top about what that means for an on-premise school.
 *
 * Anything not named here is ungated on purpose. Signing in, reading a message, looking at your own
 * profile and scanning a card are how the system is used at all rather than things a school buys,
 * and putting them behind a tier would mean selling somebody a product they cannot log into.
 */
export const FEATURES = {
  /* ---- Essential: running the office ---- */
  students: { label: 'Students and profiles', tier: 'essential' },
  records: { label: 'Student records', tier: 'essential' },
  users: { label: 'Staff accounts', tier: 'essential' },
  school_data: { label: 'School data and backups', tier: 'essential' },
  settings: { label: 'Settings', tier: 'essential' },
  messages: { label: 'Messages', tier: 'essential' },
  fees_core: { label: 'Fees: payments, receipts and statements', tier: 'essential' },
  registration: { label: 'Registering a student', tier: 'essential' },
  scanning: { label: 'ID cards and scanning', tier: 'essential' },

  /* ---- Standard: the school day ---- */
  teaching: { label: 'Teaching', tier: 'standard' },
  lessons: { label: 'Lesson planning', tier: 'standard' },
  school_life: { label: 'Clubs and school requirements', tier: 'standard' },
  matron: { label: 'Dormitories and the sick bay', tier: 'standard' },
  attendance: { label: 'Roll call and attendance', tier: 'standard' },
  meals: { label: 'Meals', tier: 'standard' },
  gate: { label: 'Gate passes', tier: 'standard' },
  marks: { label: 'Recording marks', tier: 'standard' },

  /* ---- Professional: the back office ---- */
  examiner: { label: 'Digital examiner', tier: 'professional' },
  finance: { label: 'Finance reporting', tier: 'professional' },
  fees_billing: { label: 'Fees: billing runs, arrears and bursaries', tier: 'professional' },
  erp: { label: 'ERP', tier: 'professional' },
  audit: { label: 'Audit log', tier: 'professional' },
  monitoring: { label: 'Monitoring', tier: 'professional' },
  integrations: { label: 'Integrations', tier: 'professional' },

  /* ---- Enterprise: AI ---- */
  assistant: { label: 'AI assistant', tier: 'enterprise', hostedModelOnly: true },
  ai_documents: { label: 'AI reports and exam papers', tier: 'enterprise', hostedModelOnly: true },
  mark_extraction: { label: 'Reading marks off a photograph or a file', tier: 'enterprise', hostedModelOnly: true },
  elearning: { label: 'E-learning', tier: 'enterprise' },
  search: { label: 'Search across the school', tier: 'enterprise' },
};

export const FEATURE_KEYS = Object.keys(FEATURES);

/**
 * A licence, with every field settled.
 *
 * An unknown or missing tier resolves to `enterprise` rather than to `essential`, and the direction
 * matters: this system ran for a long time with no notion of a plan at all, and every school on it
 * had everything. Defaulting downward would silently switch off features people are using today,
 * on deploy, with no warning and no way for them to tell what happened. Somebody must choose to
 * sell a smaller tier before anyone loses anything.
 */
export const normaliseLicence = (licence = {}) => {
  const tier = TIERS.includes(licence.plan) ? licence.plan : 'enterprise';
  const deployment = DEPLOYMENTS.includes(licence.deployment) ? licence.deployment : 'cloud';
  return {
    plan: tier,
    deployment,
    // Whether this school has pointed the system at a model of its own. Only consulted on-premise.
    ownModel: Boolean(licence.ownModel),
    source: licence.source || 'default',
  };
};

/**
 * Why a feature is unavailable, or null when it is available.
 *
 * A reason rather than a boolean, because "you need Professional" and "this needs a model of your
 * own" are different problems with different answers, and a screen that says only "unavailable"
 * sends the reader to support to find out which.
 */
export const featureRefusal = (licence, key) => {
  const feature = FEATURES[key];
  if (!feature) return null; // Ungated on purpose. See the note on FEATURES.

  const settled = normaliseLicence(licence);

  if (rankOf(settled.plan) < rankOf(feature.tier)) {
    return {
      reason: 'plan',
      feature: key,
      label: feature.label,
      requiredPlan: feature.tier,
      requiredPlanLabel: TIER_LABELS[feature.tier],
      plan: settled.plan,
      message: `${feature.label} is part of ${TIER_LABELS[feature.tier]}. This school is on ${TIER_LABELS[settled.plan]}.`,
    };
  }

  if (feature.hostedModelOnly && settled.deployment === 'onsite' && !settled.ownModel) {
    return {
      reason: 'hosted_model',
      feature: key,
      label: feature.label,
      requiredPlan: feature.tier,
      requiredPlanLabel: TIER_LABELS[feature.tier],
      plan: settled.plan,
      message: `${feature.label} runs on a hosted model, which an on-premise installation is not billed for. Point the system at a model of your own under Settings to switch it on.`,
    };
  }

  return null;
};

export const allows = (licence, key) => featureRefusal(licence, key) === null;

/**
 * The whole picture, for a client that has to draw a navigation before it knows what to ask for.
 *
 * Every key is present whether it is on or off. A screen deciding what to hide should not have to
 * tell "this school does not have it" apart from "the server forgot to mention it".
 */
export const entitlements = (licence) => {
  const settled = normaliseLicence(licence);
  const features = {};

  for (const key of FEATURE_KEYS) {
    const refusal = featureRefusal(settled, key);
    features[key] = {
      label: FEATURES[key].label,
      tier: FEATURES[key].tier,
      allowed: refusal === null,
      reason: refusal ? refusal.reason : null,
      message: refusal ? refusal.message : '',
    };
  }

  return {
    plan: settled.plan,
    planLabel: TIER_LABELS[settled.plan],
    deployment: settled.deployment,
    deploymentLabel: DEPLOYMENT_LABELS[settled.deployment],
    ownModel: settled.ownModel,
    source: settled.source,
    tiers: TIERS.map((tier) => ({ value: tier, label: TIER_LABELS[tier] })),
    features,
  };
};
