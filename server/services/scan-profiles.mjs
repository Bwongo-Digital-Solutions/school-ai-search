/**
 * What a student ID scan reveals, per staff profile.
 *
 * A profile is the pair (role, designation): the role says what kind of staff member this is,
 * the designation narrows it to the job they actually do at the point of scanning. The gate,
 * the kitchen and the dormitories each need a different slice of the same student, and none of
 * them needs the whole record — so the sections below are the contract, and the card handler
 * fetches only the tables the granted sections require.
 *
 * NOTE: this is a data-shaping policy, not access control on its own. It decides what a card
 * *contains*, and the route that builds one is what decides who may ask — that route now reads the
 * role from the caller's session (server/auth/actor.mjs) rather than from a field they supplied,
 * so the profile a client requests can be checked against the profile it actually holds.
 */

/** Every section a card can carry. The student's identity is always present and is not listed. */
export const SCAN_SECTIONS = [
  'bio',
  'class',
  'dormitory',
  'parents',
  'fees',
  'payments',
  'academics',
  'attendance',
  'exam_clearance',
  'exam_clearance_grant',
  'roll_call',
  'gate_pass',
  'gate_permission',
  'meal_card',
];

/* 'payments' is the ledger behind the 'fees' balance — who paid what, and when. It is the
   bursar's working record, so it goes no further than the profiles that keep the books: a
   teacher sees whether fees are cleared, not the family's payment history. */
const ADMIN_SECTIONS = [
  'fees', 'payments', 'bio', 'class', 'dormitory', 'parents', 'gate_permission',
  'exam_clearance_grant',
];

/* Designations are only meaningful inside their own role; a cook is support staff. An
 * unrecognised pairing falls back to the role's default. */
const PROFILES = {
  admin: {
    default: ADMIN_SECTIONS,
  },
  // Runs the school, so the card shows everything an administrator's does.
  head_teacher: {
    default: ADMIN_SECTIONS,
  },
  // Keeps the books. The same card the bursar designation used to give, now attached to the role
  // that actually does the job rather than to an administrator account.
  accountant: {
    default: ADMIN_SECTIONS,
  },
  bursar: {
    default: ADMIN_SECTIONS,
  },
  teacher: {
    default: [
      'roll_call',
      'academics',
      'attendance',
      'exam_clearance',
      'class',
      'fees',
      'bio',
      'dormitory',
      'parents',
      'gate_permission',
    ],
  },
  support_staff: {
    // Plain support staff predate the designations and stay on fees only.
    default: ['fees'],
    // The gate checks a permission, it never issues one — whoever mans the gate must not also
    // be the person who authorised the exit.
    askari: ['class', 'gate_pass'],
    matron: ['bio', 'class', 'dormitory', 'parents', 'gate_permission'],
    cook: ['class', 'meal_card'],
  },
};

export const PROFILE_LABELS = {
  askari: 'Gate keeper',
  matron: 'Matron',
  cook: 'Cook',
};

export const ROLE_LABELS = {
  admin: 'Administrator',
  head_teacher: 'Head Teacher',
  accountant: 'Accountant',
  bursar: 'Bursar',
  teacher: 'Teacher',
  support_staff: 'Support staff',
};

/**
 * Reduce a role and designation to a pairing this module has a card for.
 *
 * An unknown role falls back to support staff — the least it can reveal. That is the safe
 * direction, but it is also silent: a role added to the system and not added to PROFILES above
 * would be quietly served the fees-only card with no error anywhere. If a card looks wrong for a
 * role, this is the first place to look.
 */
export const normaliseProfile = (role, designation) => {
  const cleanRole = PROFILES[role] ? role : 'support_staff';
  const table = PROFILES[cleanRole];
  const cleanDesignation = designation && table[designation] ? designation : null;
  return { role: cleanRole, designation: cleanDesignation };
};

/** The sections a profile may see, in the order a card should present them. */
export const sectionsFor = (role, designation) => {
  const profile = normaliseProfile(role, designation);
  const table = PROFILES[profile.role];
  return [...(profile.designation ? table[profile.designation] : table.default)];
};

export const profileLabel = (role, designation) => {
  const profile = normaliseProfile(role, designation);
  return profile.designation
    ? PROFILE_LABELS[profile.designation]
    : ROLE_LABELS[profile.role] || profile.role;
};

export const DESIGNATIONS = Object.freeze(['askari', 'matron', 'cook']);

/** Which designations an administrator may assign to an account of a given role. */
export const designationsForRole = (role) => {
  const table = PROFILES[role];
  if (!table) return [];
  return Object.keys(table).filter((key) => key !== 'default');
};
