/**
 * Catch-up: what a client missed while it was not connected.
 *
 * This is the difference between a channel a phone can trust and one it cannot. A browser tab is
 * usually connected for as long as it is open; a mobile app is backgrounded, loses signal, switches
 * from wifi to cellular, and reconnects constantly. Without replay every one of those gaps silently
 * drops messages, and the app can only be made correct again by refetching everything each time.
 *
 * Replay reads from Postgres, not from any buffer here, so it survives a process restart and cannot
 * disagree with the inbox. It reuses the same audience predicate the inbox uses, which is what
 * guarantees a client can never receive by replay something it could not have seen by asking.
 */
import { messageEvent } from './audience.mjs';

// A reconnecting client that has been away for a long time should catch up, not receive a thousand
// events at once. Beyond this it is cheaper and more honest for the client to reload its inbox.
const MAX_REPLAY = 200;

/**
 * The cursor is the last event a client saw: its creation time and its id.
 *
 * Time alone is not enough — two messages written in the same microsecond would make one of them
 * unreachable — and an id alone has no order, since ids are UUIDs. Serialised as `<iso>|<id>` so it
 * survives an SSE `Last-Event-ID` header, which is a single string.
 */
export const encodeCursor = (createdAt, id) => {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt || '');
  return iso && id ? `${iso}|${id}` : '';
};

export const decodeCursor = (cursor) => {
  const [iso, id] = String(cursor || '').split('|');
  if (!iso || !id) return null;

  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : { at: at.toISOString(), id };
};

/**
 * Every message addressed to this user that was created after the cursor.
 *
 * `audienceClause` is injected rather than imported: it lives in local-backend.mjs, which imports
 * the bus, and reaching back into it from here would make a cycle.
 *
 * The comparison is written out as two predicates rather than a row-value `(a, b) > (c, d)`, which
 * pg-mem does not implement — and pg-mem backs both the test suite and the Vercel demo.
 */
export const replayMessages = async (database, user, { cursor, audienceClause, limit = MAX_REPLAY } = {}) => {
  const from = decodeCursor(cursor);
  if (!from) return { events: [], truncated: false };

  const where = audienceClause(user, 1);
  const capped = Math.min(Number(limit) || MAX_REPLAY, MAX_REPLAY);

  const { rows } = await database.query(
    `
      SELECT m.*
      FROM internal_messages m
      WHERE ${where.sql}
        AND (m.created_at > $4 OR (m.created_at = $4 AND m.id > $5))
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT ${capped + 1}
    `,
    [...where.values, from.at, from.id],
  );

  // One more than asked for tells us there is more, without a second count query. The client is
  // told, so it can choose to reload the inbox instead of assuming it is caught up.
  const truncated = rows.length > capped;

  return {
    events: rows.slice(0, capped).map(messageEvent),
    truncated,
  };
};
