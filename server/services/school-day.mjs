/**
 * Where the school's day begins and ends.
 *
 * A gate pass is good for the day it was granted and no longer, which makes "midnight" a
 * value this server has to agree on with the phone at the gate. It cannot be UTC midnight:
 * the schools this runs for are in Kampala, three hours ahead, so a UTC boundary would
 * expire the day's slips at three in the morning and let a slip granted late on Monday
 * evening count as Tuesday's. The app already went out of its way to avoid exactly that
 * (see todayIso in the app's format.js), and this is the server's half of the same care.
 *
 * The zone is resolved through Intl rather than a stored offset, so a school on a zone that
 * observes daylight saving gets the right answer twice a year without anybody editing a
 * constant. Uganda does not, but the next tenant might.
 */

const DEFAULT_TIMEZONE = 'Africa/Kampala';

export const schoolTimezone = () => process.env.SCHOOL_TIMEZONE || DEFAULT_TIMEZONE;

/* What the wall clock in `timeZone` reads at this instant, as numbers. */
const wallClock = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') read[part.type] = Number(part.value);
  });
  // Midnight comes back as hour 24 from some ICU versions rather than 0.
  if (read.hour === 24) read.hour = 0;
  return read;
};

/**
 * How far `timeZone` is ahead of UTC at this instant, in milliseconds.
 *
 * Derived by reading the wall clock in that zone and asking what UTC instant those same
 * numbers would be — the difference is the offset, daylight saving included.
 */
const offsetAt = (instant, timeZone) => {
  const c = wallClock(instant, timeZone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  // Milliseconds are dropped by the formatter, so compare against a whole second.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/**
 * The instant at which the school's current day began — local midnight, expressed as a
 * Date so it can be handed to a query as a parameter. Doing the arithmetic here rather
 * than in SQL keeps `AT TIME ZONE` out of the queries, which matters because the
 * development database is pg-mem and would not exercise it.
 */
export const startOfSchoolDay = (now = new Date(), timeZone = schoolTimezone()) => {
  const offset = offsetAt(now, timeZone);
  /* Shift into the zone, take the date there, and shift back. The offset at midnight can
     differ from the offset now on a daylight-saving day, so it is measured again at the
     candidate instant and the answer corrected once. */
  const local = new Date(now.getTime() + offset);
  const midnightUtcNumbers = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );

  const firstGuess = new Date(midnightUtcNumbers - offset);
  const offsetThen = offsetAt(firstGuess, timeZone);
  return offsetThen === offset ? firstGuess : new Date(midnightUtcNumbers - offsetThen);
};

/** The school's current date as YYYY-MM-DD, for anything keyed on a calendar day. */
export const schoolToday = (now = new Date(), timeZone = schoolTimezone()) => {
  const c = wallClock(now, timeZone);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
};

export default { startOfSchoolDay, schoolToday, schoolTimezone };
