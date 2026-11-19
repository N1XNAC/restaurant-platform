import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getStoredToken } from './api';
import { realtimeUrl } from './endpoints';
import { useAuth } from './auth';

interface RealtimeContextValue {
  connected: boolean;
  lastAlert: { id: string; title: string; message: string } | null;
  dismissAlert: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  lastAlert: null,
  dismissAlert: () => {},
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState<{ id: string; title: string; message: string } | null>(
    null
  );
  const lastSequenceRef = useRef<number>(0);
  const seenEventsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUser = false;
    let retryMs = 1000;

    const connect = () => {
      if (closedByUser) return;
      const token = getStoredToken() ?? '';
      const params = new URLSearchParams();
      if (token) params.set('token', token);
      if (lastSequenceRef.current > 0) params.set('lastSequence', String(lastSequenceRef.current));

      ws = new WebSocket(realtimeUrl(params));

      ws.onopen = () => {
        setConnected(true);
        retryMs = 1000;
        // Reconcile state on reconnect
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            eventId: string;
            sequence: number;
            type: string;
            payload: Record<string, unknown>;
          };
          if (seenEventsRef.current.has(msg.eventId)) return;
          seenEventsRef.current.add(msg.eventId);
          if (seenEventsRef.current.size > 500) {
            const first = seenEventsRef.current.values().next().value;
            if (first) seenEventsRef.current.delete(first);
          }
          if (msg.sequence > lastSequenceRef.current) {
            lastSequenceRef.current = msg.sequence;
          }

          if (msg.type.startsWith('order.')) {
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
            void queryClient.invalidateQueries({ queryKey: ['analytics'] });
            void queryClient.invalidateQueries({ queryKey: ['tables'] });
            if (msg.type === 'order.created') {
              const order = msg.payload?.order as { orderNumber?: string; table?: { tableNumber?: string } } | undefined;
              setLastAlert({
                id: msg.eventId,
                title: `New Order ${order?.orderNumber ?? ''}`,
                message: `Table ${order?.table?.tableNumber ?? ''} submitted a new order.`,
              });
            }
          } else if (msg.type === 'table.updated') {
            void queryClient.invalidateQueries({ queryKey: ['tables'] });
          } else if (msg.type === 'menu.updated') {
            void queryClient.invalidateQueries({ queryKey: ['menu'] });
          } else if (msg.type === 'inventory.low_stock') {
            void queryClient.invalidateQueries({ queryKey: ['inventory'] });
            void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          } else if (msg.type === 'review.created') {
            void queryClient.invalidateQueries({ queryKey: ['reviews'] });
          } else if (msg.type === 'notification.created') {
            void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closedByUser) {
          reconnectTimer = setTimeout(() => {
            retryMs = Math.min(retryMs * 2, 15000);
            connect();
          }, retryMs);
        }
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [user, queryClient]);

  return (
    <RealtimeContext.Provider
      value={{ connected, lastAlert, dismissAlert: () => setLastAlert(null) }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
