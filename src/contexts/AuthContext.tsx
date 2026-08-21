import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserProfile, AuditLogEntry, JsonRecord, UserRole } from '@/types/auth';

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

  // Restore session from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id && parsed.auth_email) {
          setUser(parsed);
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    setIsLoading(false);
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

  const fetchAuditLog = useCallback(async (limit = 50): Promise<AuditLogEntry[]> => {
    try {
      const { data, error } = await supabase.functions.invoke<AuthFunctionResponse>('auth', {
        body: { action: 'get_audit_log', limit },
      });
      if (error || data?.error) return [];
      return data.logs || [];
    } catch {
      return [];
    }
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
        body: { action: 'update_role', userId, newRole, requesterRole: user.role },
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
        body: {
          action,
          userId,
          ...extra,
          requesterRole: user.role,
          requesterEmail: user.auth_email,
          requesterName: user.display_name,
        },
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

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isAdmin,
        isTeacher,
        isSupportStaff,
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
