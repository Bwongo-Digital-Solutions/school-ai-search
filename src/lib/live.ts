import { buildApiUrl } from './supabase';
import type { StaffMessage } from './messages';

/**
 * The live channel — one Server-Sent Events connection for the whole app.
 *
 * The server pushes; nothing here ever needs to push back, which is why this is SSE and not a
 * WebSocket. Two things fall out of that choice for free: the browser reconnects on its own, and it
 * replays what was missed by sending back the id of the last event it saw. The same endpoint serves
 * the mobile apps, which manage that cursor by hand.
 *
 * This is an enhancement, never a dependency. Every screen still works by asking; the channel only
 * saves it from having to ask again. Where `EventSource` does not exist — the serverless demo cannot
 * stream — `connected` stays false and callers fall back to polling.
 */

export interface PresenceState {
  userId: string;
  name: string;
  online: boolean;
  people: { id: string; name: string; role: string; connections: number }[];
}

export interface ReadReceipt {
  messageId: string;
  readerUserId: string;
  readerName: string;
  readAt: string;
}

export type LiveEvent =
  | { type: 'message'; id: string; createdAt: string; message: StaffMessage }
  | { type: 'read'; id: string; read: ReadReceipt }
  | { type: 'presence'; id: string; presence: PresenceState }
  | { type: 'replay_truncated'; id: string; reason: string };

type Listener = (event: LiveEvent) => void;

// Backoff between reconnection attempts. The browser retries on its own, but only for a clean
// stream end; an outright failure (server down, 401) needs this.
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export const liveSupported = () => typeof window !== 'undefined' && 'EventSource' in window;

export const createLiveChannel = () => {
  const listeners = new Set<Listener>();
  const statusListeners = new Set<(connected: boolean) => void>();

  let source: EventSource | null = null;
  let retryMs = RETRY_MIN_MS;
  let retryTimer: number | null = null;
  let stopped = false;
  let connected = false;

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    statusListeners.forEach((listener) => listener(value));
  };

  const emit = (event: LiveEvent) => {
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // One bad listener must not stop the others hearing about the message.
      }
    });
  };

  const open = () => {
    if (stopped || !liveSupported()) return;

    // withCredentials so the session cookie travels — EventSource omits it otherwise, even
    // same-origin, and the server would answer 401.
    source = new EventSource(buildApiUrl('/api/events'), { withCredentials: true });

    source.onopen = () => {
      setConnected(true);
      retryMs = RETRY_MIN_MS;
    };

    // Named events arrive on their own handlers; `onmessage` only catches unnamed ones.
    for (const name of ['message', 'read', 'presence', 'replay_truncated']) {
      source.addEventListener(name, (raw) => {
        try {
          emit(JSON.parse((raw as MessageEvent).data) as LiveEvent);
        } catch {
          // A frame we cannot parse is not worth tearing the connection down for.
        }
      });
    }

    source.onerror = () => {
      setConnected(false);
      source?.close();
      source = null;
      if (stopped) return;

      // Exponential backoff so a server that is down does not get hammered by every open tab.
      retryTimer = window.setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
  };

  return {
    start() {
      stopped = false;
      if (!source) open();
    },
    stop() {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = null;
      source?.close();
      source = null;
      setConnected(false);
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus(listener: (connected: boolean) => void) {
      statusListeners.add(listener);
      listener(connected);
      return () => statusListeners.delete(listener);
    },
    get connected() {
      return connected;
    },
  };
};
