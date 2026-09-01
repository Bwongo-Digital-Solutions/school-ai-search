import {
  Button,
  InlineLoading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Tag,
  TextInput,
} from '@carbon/react';
import {
  Close,
  Edit as EditIcon,
  Renew,
  Time,
  TrashCan as TrashIcon,
  Tools,
  User as UserIcon,
  UserAdmin,
  UserFollow,
  UserRole as UserRoleIcon,
} from '@carbon/react/icons';
import { AccessDenied, CardHeader, EmptyState, PageHeader, WidgetCard } from '@/components/common';
import styles from './user-access-panel.module.scss';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES } from '@/lib/roles';
import type { UserProfile, UserRole } from '@/types/auth';

// Role is the one thing this list is scanned for, so each row carries it as a tinted square before
// the name — read before the text is, and still there once the reader has stopped reading names.
const ROLE_AVATARS: Record<UserRole, { icon: React.ElementType; tint: string }> = {
  admin: { icon: UserAdmin, tint: styles.avatarAdmin },
  teacher: { icon: UserIcon, tint: styles.avatarTeacher },
  support_staff: { icon: Tools, tint: styles.avatarSupport },
};

const UserAccessPanel: React.FC = () => {
  const { user: currentUser, isAdmin, fetchUsers, updateUserRole, approveAccount, rejectAccount, deleteAccount, updateAccount } = useAuth();
  const { notify } = useNotifications();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', email: '' });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setUsers(await fetchUsers());
    setLoading(false);
  }, [fetchUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Accounts predating the approval feature have no approval_status; treat them as approved.
  const pending = useMemo(() => users.filter(u => u.approval_status === 'pending'), [users]);
  const active = useMemo(() => users.filter(u => u.approval_status !== 'pending'), [users]);

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setSavingUserId(userId);
    const result = await updateUserRole(userId, role);
    if (!result.success) {
      notify.error('Could not change the role', result.error || undefined);
    }
    await loadUsers();
    setSavingUserId(null);
  };

  const handleApprove = async (userId: string) => {
    setSavingUserId(userId);
    const result = await approveAccount(userId);
    if (!result.success) {
      notify.error('Could not approve the account', result.error || undefined);
    }
    await loadUsers();
    setSavingUserId(null);
  };

  const handleReject = async () => {
    if (!rejecting) return;
    setSavingUserId(rejecting.id);
    const result = await rejectAccount(rejecting.id);
    if (!result.success) {
      notify.error('Could not reject the account', result.error || undefined);
    }
    setRejecting(null);
    await loadUsers();
    setSavingUserId(null);
  };

  const openEditor = (target: UserProfile) => {
    setEditForm({ displayName: target.display_name, email: target.auth_email });
    setEditing(target);
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setSavingUserId(editing.id);
    const result = await updateAccount(editing.id, {
      displayName: editForm.displayName.trim(),
      email: editForm.email.trim(),
    });
    if (!result.success) {
      // Kept open on failure so the admin can correct the value rather than retype it.
      notify.error('Could not save the account', result.error || undefined);
    } else {
      setEditing(null);
    }
    await loadUsers();
    setSavingUserId(null);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSavingUserId(deleting.id);
    const result = await deleteAccount(deleting.id);
    if (!result.success) {
      notify.error('Could not delete the account', result.error || undefined);
    }
    setDeleting(null);
    await loadUsers();
    setSavingUserId(null);
  };

  if (!isAdmin) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Only administrators can approve sign-ups and set what each member of staff is allowed to see."
      />
    );
  }

  const personRow = (target: UserProfile) => {
    const avatar = ROLE_AVATARS[target.role] ?? ROLE_AVATARS.teacher;
    const AvatarIcon = avatar.icon;
    return (
      <div className={`${styles.avatar} ${avatar.tint}`}>
        <AvatarIcon size={16} />
      </div>
    );
  };

  return (
    <div className={styles.screen}>
      <PageHeader title="Staff access" illustration={<UserRoleIcon size={32} />}>
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={loadUsers} disabled={loading}>
          Refresh
        </Button>
      </PageHeader>

      <div className={styles.body}>
        {/* Sign-ups waiting on a decision. First, because it is the only thing here that is
            somebody else waiting on this administrator. */}
        <WidgetCard>
          <CardHeader title="Waiting for approval">
            {pending.length > 0 && <Tag type="magenta" size="sm">{pending.length}</Tag>}
          </CardHeader>
          {loading ? (
            <div className={styles.loading}>
              <InlineLoading description="Loading…" />
            </div>
          ) : pending.length === 0 ? (
            <p className={`${styles.asideText} ${styles.asideBody}`}>
              Nobody is waiting. New sign-ups appear here before they can sign in.
            </p>
          ) : (
            pending.map((person) => (
              <div key={person.id} className={styles.row}>
                <div className={styles.person}>
                  <div className={`${styles.avatar} ${styles.avatarPending}`}>
                    <Time size={16} />
                  </div>
                  <div className={styles.identity}>
                    <p className={styles.name}>{person.display_name}</p>
                    <p className={styles.email}>{person.auth_email}</p>
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <Button
                    kind="primary"
                    size="sm"
                    renderIcon={UserFollow}
                    disabled={savingUserId === person.id}
                    onClick={() => handleApprove(person.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    kind="danger--ghost"
                    size="sm"
                    renderIcon={Close}
                    disabled={savingUserId === person.id}
                    onClick={() => setRejecting(person)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </WidgetCard>

        <div className={styles.columns}>
          <aside className={styles.aside}>
            <WidgetCard>
              <CardHeader title="Adding staff" />
              <div className={styles.asideBody}>
                <p className={styles.asideText}>
                  Use the sign-in button, switch to Create account, and register the staff member with
                  their email, password and name.
                </p>
                <p className={styles.asideText}>
                  The first account is an approved administrator. Every later sign-up waits above until
                  you approve it, and cannot sign in before then.
                </p>
                <p className={styles.asideText}>Rejecting an account deletes it permanently.</p>
              </div>
            </WidgetCard>

            <WidgetCard>
              <CardHeader title="What each role means" />
              <div className={styles.asideBody}>
                {USER_ROLES.map((role) => (
                  <div key={role}>
                    <p className={styles.roleName}>{ROLE_LABELS[role]}</p>
                    <p className={styles.asideText}>{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                ))}
              </div>
            </WidgetCard>
          </aside>

          <WidgetCard>
            <CardHeader title="Staff and their roles">
              <Tag type="cool-gray" size="sm">{active.length}</Tag>
            </CardHeader>
            {loading ? (
              <div className={styles.loading}>
                <InlineLoading description="Loading staff…" />
              </div>
            ) : active.length === 0 ? (
              <EmptyState headerTitle="Staff" displayText="approved accounts" />
            ) : (
              active.map((person) => {
                // You cannot delete the account you are signed in with — the server refuses it, and
                // hiding the button avoids offering an action that can only fail.
                const isSelf = currentUser?.id === person.id;
                return (
                  <div key={person.id} className={`${styles.row} ${styles.activeRow}`}>
                    <div className={styles.person}>
                      {personRow(person)}
                      <div className={styles.identity}>
                        <p className={styles.name}>
                          {person.display_name}
                          {isSelf && <span className={styles.self}>you</span>}
                        </p>
                        <p className={styles.email}>{person.auth_email}</p>
                      </div>
                    </div>
                    <Select
                      id={`role-${person.id}`}
                      labelText="Role"
                      hideLabel
                      size="sm"
                      value={person.role}
                      disabled={savingUserId === person.id}
                      onChange={(event) => handleRoleChange(person.id, event.target.value as UserRole)}
                    >
                      {USER_ROLES.map((role) => (
                        <SelectItem key={role} value={role} text={ROLE_LABELS[role]} />
                      ))}
                    </Select>
                    <div className={styles.rowActions}>
                      <Button
                        hasIconOnly
                        kind="ghost"
                        size="sm"
                        renderIcon={EditIcon}
                        iconDescription="Edit name and email"
                        tooltipPosition="left"
                        disabled={savingUserId === person.id}
                        onClick={() => openEditor(person)}
                      />
                      {!isSelf && (
                        <Button
                          hasIconOnly
                          kind="danger--ghost"
                          size="sm"
                          renderIcon={TrashIcon}
                          iconDescription="Delete this account"
                          tooltipPosition="left"
                          disabled={savingUserId === person.id}
                          onClick={() => setDeleting(person)}
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </WidgetCard>
        </div>
      </div>

      {/* Editing an account. Carbon's Modal supplies the overlay, focus trap and button row; the
          two fields are Carbon's, which is where the labels and helper text now live. */}
      <Modal
        open={Boolean(editing)}
        modalHeading="Edit account"
        primaryButtonText="Save changes"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !editForm.displayName.trim() || !editForm.email.trim() || savingUserId === editing?.id
        }
        onRequestSubmit={handleUpdate}
        onRequestClose={() => setEditing(null)}
        size="sm"
      >
        <div className={styles.fields}>
          <TextInput
            id="account-name"
            labelText="Display name"
            value={editForm.displayName}
            onChange={(event) => setEditForm({ ...editForm, displayName: event.target.value })}
          />
          <TextInput
            id="account-email"
            type="email"
            labelText="Sign-in email"
            helperText="This is what they sign in with. Change it and they must use the new address next time."
            value={editForm.email}
            onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
          />
          <p className={styles.modalNote}>Use the role dropdown in the list to change permissions.</p>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        danger
        modalHeading="Delete this account?"
        primaryButtonText="Delete account"
        secondaryButtonText="Cancel"
        onRequestSubmit={handleDelete}
        onRequestClose={() => setDeleting(null)}
        size="sm"
      >
        <p className={styles.modalCopy}>
          Permanently delete <strong>{deleting?.display_name}</strong> ({deleting?.auth_email})?
        </p>
        <p className={styles.modalNote}>
          They lose access immediately and would have to sign up again. Records they created — audit
          entries, attendance, lesson plans — are kept.
        </p>
        {deleting?.role === 'admin' && (
          <InlineNotification
            kind="warning"
            title="This is an administrator account"
            subtitle="The last remaining administrator cannot be deleted."
            lowContrast
            hideCloseButton
          />
        )}
      </Modal>

      <Modal
        open={Boolean(rejecting)}
        danger
        modalHeading="Reject this account?"
        primaryButtonText="Reject and delete"
        secondaryButtonText="Cancel"
        onRequestSubmit={handleReject}
        onRequestClose={() => setRejecting(null)}
        size="sm"
      >
        <p className={styles.modalCopy}>
          Reject and permanently delete <strong>{rejecting?.display_name}</strong> ({rejecting?.auth_email})?
        </p>
        <p className={styles.modalNote}>
          This removes the account from the database. The person would have to sign up again.
        </p>
      </Modal>
    </div>
  );
};

export default UserAccessPanel;
