import type { UserRole } from '@/types/auth';

export const USER_ROLES: readonly UserRole[] = [
  'admin',
  'head_teacher',
  'accountant',
  'bursar',
  'teacher',
  'support_staff',
];

/**
 * The roles trusted with the school's data as a whole — backups, bulk export and import, and the
 * external systems the school is connected to.
 *
 * These four are the people who answer for the institution rather than for a class: the head
 * teacher runs the school, the accountant and bursar keep its books, and the administrator keeps
 * its systems. A teacher has no business taking a copy of every student record home, and support
 * staff never see one.
 *
 * `hasRole` is plain allowlist membership with no hierarchy (server/auth/actor.mjs), so a role is
 * invisible to a gate until it is named in one. This constant is that name, shared so a new
 * privileged screen cannot be added with a slightly different list.
 */
export const PRIVILEGED_ROLES: readonly UserRole[] = ['admin', 'head_teacher', 'accountant', 'bursar'];

/** Roles that may see and change student records: everything except the finance-only posts. */
export const TEACHING_ROLES: readonly UserRole[] = ['admin', 'head_teacher', 'teacher'];

/** Roles that may see money: invoices, payments, arrears, ratings. */
export const FINANCE_ROLES: readonly UserRole[] = ['admin', 'head_teacher', 'accountant', 'bursar'];

/** Roles that manage other people's accounts. Deliberately the administrator alone. */
export const ACCOUNT_ADMIN_ROLES: readonly UserRole[] = ['admin'];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  head_teacher: 'Head Teacher',
  accountant: 'Accountant',
  bursar: 'Bursar',
  teacher: 'Teacher',
  support_staff: 'Support Staff (Non-Teaching)',
};

export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  head_teacher: 'Head Teacher',
  accountant: 'Accountant',
  bursar: 'Bursar',
  teacher: 'Teacher',
  support_staff: 'Support Staff',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin:
    'Runs the system. Everything below, plus staff accounts and roles, the audit trail, and the school settings.',
  head_teacher:
    'Runs the school. Sees every student record, the fees, and the whole of monitoring, and can back up and export the school’s data. Cannot change staff roles or system settings — that stays with the administrator.',
  accountant:
    'Keeps the books. Fee structures, billing, payments, arrears and financial reports, plus backup, export and the connected systems. Does not manage staff accounts.',
  bursar:
    'Keeps the books alongside the accountant, and handles money at the counter — receipting payments and answering on a student’s account. Same reach over fees, backup and export.',
  teacher:
    'Teaches. Can sign in, use the assistant, plan lessons, set papers and read student records, without changing anything reserved to administrators.',
  support_staff:
    'Non-teaching staff — security, gatekeepers, cooks, cleaners, drivers, and similar. Can only see school fees payment status. All other student information, and the assistant itself, stay closed to them.',
};

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

/** True when this role is trusted with the school's data as a whole. See PRIVILEGED_ROLES. */
export const isPrivilegedRole = (role: UserRole | string | undefined | null) =>
  isUserRole(role) && (PRIVILEGED_ROLES as readonly string[]).includes(role);

export const getRoleLabel = (role: UserRole | string | undefined) =>
  isUserRole(role) ? ROLE_LABELS[role] : 'Unknown Role';

export const getRoleShortLabel = (role: UserRole | string | undefined) =>
  isUserRole(role) ? ROLE_SHORT_LABELS[role] : 'Unknown';
