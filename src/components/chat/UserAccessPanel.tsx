import React, { useCallback, useEffect, useState } from 'react';
import { HardHat, Loader2, RefreshCw, Shield, User, UserCog, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES } from '@/lib/roles';
import type { UserProfile, UserRole } from '@/types/auth';

const ROLE_AVATARS: Record<UserRole, { icon: React.ElementType; wrapper: string; iconColor: string }> = {
  admin: { icon: Shield, wrapper: 'bg-purple-100 dark:bg-purple-900/30', iconColor: 'text-purple-600' },
  teacher: { icon: User, wrapper: 'bg-blue-100 dark:bg-blue-900/30', iconColor: 'text-blue-600' },
  support_staff: { icon: HardHat, wrapper: 'bg-emerald-100 dark:bg-emerald-900/30', iconColor: 'text-emerald-600' },
};

const UserAccessPanel: React.FC = () => {
  const { isAdmin, fetchUsers, updateUserRole } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setUsers(await fetchUsers());
    setLoading(false);
  }, [fetchUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setSavingUserId(userId);
    const result = await updateUserRole(userId, role);
    if (!result.success) {
      alert(result.error || 'Failed to update role');
    }
    await loadUsers();
    setSavingUserId(null);
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-8 text-center">
        <Shield className="w-10 h-10 text-indigo-500 mb-3" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Admin Access Required</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Only administrators can manage staff accounts and roles.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <UserCog className="w-6 h-6 text-indigo-500" />
              Staff Access
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Create staff accounts through Sign Up, then define each person as Administrator, Teacher, or Support Staff here.</p>
          </div>
          <button
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
          <aside className="space-y-4">
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-500" />
                Adding Staff
              </h3>
              <div className="mt-3 space-y-2 text-xs text-gray-500 dark:text-gray-400">
                <p>Use the Sign In button, switch to Create Account, and register the staff member with their email, password, and name.</p>
                <p>The first account is automatically Administrator. Later accounts start as Teacher.</p>
                <p>Administrators can change any account to a different role in the list on this page.</p>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Role Meaning</h3>
              <div className="mt-3 space-y-3 text-xs text-gray-500 dark:text-gray-400">
                {USER_ROLES.map(role => (
                  <div key={role}>
                    <p className="font-medium text-gray-700 dark:text-gray-200">{ROLE_LABELS[role]}</p>
                    <p>{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Users and Roles</h3>
            </div>
            {loading ? (
              <div className="h-72 flex items-center justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading users
              </div>
            ) : users.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">No users found.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {users.map(user => {
                  const avatar = ROLE_AVATARS[user.role] ?? ROLE_AVATARS.teacher;
                  const AvatarIcon = avatar.icon;
                  return (
                    <div key={user.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 items-center odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-800 dark:even:bg-gray-900/30">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${avatar.wrapper}`}>
                          <AvatarIcon className={`w-4 h-4 ${avatar.iconColor}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{user.display_name}</p>
                          <p className="text-xs text-gray-400 truncate">{user.auth_email}</p>
                        </div>
                      </div>
                      <select
                        value={user.role}
                        disabled={savingUserId === user.id}
                        onChange={event => handleRoleChange(user.id, event.target.value as UserRole)}
                        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 disabled:opacity-50"
                      >
                        {USER_ROLES.map(role => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default UserAccessPanel;
