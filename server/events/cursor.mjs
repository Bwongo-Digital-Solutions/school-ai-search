/**
 * A position in one school's message stream.
 *
 * Its own module, not part of replay.mjs, because both ends of the stream need it and putting it at
 * either end makes a cycle: audience.mjs stamps a cursor onto every replayable event, and replay.mjs
 * reads one back to decide where to resume. Both import from here and neither imports the other.
 *
 * The cursor is the last event a client saw: its creation time *and* its id. Time alone is not
 * enough — two messages written in the same microsecond would make one of them unreachable — and an
 * id alone has no order, since ids are UUIDs. Serialised as `<iso>|<id>` so it survives an SSE
 * `Last-Event-ID` header, which is a single string and the only channel the protocol gives us.
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
