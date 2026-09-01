/**
 * Who an event is addressed to.
 *
 * This is the in-memory twin of `audienceClause` in server/local-backend.mjs, and the two must agree
 * exactly. Recipients are never materialised in this schema: one `internal_messages` row addresses
 * `all`, a `role`, a `designation`, or one `user`, and membership is worked out against the reader
 * at read time. The inbox does that in SQL; live fan-out has to do it in JavaScript, over the
 * subscribers currently connected.
 *
 * Keeping it here, as one pure function, is what makes the agreement testable — the alternative is
 * the rule living twice in two languages and drifting the first time an audience kind is added.
 */

import { encodeCursor } from './cursor.mjs';

const same = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * Does this event reach this person?
 *
 * Mirrors, clause for clause:
 *
 *     (audience_kind = 'all')
 *     OR (audience_kind = 'role' AND audience_value = <their role>)
 *     OR (audience_kind = 'designation' AND audience_value = <their designation>)
 *     OR (audience_kind = 'user' AND recipient_user_id = <their id>)
 *   AND (sender_user_id IS NULL OR sender_user_id <> <their id>)
 *
 * Events that are not addressed to anybody in particular — `presence`, and a `read` receipt, which
 * carries its own recipient — declare `audienceKind: 'user'` like any other, so there is exactly one
 * rule rather than a special case per event type.
 */
export const reaches = (event, user) => {
  if (!event || !user?.id) return false;

  // A broadcast is invisible to its own author: you do not receive your own message to everybody.
  // Null sender means the system sent it, and the system is nobody, so it reaches everyone.
  if (event.senderUserId && same(event.senderUserId, user.id)) return false;

  switch (event.audienceKind) {
    case 'all':
      return true;
    case 'role':
      return same(event.audienceValue, user.role);
    case 'designation':
      // A user with no designation matches no designation-targeted event. In SQL this falls out of
      // `audience_value = NULL` never being true; here it has to be said out loud.
      return Boolean(user.designation) && same(event.audienceValue, user.designation);
    case 'user':
      return same(event.recipientUserId, user.id);
    default:
      return false;
  }
};

/**
 * The event shape published when a message row is written.
 *
 * Built from the row itself so the live payload and the inbox payload cannot disagree about what a
 * message is. The body is included: an inbox entry is small, and leaving it out would make every
 * arrival cost a round trip to render.
 *
 * `id` is the replay cursor, not the row id, and that distinction is the whole of a bug that made
 * catch-up-after-a-reconnect silently do nothing. The browser echoes the last id it saw back as
 * `Last-Event-ID`, and `decodeCursor` needs `<iso>|<id>` to turn that into a position — handed a
 * bare UUID it returns null and `replayMessages` returns an empty list. Replay was written,
 * correct and tested against `replayMessages` directly, and had never once fired over the wire.
 */
export const messageEvent = (row) => ({
  type: 'message',
  id: encodeCursor(row.created_at, row.id),
  audienceKind: row.audience_kind,
  audienceValue: row.audience_value,
  recipientUserId: row.recipient_user_id,
  senderUserId: row.sender_user_id,
  createdAt: row.created_at,
  message: {
    id: row.id,
    subject: row.subject,
    body: row.body,
    category: row.category,
    priority: row.priority,
    sender_name: row.sender_name,
    audience_kind: row.audience_kind,
    audience_value: row.audience_value,
    student_id: row.student_id,
    created_at: row.created_at,
    read: false,
  },
});

/**
 * A read receipt, addressed to the message's author.
 *
 * `senderUserId` is left null on purpose: the reader is not the sender of this event, and setting it
 * would trip the "not to its own author" rule above and drop the receipt.
 */
export const readEvent = ({ messageId, readerUserId, readerName, authorUserId, readAt }) => ({
  type: 'read',
  // No `id`, deliberately. Only replayable events carry one, because the browser echoes the last id
  // it saw as `Last-Event-ID` and that value is a *position in the message stream*. A receipt is not
  // in that stream — giving it an id of its own would move the cursor to somewhere replay cannot
  // resolve, and every message between there and the reconnect would be lost.
  audienceKind: 'user',
  recipientUserId: authorUserId,
  senderUserId: null,
  createdAt: readAt,
  read: { messageId, readerUserId, readerName, readAt },
});

/**
 * Someone connected or disconnected. Everyone in the school sees it; nobody sees their own.
 *
 * No `id`, for the reason given on `readEvent` — and this one was the more damaging of the two.
 * Presence is the *last* thing written on every connect, so its id became the browser's
 * `Last-Event-ID` on every single connection, overwriting whatever real position was there.
 */
export const presenceEvent = ({ user, online, people }) => ({
  type: 'presence',
  audienceKind: 'all',
  senderUserId: null,
  createdAt: new Date().toISOString(),
  presence: { userId: user.id, name: user.name || '', online, people },
});
