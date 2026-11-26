import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeDraftsMap } from '../shared/chatLogic';

const STORAGE_KEY = 'worktalk_drafts';
const DRAFTS_CHANNEL = 'sgw_drafts_sync';
const DEBOUNCE_SAVE_MS = 350;
const PERIODIC_FLUSH_MS = 2000;

function readStoredDrafts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeDraftsMap(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeStoredDrafts(drafts: Record<string, string>): Record<string, string> | null {
  try {
    const cleaned = sanitizeDraftsMap(drafts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch {
    return null;
  }
}

/**
 * Periodically auto-saves unsent message drafts per room to localStorage as the user types,
 * and synchronizes changes across open browser tabs (모바일 앱 / 웹 확장앱) via BroadcastChannel + storage events.
 */
export function useDraftAutoSave() {
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>(() => readStoredDrafts());
  const [lastSavedAtByRoom, setLastSavedAtByRoom] = useState<Record<string, number>>({});

  const latestDraftsRef = useRef<Record<string, string>>(draftsByRoom);
  const dirtyRoomsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `draft-tab-${Math.random().toString(36).slice(2)}`,
  );

  latestDraftsRef.current = draftsByRoom;

  const flushToStorage = useCallback(() => {
    if (dirtyRoomsRef.current.size === 0) return;
    const cleaned = writeStoredDrafts(latestDraftsRef.current);
    if (cleaned) {
      const now = Date.now();
      const flushedRooms = Array.from(dirtyRoomsRef.current);
      dirtyRoomsRef.current.clear();
      setLastSavedAtByRoom((prev) => {
        const next = { ...prev };
        for (const roomId of flushedRooms) {
          if (cleaned[roomId]?.trim()) {
            next[roomId] = now;
          } else {
            delete next[roomId];
          }
        }
        return next;
      });
      try {
        channelRef.current?.postMessage({
          type: 'drafts:update',
          sourceTabId: tabIdRef.current,
          drafts: cleaned,
        });
      } catch {
        // Ignore closed channel
      }
    }
  }, []);

  const setRoomDraft = useCallback(
    (roomId: string, text: string) => {
      if (!roomId) return;
      setDraftsByRoom((prev) => {
        const next = { ...prev };
        if (!text) {
          delete next[roomId];
        } else {
          next[roomId] = text;
        }
        latestDraftsRef.current = next;
        return next;
      });

      dirtyRoomsRef.current.add(roomId);
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        flushToStorage();
      }, DEBOUNCE_SAVE_MS);
    },
    [flushToStorage],
  );

  useEffect(() => {
    const applyExternalDrafts = (incoming: Record<string, string>) => {
      const sanitized = sanitizeDraftsMap(incoming);
      latestDraftsRef.current = sanitized;
      setDraftsByRoom(sanitized);
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(DRAFTS_CHANNEL);
        channelRef.current = channel;
        channel.onmessage = (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            sourceTabId?: string;
            drafts?: Record<string, string>;
          };
          if (!data || data.sourceTabId === tabIdRef.current) return;
          if (data.type === 'drafts:update' && data.drafts) {
            applyExternalDrafts(data.drafts);
          }
        };
      } catch {
        channelRef.current = null;
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : {};
        applyExternalDrafts(parsed);
      } catch {
        // Ignore malformed storage payload
      }
    };

    const intervalId = window.setInterval(() => {
      flushToStorage();
    }, PERIODIC_FLUSH_MS);

    const handleVisibilityOrUnload = () => {
      flushToStorage();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('beforeunload', handleVisibilityOrUnload);
    document.addEventListener('visibilitychange', handleVisibilityOrUnload);

    return () => {
      window.clearInterval(intervalId);
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('beforeunload', handleVisibilityOrUnload);
      document.removeEventListener('visibilitychange', handleVisibilityOrUnload);
      flushToStorage();
      if (channel) {
        try {
          channel.close();
        } catch {
          // Ignore
        }
      }
      channelRef.current = null;
    };
  }, [flushToStorage]);

  return {
    draftsByRoom,
    lastSavedAtByRoom,
    setRoomDraft,
    flushDraftsNow: flushToStorage,
  };
}
