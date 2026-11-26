import { useCallback, useEffect, useRef, useState } from 'react';

export interface SocketEvent {
  event: string;
  payload: Record<string, unknown>;
}

export interface GroupwareSocketOptions {
  onReconnect?: () => void;
}

export function useGroupwareSocket(
  userId: string | null,
  authToken: string | null,
  onEvent: (evt: SocketEvent) => void,
  options?: GroupwareSocketOptions,
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}`,
  );
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(options?.onReconnect);
  onReconnectRef.current = options?.onReconnect;

  useEffect(() => {
    if (!userId || !authToken) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | undefined;
    let hasConnectedOnce = false;

    const connect = async () => {
      if (cancelled) return;
      try {
        const ticketRes = await fetch('/api/ws-ticket', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!ticketRes.ok) {
          throw new Error('Failed to issue WS ticket');
        }
        const { ticket } = (await ticketRes.json()) as { ticket?: string };
        if (!ticket || cancelled) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          const isReconnect = hasConnectedOnce;
          hasConnectedOnce = true;
          setConnected(true);
          if (isReconnect) {
            onReconnectRef.current?.();
          }
        };

        ws.onmessage = (e) => {
          try {
            const parsed = JSON.parse(String(e.data)) as SocketEvent;
            if (parsed && parsed.event) {
              onEventRef.current(parsed);
            }
          } catch {
            // Ignore invalid JSON frames
          }
        };

        ws.onclose = () => {
          if (!cancelled) {
            setConnected(false);
            reconnectTimer = window.setTimeout(() => {
              connect().catch(() => {});
            }, 2200);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        if (!cancelled) {
          setConnected(false);
          reconnectTimer = window.setTimeout(() => {
            connect().catch(() => {});
          }, 2800);
        }
      }
    };

    connect().catch(() => {});

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [userId, authToken]);

  const sendTyping = useCallback(
    (roomId: string, isTyping: boolean) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && userId) {
        ws.send(JSON.stringify({ event: 'typing', payload: { roomId, isTyping } }));
      }
    },
    [userId],
  );

  const sendUiSync = useCallback(
    (patch: { activeRoomId?: string; activeTab?: string }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && userId) {
        ws.send(
          JSON.stringify({
            event: 'ui:sync',
            payload: {
              ...patch,
              sourceClientId: clientIdRef.current,
            },
          }),
        );
      }
    },
    [userId],
  );

  return { connected, clientId: clientIdRef.current, sendTyping, sendUiSync };
}
