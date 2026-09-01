import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  InlineLoading,
  InlineNotification,
  Layer,
  Select,
  SelectItem,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from '@carbon/react';
import { Checkmark, Email, Send, UserMultiple } from '@carbon/react/icons';
import { CardHeader, EmptyState, PageHeader, WidgetCard } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useLive } from '@/contexts/LiveContext';
import {
  listStaff,
  loadInbox,
  markAllRead,
  markRead,
  sendMessage,
  type AudienceKind,
  type StaffGroup,
  type StaffMember,
  type StaffMessage,
} from '@/lib/messages';
import styles from './inbox-panel.module.scss';

/**
 * The staff inbox — the first screen migrated to Carbon, and the pattern the rest follow.
 *
 * Components come from `@carbon/react` and icons from `@carbon/react/icons`; everything Carbon does
 * not provide is in the co-located SCSS module beside this file, written against Carbon's spacing
 * and theme tokens. That is the OpenMRS convention, and it is what keeps a screen looking like the
 * design system rather than like a set of one-off decisions.
 *
 * Messages arrive on the live channel rather than by asking again — the first load is the only
 * fetch in a normal session. Staff messages and system events share the list because they share a
 * table and a purpose: a gate refusal and a note from the head teacher are both something you have
 * to look at.
 */

const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  user: 'to you',
  role: 'to your role',
  designation: 'to your team',
  all: 'to everyone',
};

