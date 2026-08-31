/**
 * The live channel: `GET /api/events`, Server-Sent Events.
 *
 * One endpoint serves browsers and the mobile apps. SSE rather than WebSocket because the traffic
 * only ever goes one way — nothing here needs the client to push — and because plain HTTP streaming
 * costs nothing to get through the stack: the proxies already set `proxy_buffering off`, no upgrade
 * handler is needed, and reconnect-with-replay is part of the protocol rather than something each
 * client has to invent.
 *
 * This is the only file that touches a socket. `dispatch` returns plain `{type, status, body}`
 * objects and every response is one `writeHead` plus one `end`, which a stream cannot be expressed
 * as — so this is handled in the HTTP layer ahead of `dispatch`, the way the OPTIONS preflight is.
 * Everything with a decision in it (who receives what, what to replay) lives in the sibling modules,
 * which have no socket and are tested through the ordinary test runtime.
 */
import { authenticateRequest } from '../auth/actor.mjs';
import { corsHeaders } from '../http/cors.mjs';
import { securityHeaders } from '../http/security-headers.mjs';
import { presence as busPresence, publish, subscribe } from './bus.mjs';
import { presenceEvent } from './audience.mjs';
import { encodeCursor, replayMessages } from './replay.mjs';

export const EVENTS_PATH = '/api/events';

/**
 * Both proxies cut an idle connection at `proxy_read_timeout 300s`. A comment line every 25 seconds
 * keeps it open and, just as usefully, is what makes a dead connection fail fast: the write throws
 * and the connection is torn down rather than lingering as a subscriber nobody can reach.
 */
const HEARTBEAT_MS = 25_000;

/**
 * How often to re-check that the person on the other end is still allowed to be there.
 *
 * Every request path re-reads the user's row, so a demotion takes effect on the next click. A
 * connection held open for hours would otherwise keep whatever it was granted when it opened —
 * the one place in the app where authentication is point-in-time. This closes that window.
 */
const REAUTH_MS = 60_000;

const frame = (event) => {
  const lines = [];
  if (event.id) lines.push(`id: ${event.id}`);
  if (event.type) lines.push(`event: ${event.type}`);
  lines.push(`data: ${JSON.stringify(event)}`);
  return `${lines.join('\n')}\n\n`;
};

/** Is this the events endpoint? Checked before the body is read, since a GET has none. */
export const isEventsRequest = (method, pathname) => method === 'GET' && pathname === EVENTS_PATH;

/**
 * Opens the stream. Returns true when it took ownership of the response.
 *
 * `resolveDatabase` has already run, so `database` and `tenantId` are the ones for this school —
 * the subscriber registry is keyed by that tenant and a school's events can never reach another.
 */
export const handleEventsRequest = async ({ request, response, database, tenantId, searchParams }) => {
  const actor = await authenticateRequest({ database, headers: request.headers, tenantId });

  if (!actor) {
    response.writeHead(401, {
      ...corsHeaders(response),
      ...securityHeaders(response),
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return true;
  }

  response.writeHead(200, {
    ...corsHeaders(response),
    ...securityHeaders(response),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Belt and braces: proxy_buffering is already off in both shipped configs, but a proxy nobody
    // told us about would otherwise hold every event until the response ended, which is never.
    'X-Accel-Buffering': 'no',
  });

  // Flush the headers immediately. Without this a client waits for the first event before it
  // believes it is connected, and `EventSource.onopen` never fires.
  response.write(': connected\n\n');

  let open = true;
  const send = (event) => {
    if (!open) return;
    response.write(frame(event));
  };

  // The subscriber's user is a snapshot, refreshed by the re-auth timer below. Audience matching
  // reads role and designation from it, so a change of either takes effect there.
  const subscriber = { user: { ...actor }, deliver: send };
  const unsubscribe = subscribe(tenantId, subscriber);

  const close = () => {
    if (!open) return;
    open = false;

    clearInterval(heartbeat);
    clearInterval(reauth);
    unsubscribe();

    // Tell the school someone went offline — but only once their last connection has gone, so a
    // second tab closing does not read as leaving.
    try {
      const people = busPresence(tenantId);
      if (!people.some((person) => person.id === actor.id)) {
        publish(tenantId, presenceEvent({ user: actor, online: false, people }));
      }
    } catch {
      // Shutting down; nothing here is worth failing for.
    }

    try {
      response.end();
    } catch {
      // Already gone.
    }
  };

  const heartbeat = setInterval(() => {
    try {
      response.write(': ping\n\n');
    } catch {
      close();
    }
  }, HEARTBEAT_MS);

  const reauth = setInterval(async () => {
    try {
      const current = await authenticateRequest({ database, headers: request.headers, tenantId });
      if (!current) {
        // Deleted, un-approved, or the session expired. Drop it; the client will reconnect and be
        // told 401, which is how it learns to sign in again.
        close();
        return;
      }
      subscriber.user = { ...current };
    } catch {
      // A database blip is not a reason to sign someone out. Try again next tick.
    }
  }, REAUTH_MS);

  request.on('close', close);
  request.on('error', close);
  response.on('error', close);

  // Catch up before announcing presence, so the client has a coherent history first. The cursor
  // comes from the browser's own Last-Event-ID header, or from ?since= for a client that has to
  // manage it by hand.
  const cursor = request.headers['last-event-id'] || searchParams?.get('since') || '';
  if (cursor) {
    try {
      const { events, truncated } = await replayMessages(database, actor, {
        cursor,
        audienceClause: audienceClauseRef,
      });
      for (const event of events) send(event);
      if (truncated) {
        send({
          type: 'replay_truncated',
          id: '',
          // The client has been away too long to catch up event by event and should reload.
          reason: 'Too many missed messages; reload the inbox.',
        });
      }
    } catch (error) {
      console.warn('Could not replay missed events:', error instanceof Error ? error.message : error);
    }
  }

  try {
    const people = busPresence(tenantId);
    send(presenceEvent({ user: actor, online: true, people }));
    publish(tenantId, presenceEvent({ user: actor, online: true, people }));
  } catch {
    // Presence is a nicety; never let it take the connection down.
  }

  return true;
};

/**
 * `audienceClause` lives in local-backend.mjs, which imports this module's siblings — importing it
 * back would be a cycle. The HTTP layer hands it over at startup instead.
 */
let audienceClauseRef = null;
export const useAudienceClause = (fn) => {
  audienceClauseRef = fn;
};

export { encodeCursor };
