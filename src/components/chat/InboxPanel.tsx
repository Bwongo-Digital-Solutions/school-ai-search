import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCheck,
  Circle,
  Inbox,
  Loader2,
  Radio,
  Send,
  Users as UsersIcon,
} from 'lucide-react';
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

/**
 * The staff inbox.
 *
 * Messages arrive on the live channel rather than by asking again — the first load is the only
 * fetch in a normal session. When the channel is unavailable the screen still works; it just shows
 * what it had at load, which is what every screen in the app did before this existed.
 *
 * Staff messages and system events share the list because they share a table and a purpose: a gate
 * refusal and a note from the head teacher are both something you have to look at.
 */

const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  user: 'to you',
  role: 'to your role',
  designation: 'to your team',
  all: 'to everyone',
};

const inputClass =
  'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400';

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
        // The optimistic tick stands; the next load will correct it if the write failed.
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
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Inbox className="w-6 h-6 text-indigo-500" /> Messages
              {unreadHere > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-600 text-white">
                  {unreadHere}
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Staff messages and school events, in one place.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] ${
                connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'
              }`}
              title={connected ? 'New messages arrive instantly' : 'Reconnecting — messages will still be here'}
            >
              <Radio className="w-3.5 h-3.5" /> {connected ? 'Live' : 'Offline'}
            </span>
            {unreadHere > 0 && (
              <button
                type="button"
                onClick={readEverything}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="grid gap-4 lg:grid-cols-[1fr,340px] max-w-6xl">
          <div className="space-y-2">
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
              </p>
            )}

            {loading ? (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </p>
            ) : messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
                <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Nothing yet. Messages from colleagues and school events will appear here.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => openMessage(message)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    message.read
                      ? 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/40'
                      : 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white flex items-center gap-2">
                        {!message.read && <Circle className="w-2 h-2 fill-indigo-500 text-indigo-500 shrink-0" />}
                        {message.subject}
                        {message.priority === 'high' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                            urgent
                          </span>
                        )}
                        {message.category === 'event' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                            event
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">
                        {message.body}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        {message.sender_name || 'System'} · {AUDIENCE_LABEL[message.audience_kind]} ·{' '}
                        {when(message.created_at)}
                        {receipts[message.id]?.length > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {' '}
                            · read by {receipts[message.id].join(', ')}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2 mb-3">
                <Send className="w-4 h-4 text-indigo-500" /> New message
              </h3>

              <div className="space-y-2">
                <label className="block">
                  <span className="text-[11px] text-gray-600 dark:text-gray-300">To</span>
                  <select
                    value={form.audienceKind}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        audienceKind: event.target.value as AudienceKind,
                        audienceValue: '',
                        recipientEmail: '',
                      })
                    }
                    className={inputClass}
                  >
                    <option value="user">One person</option>
                    <option value="role">Everyone in a role</option>
                    <option value="designation">A team</option>
                    <option value="all">Everybody</option>
                  </select>
                </label>

                {form.audienceKind === 'user' && (
                  <select
                    value={form.recipientEmail}
                    onChange={(event) => setForm({ ...form, recipientEmail: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choose a colleague…</option>
                    {staff.map((person) => (
                      <option key={person.id} value={person.auth_email}>
                        {person.display_name} — {person.role.replace('_', ' ')}
                        {onlineIds.has(person.id) ? ' (online)' : ''}
                      </option>
                    ))}
                  </select>
                )}

                {form.audienceKind === 'role' && (
                  <select
                    value={form.audienceValue}
                    onChange={(event) => setForm({ ...form, audienceValue: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choose a role…</option>
                    <option value="admin">Administrators</option>
                    <option value="teacher">Teachers</option>
                    <option value="support_staff">Support staff</option>
                  </select>
                )}

                {form.audienceKind === 'designation' && (
                  <select
                    value={form.audienceValue}
                    onChange={(event) => setForm({ ...form, audienceValue: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choose a team…</option>
                    {groups
                      .filter((group) => group.designation)
                      .map((group) => (
                        <option key={`${group.role}-${group.designation}`} value={group.designation as string}>
                          {group.designation} ({group.members})
                        </option>
                      ))}
                  </select>
                )}

                <input
                  value={form.subject}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                  className={inputClass}
                  placeholder="Subject"
                />
                <textarea
                  value={form.body}
                  onChange={(event) => setForm({ ...form, body: event.target.value })}
                  className={`${inputClass} min-h-[7rem] resize-y`}
                  placeholder="Message"
                />

                <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.priority === 'high'}
                    onChange={(event) =>
                      setForm({ ...form, priority: event.target.checked ? 'high' : 'normal' })
                    }
                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
                  />
                  Mark urgent
                </label>

                {notice && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{notice}</p>}

                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend || busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2 mb-2">
                <UsersIcon className="w-4 h-4 text-indigo-500" /> Online now
                <span className="text-xs font-normal text-gray-400">{online.length}</span>
              </h3>
              {online.length === 0 ? (
                <p className="text-[11px] text-gray-400">Nobody else is signed in right now.</p>
              ) : (
                <ul className="space-y-1">
                  {online
                    .filter((person) => person.id !== user?.id)
                    .map((person) => (
                      <li key={person.id} className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
                        <Circle className="w-2 h-2 fill-emerald-500 text-emerald-500" />
                        {person.name}
                        <span className="text-gray-400">{person.role.replace('_', ' ')}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InboxPanel;
