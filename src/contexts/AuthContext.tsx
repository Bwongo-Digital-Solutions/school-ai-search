import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserProfile, AuditLogEntry, JsonRecord, UserRole } from '@/types/auth';
import {
  ACCOUNT_ADMIN_ROLES,
  FINANCE_ROLES,
  PRIVILEGED_ROLES,
  TEACHING_ROLES,
} from '@/lib/roles';

type AuthFunctionResponse = {
  error?: string;
  user?: UserProfile;
  logs?: AuditLogEntry[];
  users?: UserProfile[];
  pending?: boolean;
  deleted?: boolean;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  isSupportStaff: boolean;
  /**
   * Runs the dormitories. A *designation*, not a role — a matron's role is `support_staff`, the
   * same as the cook's and the askari's, so the two must be asked separately. This mirrors
   * `requirePost` in server/auth/actor.mjs, which is what actually gates her screens; this flag
   * only decides what the browser renders.
   */
  isMatron: boolean;
  /** Runs the school: sees everything an administrator does, bar staff and system settings. */
  isHeadTeacher: boolean;
  /** Keeps the books — accountant or bursar. */
  isFinanceStaff: boolean;
  /** Trusted with the school's data as a whole: backups, export/import, integrations. */
  isPrivileged: boolean;
  /** May read and change student records. */
  canSeeStudents: boolean;
  /** May see money — invoices, payments, arrears. */
  canSeeFinance: boolean;
  /** May manage other people's accounts and roles. Administrators only. */
  canManageStaff: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string; pending?: boolean }>;
  signOut: () => void;
  logAudit: (
    action: string,
    entityId?: string,
    entityName?: string,
    changes?: JsonRecord,
    entityType?: string,
  ) => Promise<void>;
  fetchAuditLog: (limit?: number) => Promise<AuditLogEntry[]>;
  fetchUsers: () => Promise<UserProfile[]>;
  updateUserRole: (userId: string, newRole: UserRole) => Promise<{ success: boolean; error?: string }>;
  approveAccount: (userId: string) => Promise<{ success: boolean; error?: string }>;
  rejectAccount: (userId: string) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: (userId: string) => Promise<{ success: boolean; error?: string }>;
  updateAccount: (
    userId: string,
    changes: { displayName?: string; email?: string; designation?: string | null },
  ) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

