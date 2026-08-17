import type { UserRole } from '@/types/auth';

export const USER_ROLES: readonly UserRole[] = ['admin', 'teacher', 'support_staff'];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  support_staff: 'Support Staff (Non-Teaching)',
};

export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  teacher: 'Teacher',
  support_staff: 'Support Staff',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Can add and edit student records, manage staff roles, and view the audit trail.',
  teacher: 'Can sign in, use SchoolBot, and view student records without changing admin-only data.',
  support_staff:
    'Non-teaching staff — security, gatekeepers, cooks, cleaners, drivers, and similar. Can only see school fees payment status. All other student information, and SchoolBot itself, stay closed to them.',
};

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

export const getRoleLabel = (role: UserRole | string | undefined) =>
  isUserRole(role) ? ROLE_LABELS[role] : 'Unknown Role';

export const getRoleShortLabel = (role: UserRole | string | undefined) =>
  isUserRole(role) ? ROLE_SHORT_LABELS[role] : 'Unknown';
