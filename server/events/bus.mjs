/**
 * Fan-out for live events, in process.
 *
 * The whole of it is a Map of tenant to subscribers. There is no broker because there is nothing
 * for a broker to do: one container runs this app, so the code that publishes an event and the code
 * that delivers it share a heap. Redis between them would add a service to run and a failure mode to
 * handle, and carry the message about a metre.
 *
 * This module is the seam where that changes. If a second app replica ever appears, `publish` grows
 * a Redis (or NATS) backend and nothing above this file knows — the subscriber side is already an
 * interface rather than a socket.
 *
 * **Keyed by tenant first, always.** One process serves every school. A bus keyed only by user id
 * would let a broadcast in one school reach a subscriber in another, which is exactly the failure
 * the database-per-tenant design exists to prevent. Every function here takes a tenant, and there is
 * deliberately no way to publish without one.
 *
 * Durability is not this module's job. Every message is already a row in Postgres; an event is a
 * notification that the row exists, and a subscriber that missed one catches up by replaying from
 * the database rather than from any buffer here.
 */
import { reaches } from './audience.mjs';

/** tenantId -> Set<subscriber>. Empty tenants are dropped so a long-lived process does not grow. */
const byTenant = new Map();

/**
 * Registers a subscriber and returns the function that removes it.
 *
 * A subscriber is `{ user, deliver }`, where `user` is the actor the connection authenticated as
 * (id, role, designation) and `deliver(event)` writes to whatever transport it holds. The bus never
 * knows what that transport is, which is what keeps it testable without a socket.
 */
export const subscribe = (tenantId, subscriber) => {
  if (!tenantId || !subscriber?.deliver) {
    throw new Error('subscribe needs a tenantId and a subscriber with deliver()');
  }

  const set = byTenant.get(tenantId) || new Set();
  set.add(subscriber);
  byTenant.set(tenantId, set);

  return () => {
    const current = byTenant.get(tenantId);
    if (!current) return;

    current.delete(subscriber);
    if (current.size === 0) byTenant.delete(tenantId);
  };
};

/**
 * Delivers an event to every subscriber in one school that it is addressed to.
 *
 * Returns how many received it, which is what the tests assert on. A subscriber whose `deliver`
 * throws — a socket that died between the write and the callback — is counted as not delivered and
 * never allowed to interrupt the fan-out: one broken connection must not stop the other forty
 * people getting their message.
 */
export const publish = (tenantId, event) => {
  const set = byTenant.get(tenantId);
  if (!set || set.size === 0) return 0;

  let delivered = 0;
  for (const subscriber of set) {
    if (!reaches(event, subscriber.user)) continue;

    try {
      subscriber.deliver(event);
      delivered += 1;
    } catch {
      // The transport is gone; its own close handler will unsubscribe it.
    }
  }
  return delivered;
};

/** The subscribers for one school. Used by presence, and by the tests. */
export const subscribers = (tenantId) => [...(byTenant.get(tenantId) || [])];

/**
 * Who is currently connected in one school, one entry per person however many devices they have.
 *
 * Presence is derived from live connections rather than stored, so it cannot go stale: a process
 * restart empties it, which is the truth.
 */
export const presence = (tenantId) => {
  const people = new Map();

  for (const subscriber of subscribers(tenantId)) {
    const { id, name, role } = subscriber.user || {};
    if (!id) continue;

    const existing = people.get(id);
    if (existing) existing.connections += 1;
    else people.set(id, { id, name: name || '', role: role || '', connections: 1 });
  }

  return [...people.values()];
};

/** Test and shutdown helper: forget every subscriber, in one school or in all of them. */
export const reset = (tenantId) => {
  if (tenantId) byTenant.delete(tenantId);
  else byTenant.clear();
};