const SESSION_KEY = 'schoolbot_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Who is signed in, according to the server.
   *
   * The stored profile is painted first so a reload does not flash the sign-in screen, but it is
   * only a hint: the session itself is an HttpOnly cookie this code cannot read or forge, and the
   * server's answer replaces whatever localStorage said. Editing the stored role to "admin" now
   * changes nothing — the server reads the role from the users row the cookie points at.
   */
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id && parsed.auth_email) setUser(parsed);
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
          body: { action: 'session' },
        });
        if (cancelled) return;

        const current = data?.user ?? null;
        setUser(current);
        if (current) localStorage.setItem(SESSION_KEY, JSON.stringify(current));
        else localStorage.removeItem(SESSION_KEY);
      } catch {
        // The server is unreachable. Keep the stored profile on screen rather than signing someone
        // out over a dropped connection; every request they make will be refused until it is back.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
        body: { action: 'signin', email, password },
      });
      if (error) {
        const errMsg = error.message || 'Sign in failed';
        return { success: false, error: errMsg };
      }
      if (data?.error) {
        return { success: false, error: data.error };
      }
      const userProfile = data?.user;
      if (!userProfile) {
        return { success: false, error: 'Sign in failed' };
      }
      setUser(userProfile);
      localStorage.setItem(SESSION_KEY, JSON.stringify(userProfile));
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, 'Network error') };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
        body: { action: 'signup', email, password, displayName },
      });
      if (error) {
        const errMsg = error.message || 'Sign up failed';
        return { success: false, error: errMsg };
      }
      if (data?.error) {
        return { success: false, error: data.error };
      }
      const userProfile = data?.user;
      if (!userProfile) {
        return { success: false, error: 'Sign up failed' };
      }
      // A pending account gets no session: the person must wait for an admin to approve them,
      // then sign in. Only the auto-approved first (admin) account is signed in immediately.
      if (data?.pending || userProfile.approval_status === 'pending') {
        return { success: true, pending: true };
      }
      setUser(userProfile);
      localStorage.setItem(SESSION_KEY, JSON.stringify(userProfile));
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, 'Network error') };
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
    // The cookie is the credential, and only the server can clear it — dropping the local copy
    // would otherwise leave the session usable by anything that could reach the API.
    void supabase.functions.invoke('auth', { body: { action: 'signout' } });
  }, []);

  const logAudit = useCallback(async (
    action: string,
    entityId?: string,
    entityName?: string,
    changes?: JsonRecord,
    entityType = 'student',
  ) => {
    if (!user) return;
    try {
      await supabase.functions.invoke('auth', {
        body: {
          action: 'log_audit',
          userEmail: user.auth_email,
          userName: user.display_name,
          userRole: user.role,
          auditAction: action,
          entityType,
          entityId,
          entityName,
          changes,
        },
      });
    } catch (err) {
      console.error('Failed to log audit:', err);
    }
  }, [user]);

  /**
   * The audit trail, or the reason there isn't one.
   *
   * This used to answer a failure with `[]`, which the panel then rendered as "no entries" — the
   * one thing an audit trail must never say when it does not know. A refused or broken read is now
   * the caller's to report.
   */
  const fetchAuditLog = useCallback(async (limit = 50): Promise<AuditLogEntry[]> => {
    const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
      body: { action: 'get_audit_log', limit },
    });
    if (error || data?.error) {
      throw new Error(data?.error || getErrorMessage(error, 'The audit trail could not be read'));
    }
    return data.logs || [];
  }, []);

  const fetchUsers = useCallback(async (): Promise<UserProfile[]> => {
    try {
      const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
        body: { action: 'get_users' },
      });
      if (error || data?.error) return [];
      return data.users || [];
    } catch {
      return [];
    }
  }, []);

  const updateUserRole = useCallback(async (userId: string, newRole: UserRole) => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }
    try {
      const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
        body: { action: 'update_role', userId, newRole },
      });
      if (error || data?.error) {
        return { success: false, error: data?.error || 'Failed to update role' };
      }
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, 'Network error') };
    }
  }, [user]);

  /**
   * Shared caller for the admin account actions. They all take a userId and the acting admin's
   * identity (which the server records in the audit trail), so extra fields ride along in `extra`.
   */
  const decideAccount = useCallback(async (
    action: 'approve_account' | 'reject_account' | 'delete_account' | 'update_account',
    userId: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }
    try {
      const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
        // Who is asking is settled by the session cookie; the local check above is only there to
        // keep the UI honest about which buttons it offers.
        body: { action, userId, ...extra },
      });
      if (error || data?.error) {
        return { success: false, error: data?.error || 'Failed to update account' };
      }
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, 'Network error') };
    }
  }, [user]);

  const approveAccount = useCallback((userId: string) => decideAccount('approve_account', userId), [decideAccount]);
  const rejectAccount = useCallback((userId: string) => decideAccount('reject_account', userId), [decideAccount]);
  const deleteAccount = useCallback((userId: string) => decideAccount('delete_account', userId), [decideAccount]);
  const updateAccount = useCallback(
    (userId: string, changes: { displayName?: string; email?: string; designation?: string | null }) =>
      decideAccount('update_account', userId, changes),
    [decideAccount],
  );

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';
  const isSupportStaff = user?.role === 'support_staff';
  const isMatron = isSupportStaff && user?.designation === 'matron';
  const isHeadTeacher = user?.role === 'head_teacher';
  const isFinanceStaff = user?.role === 'accountant' || user?.role === 'bursar';

  // Derived from the shared role lists rather than from a chain of `||` comparisons. A gate spelled
  // out by hand at each screen is a gate that drifts: the whole point of naming these lists once is
  // that adding a role later cannot leave one screen behind.
  const has = (roles: readonly string[]) => Boolean(user) && roles.includes(user!.role);
  const isPrivileged = has(PRIVILEGED_ROLES);
  const canSeeStudents = has(TEACHING_ROLES);
  const canSeeFinance = has(FINANCE_ROLES);
  const canManageStaff = has(ACCOUNT_ADMIN_ROLES);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isAdmin,
        isTeacher,
        isSupportStaff,
        isMatron,
        isHeadTeacher,
        isFinanceStaff,
        isPrivileged,
        canSeeStudents,
        canSeeFinance,
        canManageStaff,
        isLoading,
        signIn,
        signUp,
        signOut,
        logAudit,
        fetchAuditLog,
        fetchUsers,
        updateUserRole,
        approveAccount,
        rejectAccount,
        deleteAccount,
        updateAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
