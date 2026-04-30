import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserProfile, AuditLogEntry } from '@/types/auth';

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => void;
  logAudit: (action: string, entityId?: string, entityName?: string, changes?: Record<string, any>) => Promise<void>;
  fetchAuditLog: (limit?: number) => Promise<AuditLogEntry[]>;
  fetchUsers: () => Promise<UserProfile[]>;
  updateUserRole: (userId: string, newRole: 'admin' | 'teacher') => Promise<{ success: boolean; error?: string }>;
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
      const { data, error } = await supabase.functions.invoke('auth', {
        body: { action: 'signin', email, password },
      });
      if (error) {
        const errMsg = error.message || 'Sign in failed';
        return { success: false, error: errMsg };
      }
      if (data?.error) {
        return { success: false, error: data.error };
      }
      const userProfile = data.user as UserProfile;
      setUser(userProfile);
      localStorage.setItem(SESSION_KEY, JSON.stringify(userProfile));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('auth', {
        body: { action: 'signup', email, password, displayName },
      });
      if (error) {
        const errMsg = error.message || 'Sign up failed';
        return { success: false, error: errMsg };
      }
      if (data?.error) {
        return { success: false, error: data.error };
      }
      const userProfile = data.user as UserProfile;
      setUser(userProfile);
      localStorage.setItem(SESSION_KEY, JSON.stringify(userProfile));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  }, []);

  const logAudit = useCallback(async (action: string, entityId?: string, entityName?: string, changes?: Record<string, any>) => {
    if (!user) return;
    try {
      await supabase.functions.invoke('auth', {
        body: {
          action: 'log_audit',
          userEmail: user.auth_email,
          userName: user.display_name,
          userRole: user.role,
          auditAction: action,
          entityType: 'student',
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
      const { data, error } = await supabase.functions.invoke('auth', {
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
      const { data, error } = await supabase.functions.invoke('auth', {
        body: { action: 'get_users' },
      });
      if (error || data?.error) return [];
      return data.users || [];
    } catch {
      return [];
    }
  }, []);

  const updateUserRole = useCallback(async (userId: string, newRole: 'admin' | 'teacher') => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }
    try {
      const { data, error } = await supabase.functions.invoke('auth', {
        body: { action: 'update_role', userId, newRole, requesterRole: user.role },
      });
      if (error || data?.error) {
        return { success: false, error: data?.error || 'Failed to update role' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  }, [user]);

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isAdmin,
        isTeacher,
        isLoading,
        signIn,
        signUp,
        signOut,
        logAudit,
        fetchAuditLog,
        fetchUsers,
        updateUserRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
