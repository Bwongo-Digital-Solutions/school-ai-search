import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { createLiveChannel, liveSupported, type LiveEvent, type PresenceState } from '@/lib/live';
import { loadUnreadCount, type StaffMessage } from '@/lib/messages';

/**
 * One live connection for the whole app.
 *
 * Per-component connections would mean a browser opening one per mounted screen, and browsers cap
 * concurrent connections per origin — six of these and ordinary requests start queueing behind them.
 * So the channel is opened once here and everything subscribes to it.
 *
 * It also owns the unread count, because the badge has to be right whether the number changed
 * because a message arrived on the channel or because the user read one in another tab.
 */

interface LiveContextValue {
  connected: boolean;
  unread: number;
  online: PresenceState['people'];
  /** Subscribe to every event. Returns the unsubscribe. */
  subscribe: (listener: (event: LiveEvent) => void) => () => void;
  /** Re-read the count from the server — after marking things read, say. */
  refreshUnread: () => Promise<void>;
  setUnread: (value: number) => void;
}

const LiveContext = createContext<LiveContextValue | undefined>(undefined);

export const useLive = () => {
  const context = useContext(LiveContext);
  if (!context) throw new Error('useLive must be used within LiveProvider');
  return context;
};

// How often to re-ask for the unread count when the live channel is unavailable — the serverless
// demo, or a proxy that will not stream. Slow on purpose: this is the fallback, not the mechanism.
const POLL_MS = 60_000;

export const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isSupportStaff } = useAuth();

  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState<PresenceState['people']>([]);

  const channel = useMemo(() => createLiveChannel(), []);
  const listeners = useRef(new Set<(event: LiveEvent) => void>());

  const refreshUnread = useCallback(async () => {
    try {
      const { unread: count } = await loadUnreadCount();
      setUnread(count);
    } catch {
      // Not signed in yet, or the server is unreachable. The badge simply does not move.
    }
  }, []);

  useEffect(() => {
    // Support staff have no inbox screen; opening a connection for them would hold a socket open
    // for nothing.
    if (!isAuthenticated || isSupportStaff) {
      channel.stop();
      setUnread(0);
      setOnline([]);
      return;
    }

    void refreshUnread();

    const offEvent = channel.subscribe((event) => {
      if (event.type === 'message') {
        // Count it here rather than re-asking: the arrival itself is the news, and a round trip per
        // message would undo the point of the channel.
        setUnread((current) => current + 1);
      } else if (event.type === 'presence') {
        setOnline(event.presence.people);
      } else if (event.type === 'replay_truncated') {
        // Too much was missed to catch up event by event; trust the server instead.
        void refreshUnread();
      }

      listeners.current.forEach((listener) => listener(event));
    });

    const offStatus = channel.onStatus((value) => {
      setConnected(value);
      // Every reconnect may have missed something the replay could not cover, so re-anchor.
      if (value) void refreshUnread();
    });

    channel.start();

    // Fallback for anywhere the stream cannot run.
    const poll = liveSupported() ? null : window.setInterval(() => void refreshUnread(), POLL_MS);

    return () => {
      offEvent();
      offStatus();
      channel.stop();
      if (poll) window.clearInterval(poll);
    };
  }, [channel, isAuthenticated, isSupportStaff, refreshUnread]);

  const subscribe = useCallback((listener: (event: LiveEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({ connected, unread, online, subscribe, refreshUnread, setUnread }),
    [connected, unread, online, subscribe, refreshUnread],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
};

export type { StaffMessage };
