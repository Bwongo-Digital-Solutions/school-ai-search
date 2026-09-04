/**
 * The cross-process half of the event bus.
 *
 * bus.mjs fans an event out to the subscribers in *this* process. That is the whole story on a
 * single container, which is what most schools run — and why this is off by default. It stops being
 * the whole story the moment there are two: a gate scan arriving at replica A has to reach the
 * office tab connected to replica B, and a Map in one heap cannot do that.
 *
 * So: `publish` hands the event here as well, this puts it on a Redis channel, and every replica
 * subscribed to that channel delivers it locally. Nothing above bus.mjs changes — not sse.mjs, not
 * the browser client, not the inbox. The bus's own header promised exactly this seam; this is it.
 *
 * Three decisions worth knowing:
 *
 *   - **The event on the wire is the one `messageEvent` already builds.** No second representation.
 *     The audience rule lives twice already (SQL for the inbox, `reaches` for live fan-out) with a
 *     comment saying the two must agree; a third copy in a broker envelope is how that promise gets
 *     broken. Each replica runs `reaches` against its own subscribers, exactly as it does now.
 *   - **A channel per tenant**, so a school's events are not merely filtered out of another
 *     school's process but never sent to it. Same reasoning as the bus being keyed by tenant.
 *   - **Loopback is dropped on receipt.** The publishing replica has already delivered locally, so
 *     it tags what it sends with its own id and ignores its own messages coming back. Publishing
 *     only to Redis and waiting for the round trip would be simpler, but it makes every local
 *     delivery depend on a network hop, and a Redis outage would silence an app that does not
 *     otherwise need Redis at all.
 */
import { randomUUID } from 'node:crypto';

const CHANNEL_PREFIX = 'eschool:events:';
const PATTERN = `${CHANNEL_PREFIX}*`;

const brokerEnabled = () => Boolean(String(process.env.REDIS_URL || '').trim());

/**
 * Opens the two connections Redis pub/sub requires.
 *
 * Two, not one, because a connection in subscriber mode accepts no other commands — publishing down
 * the same socket is an error, not a slow path.
 *
 * `createClient` is injectable so the tests drive a fake and never open a socket, the way
 * `runPgDump` is injected into the backup service and `httpClient` into every outbound call.
 */
export const startEventBroker = async ({ createClient, onEvent, url = process.env.REDIS_URL } = {}) => {
  if (!createClient && !brokerEnabled()) {
    // No REDIS_URL: single process, in-memory fan-out, exactly as before. A no-op stop so the
    // caller has nothing to branch on.
    return { publish: null, stop: () => {}, enabled: false };
  }

  const factory = createClient || (async () => {
    const { default: Redis } = await import('ioredis');
    return new Redis(url, {
      // A broker that cannot be reached must not take the app down with it. Every publish is
      // best-effort — the message is already a durable row, and the inbox will show it regardless.
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  });

  // Per broker instance, not per module. In production one process holds one broker and the
  // distinction is invisible — but a module-level id would make two brokers in the same process
  // indistinguishable from each other, which is both wrong in principle and untestable in practice.
  const replicaId = randomUUID();

  const publisher = await factory('publisher');
  const subscriber = await factory('subscriber');

  subscriber.on('pmessage', (_pattern, channel, payload) => {
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Something else is using this channel namespace. Not ours to interpret.
      return;
    }

    // Our own event, already delivered locally before it was ever published.
    if (!parsed || parsed.replica === replicaId) return;

    const tenantId = channel.slice(CHANNEL_PREFIX.length);
    if (!tenantId || !parsed.event) return;

    onEvent?.(tenantId, parsed.event);
  });

  // Errors are logged and swallowed rather than thrown: ioredis reconnects on its own, and an
  // unhandled 'error' event on a Redis client takes the process down.
  const warn = (which) => (error) =>
    console.warn(`Event broker (${which}):`, error instanceof Error ? error.message : error);
  publisher.on('error', warn('publisher'));
  subscriber.on('error', warn('subscriber'));

  await subscriber.psubscribe(PATTERN);

  return {
    enabled: true,
    replicaId,
    /** Best-effort. A failure here never fails the action that produced the event. */
    publish: (tenantId, event) => {
      if (!tenantId || !event) return;
      publisher
        .publish(`${CHANNEL_PREFIX}${tenantId}`, JSON.stringify({ replica: replicaId, event }))
        .catch((error) => console.warn('Event broker publish failed:', error?.message || error));
    },
    async stop() {
      try {
        await subscriber.punsubscribe(PATTERN);
      } catch {
        // Shutting down anyway.
      }
      await Promise.allSettled([subscriber.quit?.(), publisher.quit?.()]);
    },
  };
};

export { CHANNEL_PREFIX };