const when = (iso: string) => {
  const at = new Date(iso);
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const InboxPanel: React.FC = () => {
  const { user } = useAuth();
  const { connected, online, subscribe, refreshUnread, setUnread } = useLive();

  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [groups, setGroups] = useState<StaffGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receipts, setReceipts] = useState<Record<string, string[]>>({});

  const [form, setForm] = useState({
    audienceKind: 'user' as AudienceKind,
    audienceValue: '',
    recipientEmail: '',
    subject: '',
    body: '',
    priority: 'normal' as 'normal' | 'high',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [inbox, directory] = await Promise.all([loadInbox(), listStaff()]);
        if (cancelled) return;
        setMessages(inbox.messages);
        setUnread(inbox.unread);
        setStaff(directory.staff);
        setGroups(directory.groups);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the inbox');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setUnread]);

  // Live arrivals go straight into the list. Guarded against duplicates because a reconnect replays
  // what was missed, and "missed" is decided by a cursor that can overlap by one.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'message') {
          setMessages((current) =>
            current.some((message) => message.id === event.message.id)
              ? current
              : [event.message, ...current],
          );
        } else if (event.type === 'read') {
          setReceipts((current) => {
            const readers = current[event.read.messageId] || [];
            return readers.includes(event.read.readerName)
              ? current
              : { ...current, [event.read.messageId]: [...readers, event.read.readerName] };
          });
        }
      }),
    [subscribe],
  );

  const openMessage = useCallback(
    async (message: StaffMessage) => {
      if (message.read) return;
      setMessages((current) =>
        current.map((entry) => (entry.id === message.id ? { ...entry, read: true } : entry)),
      );
      try {
        await markRead(message.id);
        await refreshUnread();
      } catch {
        // The optimistic tick stands; the next load corrects it if the write failed.
      }
    },
    [refreshUnread],
  );

  const readEverything = useCallback(async () => {
    setBusy(true);
    try {
      const result = await markAllRead();
      setMessages(result.messages);
      setUnread(result.unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark them read');
    } finally {
      setBusy(false);
    }
  }, [setUnread]);

  const send = useCallback(async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await sendMessage({
        subject: form.subject,
        body: form.body,
        audienceKind: form.audienceKind,
        audienceValue: form.audienceValue,
        recipientEmail: form.recipientEmail,
        priority: form.priority,
      });
      setForm((current) => ({ ...current, subject: '', body: '' }));
      setNotice('Sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the message');
    } finally {
      setBusy(false);
    }
  }, [form]);

  const canSend =
    form.subject.trim() !== '' &&
    form.body.trim() !== '' &&
    (form.audienceKind !== 'user' || form.recipientEmail !== '') &&
    (form.audienceKind === 'user' || form.audienceKind === 'all' || form.audienceValue !== '');

  const onlineIds = useMemo(() => new Set(online.map((person) => person.id)), [online]);
  const unreadHere = messages.filter((message) => !message.read).length;

  return (
    <div className={styles.panel}>
      <PageHeader title="Messages" illustration={<Email size={32} />}>
        <span
          className={`${styles.status} ${connected ? styles.statusLive : ''}`}
          title={connected ? 'New messages arrive instantly' : 'Reconnecting — messages will still be here'}
        >
          {connected ? 'Live' : 'Offline'}
        </span>
        {unreadHere > 0 && <Tag type="blue" size="sm">{unreadHere} unread</Tag>}
        {unreadHere > 0 && (
          <Button kind="ghost" size="sm" renderIcon={Checkmark} onClick={readEverything} disabled={busy}>
            Mark all read
          </Button>
        )}
      </PageHeader>

      <div className={styles.body}>
        <div className={styles.columns}>
          <div className={styles.messages}>
            {error && (
              <InlineNotification
                kind="error"
                title="Something went wrong"
                subtitle={error}
                onCloseButtonClick={() => setError('')}
                lowContrast
              />
            )}

            {loading ? (
              <InlineLoading description="Loading messages…" />
            ) : messages.length === 0 ? (
              <EmptyState
                headerTitle="Inbox"
                displayText="messages"
                helperText="Notes from colleagues and school events will appear here."
              />
            ) : (
              messages.map((message) => (
                <Layer key={message.id}>
                  <Tile
                    className={`${styles.message} ${message.read ? '' : styles.unread}`}
                    onClick={() => openMessage(message)}
                  >
                    <div className={styles.messageHead}>
                      <strong className={styles.subject}>{message.subject}</strong>
                      <span>
                        {message.priority === 'high' && (
                          <Tag type="red" size="sm">urgent</Tag>
                        )}
                        {message.category === 'event' && (
                          <Tag type="cool-gray" size="sm">event</Tag>
                        )}
                      </span>
                    </div>

                    <p className={styles.messageBody}>{message.body}</p>

                    <div className={styles.messageMeta}>
                      <span>{message.sender_name || 'System'}</span>
                      <span>{AUDIENCE_LABEL[message.audience_kind]}</span>
                      <span>{when(message.created_at)}</span>
                      {receipts[message.id]?.length > 0 && (
                        <span className={styles.receipt}>read by {receipts[message.id].join(', ')}</span>
                      )}
                    </div>
                  </Tile>
                </Layer>
              ))
            )}
          </div>

          <div className={styles.aside}>
            <WidgetCard>
              <CardHeader title="New message" />
              <div className={styles.composeFields}>
                  <Select
                    id="audience-kind"
                    labelText="To"
                    value={form.audienceKind}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        audienceKind: event.target.value as AudienceKind,
                        audienceValue: '',
                        recipientEmail: '',
                      })
                    }
                  >
                    <SelectItem value="user" text="One person" />
                    <SelectItem value="role" text="Everyone in a role" />
                    <SelectItem value="designation" text="A team" />
                    <SelectItem value="all" text="Everybody" />
                  </Select>

                  {form.audienceKind === 'user' && (
                    <Select
                      id="recipient"
                      labelText="Colleague"
                      value={form.recipientEmail}
                      onChange={(event) => setForm({ ...form, recipientEmail: event.target.value })}
                    >
                      <SelectItem value="" text="Choose a colleague…" />
                      {staff.map((person) => (
                        <SelectItem
                          key={person.id}
                          value={person.auth_email}
                          text={`${person.display_name} — ${person.role.replace('_', ' ')}${
                            onlineIds.has(person.id) ? ' (online)' : ''
                          }`}
                        />
                      ))}
                    </Select>
                  )}

                  {form.audienceKind === 'role' && (
                    <Select
                      id="role"
                      labelText="Role"
                      value={form.audienceValue}
                      onChange={(event) => setForm({ ...form, audienceValue: event.target.value })}
                    >
                      <SelectItem value="" text="Choose a role…" />
                      <SelectItem value="admin" text="Administrators" />
                      <SelectItem value="teacher" text="Teachers" />
                      <SelectItem value="support_staff" text="Support staff" />
                    </Select>
                  )}

                  {form.audienceKind === 'designation' && (
                    <Select
                      id="designation"
                      labelText="Team"
                      value={form.audienceValue}
                      onChange={(event) => setForm({ ...form, audienceValue: event.target.value })}
                    >
                      <SelectItem value="" text="Choose a team…" />
                      {groups
                        .filter((group) => group.designation)
                        .map((group) => (
                          <SelectItem
                            key={`${group.role}-${group.designation}`}
                            value={group.designation as string}
                            text={`${group.designation} (${group.members})`}
                          />
                        ))}
                    </Select>
                  )}

                  <TextInput
                    id="subject"
                    labelText="Subject"
                    value={form.subject}
                    onChange={(event) => setForm({ ...form, subject: event.target.value })}
                  />

                  <TextArea
                    id="body"
                    labelText="Message"
                    rows={5}
                    value={form.body}
                    onChange={(event) => setForm({ ...form, body: event.target.value })}
                  />

                  <Checkbox
                    id="urgent"
                    labelText="Mark urgent"
                    checked={form.priority === 'high'}
                    onChange={(_event, { checked }) =>
                      setForm({ ...form, priority: checked ? 'high' : 'normal' })
                    }
                  />

                  {notice && (
                    <InlineNotification
                      kind="success"
                      title={notice}
                      onCloseButtonClick={() => setNotice('')}
                      lowContrast
                      hideCloseButton={false}
                    />
                  )}

                <Button renderIcon={Send} onClick={send} disabled={!canSend || busy}>
                  {busy ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </WidgetCard>

            <WidgetCard>
              <CardHeader title={`Online now (${online.length})`}>
                <UserMultiple size={16} className={styles.presenceIcon} />
              </CardHeader>
              {online.length === 0 ? (
                <p className={styles.asideNote}>Nobody else is signed in right now.</p>
              ) : (
                  <ul className={styles.presenceList}>
                    {online
                      .filter((person) => person.id !== user?.id)
                      .map((person) => (
                      <li key={person.id} className={styles.presenceRow}>
                        <span className={styles.presenceDot} />
                        {person.name}
                        <span className={styles.presenceRole}>{person.role.replace('_', ' ')}</span>
                      </li>
                      ))}
                </ul>
              )}
            </WidgetCard>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InboxPanel;
