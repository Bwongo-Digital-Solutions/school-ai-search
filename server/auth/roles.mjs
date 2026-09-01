/**
 * The role lists the server gates on, in one place.
 *
 * `hasRole` is plain allowlist membership with no hierarchy (see auth/actor.mjs), so a role is
 * invisible to a gate until it is named in one. Spelling a list out at each call site is how a
 * role silently loses access to one screen and keeps it on another; naming the lists once is what
 * makes adding the next role a change to this file rather than a hunt through the codebase.
 *
 * These mirror src/lib/roles.ts. The two are kept in step by hand — a shared module would have to
 * cross the TypeScript/ESM boundary — and the role-list test in tests/local-backend.test.mjs
 * asserts the full set so a drift fails there rather than in production.
 */

/** Every role an account may hold. */
export const USER_ROLES = [
  'admin',
  'head_teacher',
  'accountant',
  'bursar',
  'teacher',
  'support_staff',
];

/**
 * Trusted with the school's data as a whole — backups, bulk export and import, and the external
 * systems it is connected to. The people who answer for the institution rather than for a class.
 */
export const PRIVILEGED_ROLES = ['admin', 'head_teacher', 'accountant', 'bursar'];

/** May read and change student records, and use the teaching tools. */
export const TEACHING_ROLES = ['admin', 'head_teacher', 'teacher'];

/** May see money: invoices, payments, arrears, ratings, financial reports. */
export const FINANCE_ROLES = ['admin', 'head_teacher', 'accountant', 'bursar'];

/** May manage other people's accounts and roles. Deliberately the administrator alone. */
export const ACCOUNT_ADMIN_ROLES = ['admin'];

/**
 * Any signed-in member of staff.
 *
 * Named rather than written out, because the literal ['admin','teacher','support_staff'] appeared
 * in three separate places meaning exactly this — and each one silently refused every role added
 * afterwards, with no error to notice.
 */
export const ALL_STAFF_ROLES = USER_ROLES;
