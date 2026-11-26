import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarCheck2,
  CheckCircle2,
  Download,
  FolderOpen,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Moon,
  PanelLeft,
  Plus,
  Siren,
  Smartphone,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { Avatar } from './components/Avatar';
import { ChatListPanel } from './components/ChatListPanel';
import { ChatRoomView } from './components/ChatRoomView';
import { ControlTowerDrawer, type ControlTowerTab } from './components/ControlTowerDrawer';
import { EmergencyAlertBanner, type EmergencyAlertData } from './components/EmergencyAlertBanner';
import { ForwardModal } from './components/chat/ForwardModal';
import { FileVaultView } from './components/FileVaultView';
import { FriendsDirectory } from './components/FriendsDirectory';
import { LeavePortalView } from './components/LeavePortalView';
import { MailReaderModal } from './components/MailReaderModal';
import {
  ImageLightboxModal,
  NewChatModal,
  NoticeModal,
  PollModal,
  ProfileModal,
} from './components/Modals';
import {
  InstallTargetsModal,
  OfflineIndicator,
  PWAInstallButton,
} from './components/PWAInstallControls';
import { RightInspectorPanel } from './components/RightInspectorPanel';
import {
  buildIntegrationHostEvent,
  isTrustedSgwOrigin,
  postSgwHostEvent,
} from './chat/adapter';
import { useDraftAutoSave } from './hooks/useDraftAutoSave';
import { useGroupwareSocket, type SocketEvent } from './hooks/useGroupwareSocket';
import { hasUnreadMentionForUser } from './shared/chatLogic';
import {
  getRoomDisplayName,
  getRoomUnreadCount,
  isUserOnLeaveOnDate,
} from './shared/logic';
import {
  playEmergencyAlertSound,
  stopEmergencyAlertSound,
  triggerBrowserEmergencyNotification,
} from './utils/voiceAudio';
import {
  PRESENCE_LABELS,
  type AppTab,
  type BootstrapPayload,
  type ChatRoom,
  type InspectorTab,
  type IntegrationActionSummary,
  type LeaveRequest,
  type LeaveType,
  type MailMessage,
  type Message,
  type Notice,
  type NoticePriority,
  type NotificationItem,
  type PollData,
  type PresenceStatus,
  type ScheduleCardData,
  type ScheduledMessageItem,
  type SedmsMenuKey,
  type ShareProvider,
  type SharedFileItem,
  type ThemeMode,
  type ToastNotification,
  type User,
  type ViewMode,
  type VoiceAttachment,
} from './types/client';

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export interface AppProps {
  lockedTarget?: 'extension' | 'mobile';
}

export default function App({ lockedTarget }: AppProps) {
  // Security: Keep session ID, Bearer auth token, and file-scope token strictly in React memory.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [fileToken, setFileToken] = useState<string | null>(null);
  const [manualLogout, setManualLogout] = useState(false);
  const [checkingTestSession, setCheckingTestSession] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('login') !== '1' && params.get('auth') !== '1';
  });
  const authTokenRef = useRef<string | null>(null);
  authTokenRef.current = authToken;

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (lockedTarget === 'extension') return 'extension';
    if (lockedTarget === 'mobile') return 'app';
    try {
      const saved = localStorage.getItem('worktalk_view_mode');
      return saved === 'extension' ? 'extension' : 'app';
    } catch {
      return 'app';
    }
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('worktalk_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [activeTab, setActiveTab] = useState<AppTab>('chats');
  const [activeRoomId, setActiveRoomId] = useState<string | null>('room-company');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [files, setFiles] = useState<SharedFileItem[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessageItem[]>([]);
  const [bmailBridgeStatus, setBmailBridgeStatus] = useState<{
    bmailBaseUrlConfigured: boolean;
    embedSupported: boolean;
  } | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);

  const [showInspectorDrawer, setShowInspectorDrawer] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('notices');
  const [typingByRoom, setTypingByRoom] = useState<Record<string, string[]>>({});
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [urgentAlertBanner, setUrgentAlertBanner] = useState<EmergencyAlertData | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUserId;

  // Deep Chat State (auto-saved draft storage with debounce + periodic flush)
  const { draftsByRoom, lastSavedAtByRoom, setRoomDraft } = useDraftAutoSave();
  const [jumpToMessageRequest, setJumpToMessageRequest] = useState<{
    messageId: string;
    nonce: number;
  } | null>(null);
  const [forwardModalMessageIds, setForwardModalMessageIds] = useState<string[] | null>(null);

  // Modals & Drawers
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [profileModalUser, setProfileModalUser] = useState<User | null>(null);
  const [noticeModalDraft, setNoticeModalDraft] = useState<{
    open: boolean;
    initialTitle?: string;
    initialContent?: string;
    messageId?: string;
    initialUrgent?: boolean;
  }>({ open: false });
  const [showPollModal, setShowPollModal] = useState(false);
  const [lightboxFile, setLightboxFile] = useState<SharedFileItem | null>(null);
  const [openedMailId, setOpenedMailId] = useState<string | null>(null);
  const [showControlTower, setShowControlTower] = useState(false);
  const [controlTowerTab, setControlTowerTab] = useState<ControlTowerTab>('brain');
  const [externalLargeLinkNonce, setExternalLargeLinkNonce] = useState(0);
  const [chunkUploadProgress, setChunkUploadProgress] = useState<{
    filename: string;
    percent: number;
    chunkIndex: number;
    totalChunks: number;
  } | null>(null);
  const clientIdRef = useRef<string>('');
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const todayDate = useMemo(() => getTodayString(), []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('worktalk_theme', theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    if (lockedTarget) return;
    try {
      localStorage.setItem('worktalk_view_mode', viewMode);
    } catch {}
  }, [viewMode, lockedTarget]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!lockedTarget && params.get('mode') === 'extension') {
      setViewMode('extension');
    }
  }, [lockedTarget]);

  const apiFetch = useCallback(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const token = authTokenRef.current;
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      authTokenRef.current = null;
      setAuthToken(null);
      setFileToken(null);
      setCurrentUserId(null);
    }
    return res;
  }, []);

  const loadBootstrap = useCallback(async () => {
    if (!authTokenRef.current) return;
    setLoadingBootstrap(true);
    try {
      const res = await apiFetch('/api/bootstrap');
      if (!res.ok) return;
      const data = (await res.json()) as BootstrapPayload;
      setUsers(data.users);
      setRooms(data.rooms);
      setMessages(data.messages);
      setNotices(data.notices);
      setLeaves(data.leaves);
      setMails(data.mails ?? []);
      setNotifications(data.notifications);
      setFiles(data.files);
      setScheduledMessages(data.scheduledMessages ?? []);
      setActiveRoomId((prev) =>
        prev && data.rooms.some((r) => r.id === prev) ? prev : (data.rooms[0]?.id ?? null),
      );
      apiFetch('/api/bmail/bridge/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((status: { bmailBaseUrlConfigured?: boolean; embedSupported?: boolean } | null) => {
          if (status) {
            setBmailBridgeStatus({
              bmailBaseUrlConfigured: Boolean(status.bmailBaseUrlConfigured),
              embedSupported: Boolean(status.embedSupported),
            });
          }
        })
        .catch(() => {});
    } finally {
      setLoadingBootstrap(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (currentUserId && authToken) {
      loadBootstrap();
    }
  }, [currentUserId, authToken, loadBootstrap]);

  const pushToast = useCallback((toast: Omit<ToastNotification, 'id' | 'createdAt'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isUrgentToast = Boolean(toast.isUrgent || toast.priority === 'urgent');
    const item: ToastNotification = {
      ...toast,
      id,
      createdAt: new Date().toISOString(),
    };
    setToasts((prev) => {
      const merged = [item, ...prev];
      const urgent = merged.filter((t) => t.isUrgent || t.priority === 'urgent');
      const normal = merged.filter((t) => !(t.isUrgent || t.priority === 'urgent'));
      return [...urgent.slice(0, 3), ...normal].slice(0, 4);
    });
    window.setTimeout(
      () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      isUrgentToast ? 25000 : 6000,
    );
  }, []);

  const handleSocketEvent = useCallback(
    (evt: SocketEvent) => {
      const p = evt.payload;
      if (evt.event === 'presence:update') {
        const userId = String(p.userId ?? '');
        const online = Boolean(p.online);
        const presenceStatus = (p.presenceStatus as PresenceStatus | undefined) ?? (online ? 'online' : 'offline');
        const lastSeen = String(p.lastSeen ?? '');
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, online, presenceStatus, lastSeen } : u)),
        );
      } else if (evt.event === 'user:registered') {
        const newUser = p.user as User | undefined;
        if (newUser) {
          setUsers((prev) => (prev.some((u) => u.id === newUser.id) ? prev : [...prev, newUser]));
        }
      } else if (evt.event === 'user:updated') {
        const updated = p.user as User | undefined;
        if (updated) {
          setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        }
      } else if (evt.event === 'room:created' || evt.event === 'room:updated') {
        const room = p.room as ChatRoom | undefined;
        if (room) {
          setRooms((prev) =>
            prev.some((r) => r.id === room.id)
              ? prev.map((r) => (r.id === room.id ? room : r))
              : [room, ...prev],
          );
        }
      } else if (evt.event === 'message:created') {
        const message = p.message as Message | undefined;
        const room = p.room as ChatRoom | undefined;
        const sharedFile = p.sharedFile as SharedFileItem | undefined;
        if (message) {
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message],
          );
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }
        if (sharedFile) {
          setFiles((prev) =>
            prev.some((f) => f.id === sharedFile.id) ? prev : [sharedFile, ...prev],
          );
        }
      } else if (evt.event === 'message:updated') {
        const message = p.message as Message | undefined;
        if (message) {
          setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
        }
      } else if (evt.event === 'room:read') {
        const roomId = String(p.roomId ?? '');
        const userId = String(p.userId ?? '');
        const messageIds = (p.messageIds as string[]) ?? [];
        const idSet = new Set(messageIds);
        setMessages((prev) =>
          prev.map((m) =>
            m.roomId === roomId && idSet.has(m.id) && !m.readBy.includes(userId)
              ? { ...m, readBy: [...m.readBy, userId] }
              : m,
          ),
        );
      } else if (evt.event === 'notice:created') {
        const notice = p.notice as Notice | undefined;
        const room = p.room as ChatRoom | undefined;
        const message = p.message as Message | undefined;
        if (notice) {
          setNotices((prev) => {
            const base = notice.pinned
              ? prev.map((n) =>
                  n.roomId === notice.roomId && (!notice.scope || n.scope === notice.scope)
                    ? { ...n, pinned: false }
                    : n,
                )
              : prev;
            return base.some((n) => n.id === notice.id)
              ? base.map((n) => (n.id === notice.id ? notice : n))
              : [notice, ...base];
          });
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }
        if (message) {
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message],
          );
        }
      } else if (evt.event === 'notice:updated') {
        const notice = p.notice as Notice | undefined;
        const room = p.room as ChatRoom | undefined;
        if (notice) {
          setNotices((prev) =>
            prev.some((n) => n.id === notice.id)
              ? prev.map((n) => {
                  if (n.id === notice.id) return notice;
                  if (notice.pinned && n.roomId === notice.roomId) {
                    return { ...n, pinned: false };
                  }
                  return n;
                })
              : [notice, ...prev],
          );
          const uid = currentUserIdRef.current;
          if (uid && notice.acknowledgedBy?.includes(uid)) {
            setUrgentAlertBanner((prev) =>
              prev && prev.noticeId === notice.id ? { ...prev, acknowledged: true } : prev,
            );
          }
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }
      } else if (evt.event === 'notice:deleted') {
        const noticeId = String(p.noticeId ?? '');
        const room = p.room as ChatRoom | undefined;
        if (noticeId) {
          setNotices((prev) => prev.filter((n) => n.id !== noticeId));
          setUrgentAlertBanner((prev) => (prev && prev.noticeId === noticeId ? null : prev));
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }
      } else if (evt.event === 'leave:registered') {
        const leave = p.leave as LeaveRequest | undefined;
        const updatedUser = p.user as User | undefined;
        const createdMsgs = (p.messages as Message[]) ?? [];
        const updatedRooms = (p.rooms as ChatRoom[]) ?? [];

        if (leave) {
          setLeaves((prev) => (prev.some((l) => l.id === leave.id) ? prev : [leave, ...prev]));
        }
        if (updatedUser) {
          setUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
        }
        if (createdMsgs.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const fresh = createdMsgs.filter((m) => !existingIds.has(m.id));
            return [...prev, ...fresh];
          });
        }
        if (updatedRooms.length > 0) {
          setRooms((prev) =>
            prev.map((r) => updatedRooms.find((ur) => ur.id === r.id) ?? r),
          );
        }
      } else if (evt.event === 'mail:received') {
        const mail = p.mail as MailMessage | undefined;
        const message = p.message as Message | undefined;
        const room = p.room as ChatRoom | undefined;
        if (mail) {
          setMails((prev) => (prev.some((m) => m.id === mail.id) ? prev : [mail, ...prev]));
        }
        if (message) {
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message],
          );
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }
      } else if (evt.event === 'scheduled:updated') {
        const scheduled = p.scheduledMessages as ScheduledMessageItem[] | undefined;
        if (scheduled) {
          setScheduledMessages(scheduled);
        }
      } else if (evt.event === 'notification:new') {
        const notif = p.notification as NotificationItem | undefined;
        if (notif) {
          setNotifications((prev) =>
            prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev],
          );
          const cleanToastTitle =
            notif.isUrgent || notif.priority === 'urgent'
              ? notif.title.replace(/^(?:\[긴급재난문자\]\s*)+/g, '') || notif.title
              : notif.title;
          pushToast({
            title: cleanToastTitle,
            body: notif.body,
            type: notif.type,
            priority: notif.priority,
            isUrgent: notif.isUrgent,
            roomId: notif.roomId,
            mailId: notif.mailId,
          });
        }
      } else if (evt.event === 'notification:urgent') {
        const notice = p.notice as Notice | undefined;
        const room = p.room as ChatRoom | undefined;
        const noticeId = String(p.noticeId ?? notice?.id ?? '');
        const roomId = typeof p.roomId === 'string' ? p.roomId : notice?.roomId ?? null;
        const authorName = String(p.authorName ?? '관리자');
        const rawTitle = String(p.title ?? notice?.title ?? '전 회원 긴급 공지');
        const title = rawTitle.replace(/^(?:\[긴급재난문자\]\s*)+/g, '') || '전 회원 긴급 공지';
        const body = String(p.body ?? notice?.content ?? '');
        const createdAt = String(p.createdAt ?? notice?.createdAt ?? new Date().toISOString());

        if (notice) {
          setNotices((prev) => {
            const base = notice.pinned
              ? prev.map((n) => (n.roomId === notice.roomId ? { ...n, pinned: false } : n))
              : prev;
            return base.some((n) => n.id === notice.id)
              ? base.map((n) => (n.id === notice.id ? notice : n))
              : [notice, ...base];
          });
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }

        playEmergencyAlertSound();
        triggerBrowserEmergencyNotification(`[긴급재난문자] ${title}`, body, () => {
          if (roomId) {
            setActiveRoomId(roomId);
            setActiveTab('chats');
          }
        });

        const uid = currentUserIdRef.current;
        setUrgentAlertBanner({
          noticeId: noticeId || null,
          roomId,
          title,
          body,
          authorName,
          roomName: room?.name ?? '전체 공지',
          createdAt,
          acknowledged: Boolean(uid && notice?.acknowledgedBy?.includes(uid)),
        });

        pushToast({
          title,
          body,
          type: 'notice',
          priority: 'urgent',
          isUrgent: true,
          noticeId: noticeId || null,
          roomId,
        });
      } else if (evt.event === 'typing:update') {
        const roomId = String(p.roomId ?? '');
        const uid = String(p.userId ?? '');
        const isTyping = Boolean(p.isTyping);
        setTypingByRoom((prev) => {
          const current = prev[roomId] ?? [];
          const next = isTyping
            ? current.includes(uid)
              ? current
              : [...current, uid]
            : current.filter((x) => x !== uid);
          return { ...prev, [roomId]: next };
        });
      } else if (evt.event === 'file:updated') {
        const sharedFile = p.sharedFile as SharedFileItem | undefined;
        const message = p.message as Message | undefined;
        const room = p.room as ChatRoom | undefined;
        if (sharedFile) {
          setFiles((prev) =>
            prev.some((f) => f.id === sharedFile.id)
              ? prev.map((f) => (f.id === sharedFile.id ? sharedFile : f))
              : [sharedFile, ...prev],
          );
        }
        if (message) {
          setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
        }
        if (room) {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
        }
      } else if (evt.event === 'mail:updated') {
        const mail = p.mail as MailMessage | undefined;
        if (mail) {
          setMails((prev) =>
            prev.some((m) => m.id === mail.id)
              ? prev.map((m) => (m.id === mail.id ? mail : m))
              : [mail, ...prev],
          );
        }
      } else if (evt.event === 'notification:updated') {
        const notif = p.notification as NotificationItem | undefined;
        if (notif) {
          setNotifications((prev) =>
            prev.some((n) => n.id === notif.id)
              ? prev.map((n) => (n.id === notif.id ? notif : n))
              : [notif, ...prev],
          );
        }
      } else if (evt.event === 'notification:read_all') {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      } else if (evt.event === 'ui:sync') {
        if (p.sourceClientId && p.sourceClientId === clientIdRef.current) return;
        if (typeof p.activeRoomId === 'string' && p.activeRoomId) {
          setActiveRoomId(p.activeRoomId);
        }
        if (
          typeof p.activeTab === 'string' &&
          (['friends', 'chats', 'leave', 'files'] as string[]).includes(p.activeTab)
        ) {
          setActiveTab(p.activeTab as AppTab);
        }
      }
    },
    [pushToast],
  );

  const { sendTyping, sendUiSync, clientId } = useGroupwareSocket(
    currentUserId,
    authToken,
    handleSocketEvent,
    { onReconnect: loadBootstrap },
  );
  clientIdRef.current = clientId;

  const postSyncChannel = useCallback(
    (msg: {
      type: 'ui:sync' | 'data:patch';
      activeRoomId?: string;
      activeTab?: AppTab;
      openedMailId?: string | null;
      kind?: string;
      payload?: Record<string, unknown>;
    }) => {
      try {
        broadcastChannelRef.current?.postMessage({
          ...msg,
          sourceClientId: clientIdRef.current,
        });
      } catch {
        // ignore channel serialization errors
      }
    },
    [],
  );

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('sgw_app_web_sync');
    broadcastChannelRef.current = bc;
    bc.onmessage = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string;
        sourceClientId?: string;
        activeRoomId?: string;
        activeTab?: AppTab;
        openedMailId?: string | null;
        kind?: string;
        payload?: Record<string, unknown>;
      } | null;
      if (!data || data.sourceClientId === clientIdRef.current) return;
      if (data.type === 'ui:sync') {
        if (typeof data.activeRoomId === 'string' && data.activeRoomId) {
          setActiveRoomId(data.activeRoomId);
        }
        if (
          typeof data.activeTab === 'string' &&
          (['friends', 'chats', 'leave', 'files'] as string[]).includes(data.activeTab)
        ) {
          setActiveTab(data.activeTab);
        }
        if (data.openedMailId !== undefined) {
          setOpenedMailId(data.openedMailId);
        }
      } else if (data.type === 'data:patch' && data.kind && data.payload) {
        handleSocketEvent({ event: data.kind, payload: data.payload });
      }
    };
    return () => {
      bc.close();
      if (broadcastChannelRef.current === bc) {
        broadcastChannelRef.current = null;
      }
    };
  }, [handleSocketEvent]);

  const switchTab = useCallback(
    (tab: AppTab, options?: { syncMobileChat?: boolean }) => {
      setActiveTab(tab);
      if (options?.syncMobileChat === false) {
        setMobileChatOpen(false);
      }
      sendUiSync({ activeTab: tab });
      postSyncChannel({ type: 'ui:sync', activeTab: tab });
    },
    [postSyncChannel, sendUiSync],
  );

  const usersById = useMemo(() => {
    const map: Record<string, User> = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);

  const roomsById = useMemo(() => {
    const map: Record<string, ChatRoom> = {};
    for (const r of rooms) map[r.id] = r;
    return map;
  }, [rooms]);

  const currentUser = currentUserId ? usersById[currentUserId] ?? null : null;
  const activeRoom = activeRoomId ? roomsById[activeRoomId] ?? null : null;

  const activeNotice = useMemo(() => {
    if (!activeRoom) return null;
    if (activeRoom.activeNoticeId) {
      const found = notices.find((n) => n.id === activeRoom.activeNoticeId);
      if (found) return found;
    }
    return notices.find((n) => n.roomId === activeRoom.id && n.pinned) ?? null;
  }, [activeRoom, notices]);

  const totalUnreadMessages = useMemo(() => {
    if (!currentUser) return 0;
    return rooms.reduce(
      (acc, r) => acc + getRoomUnreadCount(messages, r.id, currentUser.id),
      0,
    );
  }, [rooms, messages, currentUser]);

  useEffect(() => {
    postSgwHostEvent({ type: 'SGW_UNREAD_CHANGED', count: totalUnreadMessages });
  }, [totalUnreadMessages]);

  useEffect(() => {
    postSgwHostEvent({ type: 'SGW_CHAT_READY', version: '1.0' });
    const handleHostMessage = (evt: MessageEvent) => {
      if (!isTrustedSgwOrigin(evt.origin)) return;
      const data = evt.data as {
        type?: string;
        token?: string;
        fileToken?: string;
        userId?: string;
        roomId?: string;
      } | null;
      if (!data) return;
      // Only accept host session sync when accompanied by a signed Bearer token (never spoof by raw userId alone)
      if (data.type === 'SGW_AUTH_SYNC' && typeof data.token === 'string' && data.token && typeof data.userId === 'string' && data.userId) {
        authTokenRef.current = data.token;
        setAuthToken(data.token);
        if (typeof data.fileToken === 'string') setFileToken(data.fileToken);
        setCurrentUserId(data.userId);
      } else if (data.type === 'SGW_OPEN_ROOM' && typeof data.roomId === 'string' && data.roomId) {
        setActiveRoomId(data.roomId);
        setActiveTab('chats');
        setMobileChatOpen(true);
      }
    };
    window.addEventListener('message', handleHostMessage);
    return () => window.removeEventListener('message', handleHostMessage);
  }, []);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const unreadMailsCount = useMemo(
    () =>
      currentUser
        ? mails.filter((m) => !m.readByUserIds.includes(currentUser.id)).length
        : 0,
    [mails, currentUser],
  );

  const openedMail = useMemo(
    () => (openedMailId ? mails.find((m) => m.id === openedMailId) ?? null : null),
    [openedMailId, mails],
  );

  const handleAuthenticated = useCallback(
    ({
      user,
      token,
      fileToken: nextFileToken,
    }: {
      user: User;
      token: string;
      fileToken: string;
    }) => {
      authTokenRef.current = token;
      setAuthToken(token);
      setFileToken(nextFileToken);
      setCurrentUserId(user.id);
      setManualLogout(false);
    },
    [],
  );

  const enterTestSession = useCallback(async () => {
    setCheckingTestSession(true);
    try {
      const res = await fetch('/api/auth/test-session', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          user?: User;
          token?: string;
          fileToken?: string;
        };
        if (data.ok && data.user && data.token && data.fileToken) {
          handleAuthenticated({
            user: data.user,
            token: data.token,
            fileToken: data.fileToken,
          });
        }
      }
    } catch {
      // Fall back to AuthScreen if unavailable
    } finally {
      setCheckingTestSession(false);
    }
  }, [handleAuthenticated]);

  useEffect(() => {
    if (currentUserId || manualLogout) {
      setCheckingTestSession(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === '1' || params.get('auth') === '1') {
      setCheckingTestSession(false);
      return;
    }
    enterTestSession();
  }, [currentUserId, manualLogout, enterTestSession]);

  const handleLogout = () => {
    setManualLogout(true);
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    authTokenRef.current = null;
    setAuthToken(null);
    setFileToken(null);
    setCurrentUserId(null);
    setUsers([]);
    setRooms([]);
    setMessages([]);
    setNotices([]);
    setLeaves([]);
    setMails([]);
    setNotifications([]);
    setFiles([]);
    setScheduledMessages([]);
    setOpenedMailId(null);
    setShowControlTower(false);
  };

  const handleEgoSelfMessage = useCallback((msg: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  const handleSelectRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    setActiveTab('chats');
    setMobileChatOpen(true);
    sendUiSync({ activeRoomId: roomId, activeTab: 'chats' });
    postSyncChannel({ type: 'ui:sync', activeRoomId: roomId, activeTab: 'chats' });
  };

  const handleStartDirectChat = async (peerId: string) => {
    if (!currentUser) return;
    const res = await apiFetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds: [peerId] }),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) =>
        prev.some((r) => r.id === data.room.id) ? prev : [data.room, ...prev],
      );
      handleSelectRoom(data.room.id);
    }
  };

  const handleCreateRoom = async (memberIds: string[], name: string) => {
    if (!currentUser) return;
    const res = await apiFetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds, name }),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) =>
        prev.some((r) => r.id === data.room.id) ? prev : [data.room, ...prev],
      );
      handleSelectRoom(data.room.id);
    }
  };

  const handleSendMessage = async (payload: {
    type: Message['type'];
    content: string;
    replyToId?: string | null;
    emoticonId?: string;
    poll?: PollData;
    scheduleCard?: Omit<ScheduleCardData, 'attendeesYes' | 'attendeesMaybe' | 'attendeesNo'>;
    voice?: VoiceAttachment;
    integrationAlert?: IntegrationActionSummary;
    viewOnce?: boolean;
  }) => {
    if (!currentUser || !activeRoom) return;
    const res = await apiFetch(`/api/rooms/${activeRoom.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      );
      postSyncChannel({
        type: 'data:patch',
        kind: 'message:created',
        payload: { message: data.message, room: data.room },
      });
    }
  };

  const handleTriggerIntegration = useCallback(
    async (
      summary: IntegrationActionSummary,
      options?: { recordInChat?: boolean },
    ) => {
      postSgwHostEvent(buildIntegrationHostEvent(summary));
      pushToast({
        title: `[${summary.system} 연동] ${summary.title}`,
        body: summary.description || `${summary.system} 외부 모듈 연동 이벤트를 전달했습니다.`,
        type: 'integration',
        roomId: activeRoom?.id,
      });

      if (options?.recordInChat !== false && activeRoom && currentUser) {
        const res = await apiFetch(`/api/rooms/${activeRoom.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'integration_alert',
            content: `[${summary.system} 연동] ${summary.title}`,
            integrationAlert: summary,
          }),
        }).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          if (data.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
            );
          }
        }
      }
    },
    [activeRoom, apiFetch, currentUser, pushToast],
  );

  const handleUploadFile = async (file: File, caption?: string) => {
    if (!currentUser || !activeRoom) return;

    // Files larger than 500MB automatically switch to the 100GB+ external link generator
    if (file.size > 500 * 1024 * 1024) {
      setExternalLargeLinkNonce((n) => n + 1);
      pushToast({
        title: '500MB 초과 파일 · 100GB+ 보안 링크 전환',
        body: `${file.name} 파일은 초고용량 외부 클라우드·NAS 보안 링크 전송 패널로 연결되었습니다.`,
        type: 'file',
        roomId: activeRoom.id,
      });
      return;
    }

    // Files > 20MB and <= 500MB use 5MB resumable chunked upload
    if (file.size > 20 * 1024 * 1024) {
      const approxChunkSize = 5 * 1024 * 1024;
      const estTotalChunks = Math.max(1, Math.ceil(file.size / approxChunkSize));
      setChunkUploadProgress({
        filename: file.name,
        percent: 0,
        chunkIndex: 0,
        totalChunks: estTotalChunks,
      });
      try {
        const initRes = await apiFetch('/api/files/chunked/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: activeRoom.id,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            totalSize: file.size,
            totalChunks: estTotalChunks,
          }),
        });
        const initData = (await initRes.json()) as {
          sessionId?: string;
          chunkSize?: number;
          error?: string;
        };
        if (!initRes.ok || !initData.sessionId) {
          pushToast({
            title: '분할 업로드 초기화 실패',
            body: initData.error || '파일 분할 업로드를 시작할 수 없습니다.',
            type: 'file',
          });
          return;
        }
        const realChunkSize = initData.chunkSize || approxChunkSize;
        const totalChunks = Math.max(1, Math.ceil(file.size / realChunkSize));
        for (let idx = 0; idx < totalChunks; idx += 1) {
          const slice = file.slice(idx * realChunkSize, Math.min(file.size, (idx + 1) * realChunkSize));
          const partFd = new FormData();
          partFd.append('chunk', slice, `${file.name}.part${idx}`);
          partFd.append('chunkIndex', String(idx));
          const partRes = await apiFetch(`/api/files/chunked/${initData.sessionId}/chunk`, {
            method: 'POST',
            body: partFd,
          });
          if (!partRes.ok) {
            const errData = (await partRes.json().catch(() => ({}))) as { error?: string };
            pushToast({
              title: '분할 청크 전송 실패',
              body: errData.error || `${idx + 1}/${totalChunks}번째 청크 전송에 실패했습니다.`,
              type: 'file',
            });
            return;
          }
          setChunkUploadProgress({
            filename: file.name,
            percent: Math.round(((idx + 1) / totalChunks) * 100),
            chunkIndex: idx + 1,
            totalChunks,
          });
        }

        const completeRes = await apiFetch(`/api/files/chunked/${initData.sessionId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption }),
        });
        const completeData = (await completeRes.json()) as {
          message?: Message;
          file?: SharedFileItem;
          error?: string;
        };
        if (!completeRes.ok) {
          pushToast({
            title: '분할 업로드 완료 실패',
            body: completeData.error || '파일 병합 처리 중 오류가 발생했습니다.',
            type: 'file',
          });
          return;
        }
        if (completeData.message) {
          setMessages((prev) =>
            prev.some((m) => m.id === completeData.message!.id)
              ? prev
              : [...prev, completeData.message!],
          );
        }
        if (completeData.file) {
          setFiles((prev) =>
            prev.some((f) => f.id === completeData.file!.id) ? prev : [completeData.file!, ...prev],
          );
        }
        postSyncChannel({
          type: 'data:patch',
          kind: 'message:created',
          payload: { message: completeData.message, sharedFile: completeData.file },
        });
        return;
      } finally {
        setChunkUploadProgress(null);
      }
    }

    const fd = new FormData();
    fd.append('file', file);
    if (caption) fd.append('caption', caption);

    const res = await apiFetch(`/api/rooms/${activeRoom.id}/upload`, {
      method: 'POST',
      body: fd,
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      );
    }
    if (data.file) {
      setFiles((prev) =>
        prev.some((f) => f.id === data.file.id) ? prev : [data.file, ...prev],
      );
    }
    if (data.message || data.file) {
      postSyncChannel({
        type: 'data:patch',
        kind: 'message:created',
        payload: { message: data.message, sharedFile: data.file },
      });
    }
  };

  const handleRevokeSharedFile = useCallback(
    async (fileId: string) => {
      if (!currentUser) return;
      const res = await apiFetch(`/api/files/${fileId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        file?: SharedFileItem;
        message?: Message;
        error?: string;
      };
      if (!res.ok) {
        pushToast({
          title: '공유 링크 회수 실패',
          body: data.error || '권한이 없거나 링크를 찾을 수 없습니다.',
          type: 'file',
        });
        return;
      }
      if (data.file) {
        setFiles((prev) => prev.map((f) => (f.id === data.file!.id ? data.file! : f)));
      }
      if (data.message) {
        setMessages((prev) => prev.map((m) => (m.id === data.message!.id ? data.message! : m)));
      }
      postSyncChannel({
        type: 'data:patch',
        kind: 'file:updated',
        payload: { sharedFile: data.file, message: data.message },
      });
      pushToast({
        title: '공유 링크 회수 완료',
        body: '외부 대용량 공유 링크 접근이 즉시 차단되었습니다.',
        type: 'file',
      });
    },
    [apiFetch, currentUser, postSyncChannel, pushToast],
  );

  const handleMarkRoomReadById = useCallback(
    async (roomId: string) => {
      if (!currentUser) return;
      const hasUnread = messages.some(
        (m) => m.roomId === roomId && !m.readBy.includes(currentUser.id),
      );
      if (!hasUnread) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.roomId === roomId && !m.readBy.includes(currentUser.id)
            ? { ...m, readBy: [...m.readBy, currentUser.id] }
            : m,
        ),
      );
      await apiFetch(`/api/rooms/${roomId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {});
    },
    [apiFetch, currentUser, messages],
  );

  const handleMarkRead = useCallback(() => {
    if (!activeRoom) return;
    handleMarkRoomReadById(activeRoom.id);
  }, [activeRoom, handleMarkRoomReadById]);

  const handleMarkAllRoomsRead = useCallback(async () => {
    if (!currentUser) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.readBy.includes(currentUser.id)
          ? m
          : { ...m, readBy: [...m.readBy, currentUser.id] },
      ),
    );
    await apiFetch('/api/rooms/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, [apiFetch, currentUser]);

  const handleOpenViewOnce = useCallback(
    async (
      messageId: string,
    ): Promise<{ ok: boolean; content?: string; error?: string }> => {
      if (!currentUser) return { ok: false, error: '로그인이 필요합니다.' };
      const res = await apiFetch(`/api/messages/${messageId}/view-once`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => null);
      if (!res) return { ok: false, error: '네트워크 오류' };
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        content?: string;
        message?: Message;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || '비밀 메시지를 열 수 없습니다.' };
      }
      if (data.message) {
        setMessages((prev) => prev.map((m) => (m.id === data.message!.id ? data.message! : m)));
      }
      return { ok: true, content: data.content };
    },
    [apiFetch, currentUser],
  );

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    }
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    }
  };

  const handleRecallMessage = async (messageId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/messages/${messageId}/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    }
  };

  const handleToggleStarMessage = async (messageId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/messages/${messageId}/star`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    }
  };

  const handleForwardMessages = async (input: {
    messageIds: string[];
    targetRoomId?: string;
    targetUserId?: string;
  }) => {
    if (!currentUser) return;
    const res = await apiFetch('/api/messages/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) =>
        prev.some((r) => r.id === data.room.id)
          ? prev.map((r) => (r.id === data.room.id ? data.room : r))
          : [data.room, ...prev],
      );
      if (Array.isArray(data.messages)) {
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.id));
          return [...prev, ...data.messages.filter((m: Message) => !existing.has(m.id))];
        });
      }
      handleSelectRoom(data.room.id);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/messages/${messageId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    }
  };

  const handleVotePoll = async (messageId: string, optionId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/polls/${messageId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    });
    const data = await res.json();
    if (data.message) {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    }
  };

  const handleCreateNotice = async (
    title: string,
    content: string,
    options?: {
      priority: NoticePriority;
      isUrgent: boolean;
      pushAllMembers: boolean;
    },
  ) => {
    if (!currentUser || !activeRoom) return;
    const res = await apiFetch(`/api/rooms/${activeRoom.id}/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        messageId: noticeModalDraft.messageId ?? null,
        priority: options?.priority ?? 'normal',
        isUrgent: Boolean(options?.isUrgent),
        pushAllMembers: Boolean(options?.pushAllMembers),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '공지 등록에 실패했습니다.');
    }
    if (data.notice) {
      setNotices((prev) => {
        const unpinned = prev.map((n) =>
          n.roomId === data.notice.roomId ? { ...n, pinned: false } : n,
        );
        return [data.notice, ...unpinned.filter((n) => n.id !== data.notice.id)];
      });
    }
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
    if (data.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      );
    }
    postSyncChannel({
      type: 'data:patch',
      kind: 'notice:created',
      payload: { notice: data.notice, room: data.room, message: data.message },
    });
  };

  const handleAcknowledgeNotice = async (noticeId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/notices/${noticeId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    if (data.notice) {
      setNotices((prev) => prev.map((n) => (n.id === data.notice.id ? data.notice : n)));
      setUrgentAlertBanner((prev) =>
        prev && prev.noticeId === data.notice.id ? { ...prev, acknowledged: true } : prev,
      );
    }
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
    postSyncChannel({
      type: 'data:patch',
      kind: 'notice:updated',
      payload: { notice: data.notice, room: data.room },
    });
  };

  const handleTogglePinNotice = async (noticeId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/notices/${noticeId}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    if (data.notice) {
      setNotices((prev) =>
        prev.map((n) => {
          if (n.id === data.notice.id) return data.notice;
          if (data.notice.pinned && n.roomId === data.notice.roomId) {
            return { ...n, pinned: false };
          }
          return n;
        }),
      );
    }
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
    postSyncChannel({
      type: 'data:patch',
      kind: 'notice:updated',
      payload: { notice: data.notice, room: data.room },
    });
  };

  const handleDeleteNotice = async (noticeId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/notices/${noticeId}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast({
        title: '공지 삭제 실패',
        body: data.error || '공지를 삭제할 수 없습니다.',
        type: 'notice',
      });
      return;
    }
    setNotices((prev) => prev.filter((n) => n.id !== noticeId));
    setUrgentAlertBanner((prev) => (prev && prev.noticeId === noticeId ? null : prev));
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
    postSyncChannel({
      type: 'data:patch',
      kind: 'notice:deleted',
      payload: { noticeId, roomId: data.room?.id ?? null, room: data.room },
    });
  };

  const handlePushNoticeUrgent = async (noticeId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/notices/${noticeId}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast({
        title: '긴급 재난문자 전파 실패',
        body: data.error || '공지 전파 중 오류가 발생했습니다.',
        type: 'notice',
      });
      return;
    }
    if (data.notice) {
      setNotices((prev) => prev.map((n) => (n.id === data.notice.id ? data.notice : n)));
    }
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
    postSyncChannel({
      type: 'data:patch',
      kind: 'notice:updated',
      payload: { notice: data.notice, room: data.room },
    });
  };

  const handleTogglePinRoomById = async (roomId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/rooms/${roomId}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
  };

  const handleToggleMuteRoomById = async (roomId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/rooms/${roomId}/mute`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
  };

  const handleSetDisappearing = async (roomId: string, disappearingSeconds: number | null) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/rooms/${roomId}/disappearing`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disappearingSeconds }),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
    if (data.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      );
    }
  };

  const handleLeaveRoomById = async (roomId: string) => {
    if (!currentUser) return;
    const res = await apiFetch(`/api/rooms/${roomId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      setRooms((prev) => {
        const next = prev.filter((r) => r.id !== roomId);
        if (activeRoomId === roomId) {
          setActiveRoomId(next[0]?.id ?? null);
          setMobileChatOpen(false);
          setShowInspectorDrawer(false);
        }
        return next;
      });
    }
  };

  const handleOpenSelfChat = async () => {
    if (!currentUser) return;
    const existing = rooms.find((r) => r.type === 'self' && r.memberIds.includes(currentUser.id));
    if (existing) {
      handleSelectRoom(existing.id);
      return;
    }
    const res = await apiFetch('/api/rooms/self', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) =>
        prev.some((r) => r.id === data.room.id) ? prev : [data.room, ...prev],
      );
      handleSelectRoom(data.room.id);
    }
  };

  const handleInviteMembers = async (userIds: string[]) => {
    if (!currentUser || !activeRoom) return;
    const res = await apiFetch(`/api/rooms/${activeRoom.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds }),
    });
    const data = await res.json();
    if (data.room) {
      setRooms((prev) => prev.map((r) => (r.id === data.room.id ? data.room : r)));
    }
  };

  const handleSaveStatusMessage = async (statusMessage: string) => {
    if (!currentUser) return;
    const res = await apiFetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusMessage }),
    });
    const data = await res.json();
    if (data.user) {
      setUsers((prev) => prev.map((u) => (u.id === data.user.id ? data.user : u)));
    }
  };

  const handleChangeMyPresence = async (presenceStatus: PresenceStatus) => {
    if (!currentUser) return;
    setUsers((prev) =>
      prev.map((u) =>
        u.id === currentUser.id
          ? { ...u, presenceStatus, online: presenceStatus !== 'offline' }
          : u,
      ),
    );
    await apiFetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presenceStatus }),
    });
  };

  const handleRegisterLeave = async (input: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId: string | null;
    reason: string;
  }) => {
    if (!currentUser) return { ok: false, error: '로그인이 필요합니다.' };
    const res = await apiFetch('/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || '연차 등록 실패' };
    }
    if (data.leave) {
      setLeaves((prev) =>
        prev.some((l) => l.id === data.leave.id) ? prev : [data.leave, ...prev],
      );
    }
    if (data.user) {
      setUsers((prev) => prev.map((u) => (u.id === data.user.id ? data.user : u)));
    }
    loadBootstrap();
    pushToast({
      title: '연차 등록 및 전사/bmail 알림 완료',
      body: `${input.type} (${input.startDate}) 등록이 완료되어 전체 사원에게 알림이 발송되었습니다.`,
      type: 'leave',
      roomId: 'room-bot',
    });
    return { ok: true, notificationsCount: data.notificationsCount };
  };

  const handleOpenBmail = useCallback(
    (mailId?: string) => {
      postSgwHostEvent({ type: 'BMAIL_OPEN', mailId });
      pushToast({
        title: 'bmail 연동 연결',
        body: '자체 개발 아웃룩(bmail) 메일 앱 열기 이벤트를 전송했습니다.',
        type: 'leave',
        roomId: 'room-bot',
      });
    },
    [pushToast],
  );

  const handleMarkMailRead = useCallback(
    async (mailId: string) => {
      if (!currentUser) return;
      setMails((prev) =>
        prev.map((m) =>
          m.id === mailId && !m.readByUserIds.includes(currentUser.id)
            ? { ...m, readByUserIds: [...m.readByUserIds, currentUser.id] }
            : m,
        ),
      );
      const res = await apiFetch(`/api/mail/${mailId}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as { mail?: MailMessage };
        if (data.mail) {
          setMails((prev) => prev.map((m) => (m.id === data.mail!.id ? data.mail! : m)));
        }
      }
    },
    [apiFetch, currentUser],
  );

  const handleOpenMailReader = useCallback(
    async (mailId: string) => {
      setOpenedMailId(mailId);
      postSyncChannel({ type: 'ui:sync', openedMailId: mailId });
      if (!mails.some((m) => m.id === mailId)) {
        await loadBootstrap();
      }
      await handleMarkMailRead(mailId);
    },
    [mails, loadBootstrap, handleMarkMailRead, postSyncChannel],
  );

  const handleMailSentLocal = useCallback(
    (mail: MailMessage, uploadedFile?: SharedFileItem) => {
      setMails((prev) => (prev.some((m) => m.id === mail.id) ? prev : [mail, ...prev]));
      if (uploadedFile) {
        setFiles((prev) =>
          prev.some((f) => f.id === uploadedFile.id) ? prev : [uploadedFile, ...prev],
        );
      }
      postSyncChannel({
        type: 'data:patch',
        kind: 'mail:received',
        payload: { mail },
      });
    },
    [postSyncChannel],
  );

  const handleSyncRemoteBmail = useCallback(async (): Promise<{
    ok: boolean;
    importedCount?: number;
    error?: string;
  }> => {
    const res = await apiFetch('/api/bmail/bridge/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) return { ok: false, error: '네트워크 오류' };
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      importedCount?: number;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || '원격 bmail 동기화에 실패했습니다.' };
    }
    await loadBootstrap();
    return { ok: true, importedCount: data.importedCount ?? 0 };
  }, [apiFetch, loadBootstrap]);

  const handleLaunchBmailSso = useCallback(async (): Promise<{
    ok: boolean;
    launchUrl?: string;
    error?: string;
  }> => {
    const res = await apiFetch('/api/bmail/bridge/sso-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) return { ok: false, error: '네트워크 오류' };
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      launchUrl?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.launchUrl) {
      return { ok: false, error: data.error || 'SSO URL을 생성할 수 없습니다.' };
    }
    return { ok: true, launchUrl: data.launchUrl };
  }, [apiFetch]);

  const handleAnalyzeVoiceMessage = useCallback(
    async (msg: Message) => {
      if (!currentUser) return;
      const res = await apiFetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msg.id,
          transcript: msg.voice?.transcript,
          audioDataUrl: msg.voice?.audioDataUrl,
          durationSec: msg.voice?.durationSec,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { message?: Message };
        if (data.message) {
          setMessages((prev) => prev.map((m) => (m.id === data.message!.id ? data.message! : m)));
        }
      }
    },
    [apiFetch, currentUser],
  );

  const handleTranslateOrSummarizeMessage = useCallback(
    async (messageId: string, mode: 'translate' | 'summary') => {
      if (!currentUser) return { error: '로그인이 필요합니다.' };
      const res = await apiFetch(`/api/messages/${messageId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as { resultText?: string; error?: string };
      if (!res.ok) {
        return { error: data.error || '메시지 분석에 실패했습니다.' };
      }
      return { resultText: data.resultText };
    },
    [apiFetch, currentUser],
  );

  const handleShareLargeLink = useCallback(
    async (input: {
      filename: string;
      externalUrl: string;
      sizeValue: number;
      sizeUnit: 'MB' | 'GB' | 'TB';
      expiresDays: number;
      shareProvider: ShareProvider;
      passcode?: string;
      maxDownloads?: number;
      caption?: string;
    }) => {
      if (!currentUser || !activeRoom) return { ok: false, error: '대화방을 선택해 주세요.' };
      const res = await apiFetch(`/api/rooms/${activeRoom.id}/large-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as {
        message?: Message;
        file?: SharedFileItem;
        error?: string;
      };
      if (!res.ok) {
        return { ok: false, error: data.error || '대용량 링크 공유 실패' };
      }
      if (data.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!],
        );
      }
      if (data.file) {
        setFiles((prev) =>
          prev.some((f) => f.id === data.file!.id) ? prev : [data.file!, ...prev],
        );
      }
      postSyncChannel({
        type: 'data:patch',
        kind: 'message:created',
        payload: { message: data.message, sharedFile: data.file },
      });
      return { ok: true };
    },
    [apiFetch, activeRoom, currentUser, postSyncChannel],
  );

  const handleShareNasFile = useCallback(
    async (input: {
      nasFolder: string;
      filename: string;
      sourceNasRelativePath?: string;
      externalNasUrl?: string;
      sizeValue: number;
      sizeUnit: 'MB' | 'GB' | 'TB';
      expiresDays: number;
      passcode?: string;
      maxDownloads?: number;
      caption?: string;
      localFile?: File | null;
    }) => {
      if (!currentUser || !activeRoom) return { ok: false, error: '대화방을 선택해 주세요.' };

      if (input.localFile) {
        const f = input.localFile;
        if (f.size <= 20 * 1024 * 1024) {
          const fd = new FormData();
          fd.append('file', f);
          fd.append('nasFolder', input.nasFolder);
          fd.append('roomId', activeRoom.id);
          fd.append('expiresDays', String(input.expiresDays));
          if (input.passcode) fd.append('passcode', input.passcode);
          if (input.maxDownloads) fd.append('maxDownloads', String(input.maxDownloads));
          if (input.caption) fd.append('caption', input.caption);

          const res = await apiFetch('/api/nas/upload', { method: 'POST', body: fd });
          const data = (await res.json().catch(() => ({}))) as {
            message?: Message;
            file?: SharedFileItem;
            error?: string;
          };
          if (!res.ok) {
            return { ok: false, error: data.error || 'NAS 파일 업로드 실패' };
          }
          if (data.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!],
            );
          }
          if (data.file) {
            setFiles((prev) =>
              prev.some((item) => item.id === data.file!.id) ? prev : [data.file!, ...prev],
            );
          }
          postSyncChannel({
            type: 'data:patch',
            kind: 'message:created',
            payload: { message: data.message, sharedFile: data.file },
          });
          return { ok: true };
        }

        if (f.size <= 500 * 1024 * 1024) {
          const approxChunkSize = 5 * 1024 * 1024;
          const estTotalChunks = Math.max(1, Math.ceil(f.size / approxChunkSize));
          setChunkUploadProgress({
            filename: f.name,
            percent: 0,
            chunkIndex: 0,
            totalChunks: estTotalChunks,
          });
          try {
            const initRes = await apiFetch('/api/files/chunked/init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roomId: activeRoom.id,
                filename: f.name,
                mimeType: f.type || 'application/octet-stream',
                totalSize: f.size,
                totalChunks: estTotalChunks,
                nasFolder: input.nasFolder,
              }),
            });
            const initData = (await initRes.json().catch(() => ({}))) as {
              sessionId?: string;
              chunkSize?: number;
              error?: string;
            };
            if (!initRes.ok || !initData.sessionId) {
              return { ok: false, error: initData.error || 'NAS 분할 업로드 초기화 실패' };
            }
            const realChunkSize = initData.chunkSize || approxChunkSize;
            const totalChunks = Math.max(1, Math.ceil(f.size / realChunkSize));
            for (let idx = 0; idx < totalChunks; idx += 1) {
              const slice = f.slice(
                idx * realChunkSize,
                Math.min(f.size, (idx + 1) * realChunkSize),
              );
              const partFd = new FormData();
              partFd.append('chunk', slice, `${f.name}.part${idx}`);
              partFd.append('chunkIndex', String(idx));
              const partRes = await apiFetch(`/api/files/chunked/${initData.sessionId}/chunk`, {
                method: 'POST',
                body: partFd,
              });
              if (!partRes.ok) {
                const errData = (await partRes.json().catch(() => ({}))) as { error?: string };
                return { ok: false, error: errData.error || 'NAS 분할 청크 전송 실패' };
              }
              setChunkUploadProgress({
                filename: f.name,
                percent: Math.round(((idx + 1) / totalChunks) * 100),
                chunkIndex: idx + 1,
                totalChunks,
              });
            }
            const completeRes = await apiFetch(
              `/api/files/chunked/${initData.sessionId}/complete`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ caption: input.caption }),
              },
            );
            const completeData = (await completeRes.json().catch(() => ({}))) as {
              message?: Message;
              file?: SharedFileItem;
              error?: string;
            };
            if (!completeRes.ok) {
              return { ok: false, error: completeData.error || 'NAS 분할 병합 완료 실패' };
            }
            if (completeData.message) {
              setMessages((prev) =>
                prev.some((m) => m.id === completeData.message!.id)
                  ? prev
                  : [...prev, completeData.message!],
              );
            }
            if (completeData.file) {
              setFiles((prev) =>
                prev.some((item) => item.id === completeData.file!.id)
                  ? prev
                  : [completeData.file!, ...prev],
              );
            }
            postSyncChannel({
              type: 'data:patch',
              kind: 'message:created',
              payload: { message: completeData.message, sharedFile: completeData.file },
            });
            return { ok: true };
          } finally {
            setChunkUploadProgress(null);
          }
        }
      }

      const res = await apiFetch(`/api/rooms/${activeRoom.id}/nas-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nasFolder: input.nasFolder,
          filename: input.filename,
          sourceNasRelativePath: input.sourceNasRelativePath,
          externalNasUrl: input.externalNasUrl,
          sizeValue: input.sizeValue,
          sizeUnit: input.sizeUnit,
          expiresDays: input.expiresDays,
          passcode: input.passcode,
          maxDownloads: input.maxDownloads,
          caption: input.caption,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: Message;
        file?: SharedFileItem;
        error?: string;
      };
      if (!res.ok) {
        return { ok: false, error: data.error || 'NAS 대용량 공유 실패' };
      }
      if (data.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!],
        );
      }
      if (data.file) {
        setFiles((prev) =>
          prev.some((f) => f.id === data.file!.id) ? prev : [data.file!, ...prev],
        );
      }
      postSyncChannel({
        type: 'data:patch',
        kind: 'message:created',
        payload: { message: data.message, sharedFile: data.file },
      });
      return { ok: true };
    },
    [apiFetch, activeRoom, currentUser, postSyncChannel],
  );

  const handleScheduleRsvp = useCallback(
    async (messageId: string, choice: 'yes' | 'maybe' | 'no') => {
      if (!currentUser) return;
      const res = await apiFetch(`/api/messages/${messageId}/schedule-rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      if (res.ok) {
        const data = (await res.json()) as { message?: Message };
        if (data.message) {
          setMessages((prev) => prev.map((m) => (m.id === data.message!.id ? data.message! : m)));
          postSyncChannel({
            type: 'data:patch',
            kind: 'message:updated',
            payload: { message: data.message },
          });
        }
      }
    },
    [apiFetch, currentUser, postSyncChannel],
  );

  const handleRunRandomDraw = useCallback(
    async (topic: string, candidatesText: string) => {
      if (!currentUser || !activeRoom) return { ok: false, error: '대화방을 선택해 주세요.' };
      const res = await apiFetch(`/api/rooms/${activeRoom.id}/draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, candidatesText }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: Message; error?: string };
      if (!res.ok) {
        return { ok: false, error: data.error || '랜덤 추첨 실행 실패' };
      }
      if (data.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!],
        );
        postSyncChannel({
          type: 'data:patch',
          kind: 'message:created',
          payload: { message: data.message },
        });
      }
      return { ok: true };
    },
    [apiFetch, activeRoom, currentUser, postSyncChannel],
  );

  const handleScheduleMessage = useCallback(
    async (content: string, scheduledAt: string) => {
      if (!currentUser || !activeRoom) return;
      const res = await apiFetch(`/api/rooms/${activeRoom.id}/scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, scheduledAt }),
      });
      if (res.ok) {
        const data = (await res.json()) as { scheduledMessage?: ScheduledMessageItem };
        if (data.scheduledMessage) {
          setScheduledMessages((prev) =>
            prev.some((s) => s.id === data.scheduledMessage!.id)
              ? prev
              : [data.scheduledMessage!, ...prev],
          );
          pushToast({
            title: '예약 전송 등록 완료',
            body: `${content.slice(0, 32)} · 예약 시각에 자동 발송됩니다.`,
            type: 'system',
            roomId: activeRoom.id,
          });
        }
      }
    },
    [apiFetch, activeRoom, currentUser, pushToast],
  );

  const handleCancelScheduledMessage = useCallback(
    async (id: string) => {
      if (!currentUser) return;
      const res = await apiFetch(`/api/scheduled/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setScheduledMessages((prev) => prev.filter((s) => s.id !== id));
      }
    },
    [apiFetch, currentUser],
  );

  const handleForwardToSelf = useCallback(
    async (messageId: string) => {
      if (!currentUser) return;
      let selfRoom = rooms.find((r) => r.type === 'self' && r.memberIds.includes(currentUser.id));
      if (!selfRoom) {
        const selfRes = await apiFetch('/api/rooms/self', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const selfData = (await selfRes.json()) as { room?: ChatRoom };
        if (selfData.room) {
          selfRoom = selfData.room;
          setRooms((prev) =>
            prev.some((r) => r.id === selfData.room!.id) ? prev : [selfData.room!, ...prev],
          );
        }
      }
      if (!selfRoom) return;
      const res = await apiFetch('/api/messages/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: [messageId], targetRoomId: selfRoom.id }),
      });
      if (res.ok) {
        const data = (await res.json()) as { room?: ChatRoom; messages?: Message[] };
        if (data.room) {
          setRooms((prev) => prev.map((r) => (r.id === data.room!.id ? data.room! : r)));
        }
        if (Array.isArray(data.messages)) {
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            return [...prev, ...data.messages!.filter((m) => !ids.has(m.id))];
          });
        }
        pushToast({
          title: '나와의 채팅으로 보관 완료',
          body: '선택한 항목이 나와의 채팅 보관함으로 전달되었습니다.',
          type: 'file',
          roomId: selfRoom.id,
        });
      }
    },
    [apiFetch, currentUser, rooms, pushToast],
  );

  const handleMarkNotificationRead = async (id: string) => {
    if (!currentUser) return;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await apiFetch(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  };

  const handleMarkAllRead = async () => {
    if (!currentUser) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await apiFetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  };

  if (checkingTestSession || (currentUserId && !currentUser)) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 text-sm text-neutral-500">
        SG Talk에 입장하는 중입니다...
      </div>
    );
  }

  if (!currentUserId) {
    return (
      <AuthScreen
        onAuthenticated={handleAuthenticated}
        onQuickTestEnter={() => enterTestSession()}
      />
    );
  }

  if (!currentUser) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 text-sm text-neutral-500">
        SG Talk 데이터를 불러오는 중입니다...
      </div>
    );
  }

  const colleagues = users.filter((u) => u.id !== currentUser.id && u.role !== 'bot');
  const onLeaveTodayUsers = users.filter(
    (u) => u.role !== 'bot' && isUserOnLeaveOnDate(leaves, u.id, todayDate) !== null,
  );

  return (
    <div className="h-screen w-full overflow-hidden flex flex-col bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      {/* System-Wide Emergency Disaster-Style Notice Banner */}
      {urgentAlertBanner && (
        <EmergencyAlertBanner
          alert={urgentAlertBanner}
          onReplaySound={() => playEmergencyAlertSound()}
          onStopSound={() => stopEmergencyAlertSound()}
          onOpenRoom={(roomId) => {
            handleSelectRoom(roomId);
            setActiveTab('chats');
          }}
          onAcknowledge={handleAcknowledgeNotice}
          onClose={() => setUrgentAlertBanner(null)}
        />
      )}

      {/* Real-time Floating Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 md:top-16 md:bottom-auto right-4 z-50 space-y-2 max-w-sm w-[calc(100vw-32px)]">
          {toasts.map((toast) => {
            const isUrgent = Boolean(toast.isUrgent || toast.priority === 'urgent');
            return (
              <div
                key={toast.id}
                role={isUrgent ? 'alert' : 'status'}
                className={`p-3.5 rounded-2xl shadow-xl flex items-start justify-between gap-3 ${
                  isUrgent
                    ? 'bg-red-950 text-white border-2 border-red-400 ring-2 ring-red-500/40'
                    : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700'
                }`}
              >
                <div className="min-w-0">
                  <div
                    className={`text-xs font-bold flex items-center gap-1.5 ${
                      isUrgent ? 'text-amber-200' : 'text-neutral-900 dark:text-white'
                    }`}
                  >
                    {isUrgent ? (
                      <Siren className="h-3.5 w-3.5 text-red-300 shrink-0 animate-pulse" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-[#07C160] ring-1 ring-[#075E54] shrink-0" />
                    )}
                    {isUrgent && (
                      <span className="px-1.5 py-0.2 rounded bg-red-600 text-white text-[10px] font-extrabold shrink-0">
                        긴급재난문자
                      </span>
                    )}
                    <span className="truncate">{toast.title}</span>
                  </div>
                  <p
                    className={`mt-1 text-xs leading-snug ${
                      isUrgent ? 'text-red-100' : 'text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    {toast.body}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {isUrgent && toast.noticeId && (
                      <button
                        type="button"
                        onClick={async () => {
                          await handleAcknowledgeNotice(toast.noticeId!);
                          stopEmergencyAlertSound();
                          setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                        }}
                        className="px-2 py-0.5 rounded-md bg-[#FEE500] hover:bg-amber-300 text-red-950 text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        <span>수신 확인</span>
                      </button>
                    )}
                    {toast.roomId && (
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectRoom(toast.roomId!);
                          setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                        }}
                        className={`text-[11px] font-bold hover:underline cursor-pointer ${
                          isUrgent ? 'text-white' : 'text-[#008069] dark:text-[#07C160]'
                        }`}
                      >
                        채팅방 보기
                      </button>
                    )}
                    {toast.type === 'mail' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (toast.mailId) {
                            handleOpenMailReader(toast.mailId);
                          } else {
                            handleOpenBmail();
                          }
                          setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                        }}
                        className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {toast.mailId ? '상세히 보기 (이메일 앱)' : 'bmail에서 열기'}
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  aria-label="알림 닫기"
                  className={`cursor-pointer shrink-0 ${
                    isUrgent ? 'text-red-200 hover:text-white' : 'text-neutral-400 hover:text-neutral-700'
                  }`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 1: WEB EXTENSION VIEW (SG Talk Sub-App Full-Width 3-Column)       */}
      {/* ===================================================================== */}
      {viewMode === 'extension' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Top Bar Contract (3 zones) */}
          <header className="shrink-0 h-14 px-5 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-8">
            <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
              <div className="h-8 w-8 rounded-xl bg-[#FEE500] text-[#1C2924] flex items-center justify-center font-bold shadow-2xs">
                <MessageCircle className="h-4 w-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-neutral-900 dark:text-white">
                SG Talk
              </span>
            </div>

            <nav
              aria-label="SGW 서브앱 메뉴"
              className="hidden md:flex items-center gap-6 text-sm font-medium"
            >
              <button
                type="button"
                onClick={() => switchTab('chats')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === 'chats'
                    ? 'border-[#008069] dark:border-[#07C160] text-[#075E54] dark:text-white font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                메신저 {totalUnreadMessages > 0 ? `(${totalUnreadMessages})` : ''}
              </button>
              <button
                type="button"
                onClick={() => switchTab('friends')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === 'friends'
                    ? 'border-[#008069] dark:border-[#07C160] text-[#075E54] dark:text-white font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                조직도
              </button>
              <button
                type="button"
                onClick={() => switchTab('leave')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === 'leave'
                    ? 'border-[#008069] dark:border-[#07C160] text-[#075E54] dark:text-white font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                연차·알림 {unreadNotifications > 0 ? `(${unreadNotifications})` : ''}
              </button>
              <button
                type="button"
                onClick={() => switchTab('files')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === 'files'
                    ? 'border-[#008069] dark:border-[#07C160] text-[#075E54] dark:text-white font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                파일함
              </button>
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setControlTowerTab('brain');
                  setShowControlTower(true);
                }}
                aria-label="AI 음성 어시스턴트 열기"
                className="h-8 px-3 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#FEE500]" />
                <span>AI 어시스턴트</span>
                {(unreadMailsCount > 0 || unreadNotifications > 0) && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#FEE500] text-[#1C2924] text-[10px] font-extrabold tabular-nums">
                    {unreadMailsCount + unreadNotifications}
                  </span>
                )}
              </button>
              {!lockedTarget && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowInstallModal(true)}
                    className="h-8 px-2.5 rounded-xl bg-[#1C2924] hover:bg-[#263831] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-[#FEE500]" />
                    <span className="hidden sm:inline">확장앱·모바일 설치</span>
                    <span className="sm:hidden">설치</span>
                  </button>
                  <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setViewMode('app')}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      <span>모바일 앱</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('extension')}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs flex items-center gap-1 whitespace-nowrap cursor-pointer"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                      <span>웹 확장앱</span>
                    </button>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                aria-label="테마 전환"
                className="h-9 w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => setProfileModalUser(currentUser)}
                aria-label="내 프로필 열기"
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <Avatar user={currentUser} size="xs" showOnline />
                <span className="hidden sm:inline text-xs font-semibold whitespace-nowrap">
                  {currentUser.name}
                </span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                aria-label="로그아웃"
                title="로그아웃 / 계정 전환"
                className="h-9 w-9 rounded-xl flex items-center justify-center text-neutral-500 hover:text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* 3-Column Extension Workspace */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Left Sidebar: Company Account Statuses (Double-click to Chat) + Channels + DMs */}
            <aside className="hidden md:flex w-[280px] shrink-0 flex-col bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800">
              <div className="p-3 border-b border-neutral-100 dark:border-neutral-800 space-y-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('leave')}
                  className="w-full h-9 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <CalendarCheck2 className="h-4 w-4" />
                  <span>연차 등록 · bmail 알림</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto chat-scroll p-2.5 space-y-4">
                {/* Company Account Logged-In Users & Presence (Double-Click to Chat) */}
                <div>
                  <div className="px-1.5 py-1 flex items-center justify-between text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    <span>회사 계정 상태 · 더블클릭 대화</span>
                    <span className="tabular-nums">{colleagues.filter((c) => c.online).length}/{colleagues.length}</span>
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {colleagues.map((col) => {
                      const leaveToday = isUserOnLeaveOnDate(leaves, col.id, todayDate);
                      const statusLabel = leaveToday
                        ? leaveToday.type
                        : PRESENCE_LABELS[col.presenceStatus ?? (col.online ? 'online' : 'offline')];
                      return (
                        <div
                          key={col.id}
                          className="group px-1.5 py-1 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-between gap-1 select-none"
                        >
                          <button
                            type="button"
                            onDoubleClick={() => handleStartDirectChat(col.id)}
                            title="더블클릭하여 1:1 대화 열기"
                            aria-label={`${col.name} ${statusLabel} 더블클릭으로 1:1 대화`}
                            className="flex-1 min-w-0 flex items-center gap-2 px-1 py-0.5 text-left cursor-pointer"
                          >
                            <Avatar user={col} size="xs" showOnline onLeave={Boolean(leaveToday)} />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                                {col.name} {col.position}
                              </div>
                              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                                {statusLabel} · {col.department}
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartDirectChat(col.id)}
                            aria-label={`${col.name} 1:1 대화`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-6 w-6 rounded-md flex items-center justify-center text-neutral-500 hover:bg-white dark:hover:bg-neutral-700 cursor-pointer shrink-0"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Channels */}
                <div>
                  <div className="px-1.5 py-1 flex items-center justify-between text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    <span>팀 · 알림 채널</span>
                    <button
                      type="button"
                      onClick={() => setShowNewChatModal(true)}
                      aria-label="새 채널 만들기"
                      className="h-6 w-6 rounded flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {rooms
                      .filter((r) => r.type !== 'direct')
                      .map((room) => {
                        const unread = getRoomUnreadCount(messages, room.id, currentUser.id);
                        const hasMention = hasUnreadMentionForUser(messages, room.id, currentUser.id);
                        const selected = activeTab === 'chats' && activeRoomId === room.id;
                        return (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => handleSelectRoom(room.id)}
                            className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-left text-xs transition-colors cursor-pointer ${
                              selected
                                ? 'bg-[#07C160]/12 dark:bg-[#07C160]/20 font-bold text-[#075E54] dark:text-white'
                                : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                          >
                            <span className="truncate flex items-center gap-1 min-w-0">
                              {room.type === 'self' && (
                                <span className="px-1 py-0.2 rounded bg-[#FEE500] text-[#1C2924] text-[10px] font-bold shrink-0">
                                  나
                                </span>
                              )}
                              <span className="truncate">
                                {room.type === 'self' ? '나와의 채팅' : `# ${room.name}`}
                              </span>
                            </span>
                            <span className="flex items-center gap-1 shrink-0">
                              {hasMention && (
                                <span className="text-[10px] font-bold text-[#008069] dark:text-[#07C160]">
                                  @멘션
                                </span>
                              )}
                              {unread > 0 && (
                                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF4B4B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                                  {unread}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* Direct Messages */}
                <div>
                  <div className="px-1.5 py-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    1:1 대화방
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {rooms
                      .filter((r) => r.type === 'direct')
                      .map((room) => {
                        const unread = getRoomUnreadCount(messages, room.id, currentUser.id);
                        const selected = activeTab === 'chats' && activeRoomId === room.id;
                        const peerId = room.memberIds.find((id) => id !== currentUser.id) ?? currentUser.id;
                        const peer = usersById[peerId];
                        return (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => handleSelectRoom(room.id)}
                            className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 text-left text-xs transition-colors cursor-pointer ${
                              selected
                                ? 'bg-[#07C160]/12 dark:bg-[#07C160]/20 font-bold text-[#075E54] dark:text-white'
                                : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar user={peer} size="xs" showOnline />
                              <span className="truncate">
                                {getRoomDisplayName(room, currentUser.id, usersById)}
                              </span>
                            </div>
                            {unread > 0 && (
                              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF4B4B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                                {unread}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* Today Leave Roster */}
                <div className="mx-0.5 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/70 dark:border-neutral-800">
                  <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                    <span>오늘 연차 현황</span>
                    <span className="tabular-nums text-amber-600">{onLeaveTodayUsers.length}명</span>
                  </div>
                  {onLeaveTodayUsers.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-neutral-400">전원 정상 근무 중</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {onLeaveTodayUsers.map((u) => {
                        const l = isUserOnLeaveOnDate(leaves, u.id, todayDate);
                        return (
                          <div key={u.id} className="text-[11px] text-neutral-600 dark:text-neutral-300 flex items-center justify-between">
                            <span className="font-medium truncate">
                              {u.name} {u.position}
                            </span>
                            <span className="text-amber-700 dark:text-amber-400 shrink-0">{l?.type}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* Center Main Viewport */}
            <main className="flex-1 min-w-0 min-h-0 flex flex-col">
              <div className="md:hidden shrink-0 px-3 py-2 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-1 overflow-x-auto">
                {(
                  [
                    { id: 'chats', label: '메신저' },
                    { id: 'friends', label: '조직도' },
                    { id: 'leave', label: '연차·알림' },
                    { id: 'files', label: '파일함' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => switchTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                      activeTab === t.id
                        ? 'bg-[#008069] text-white font-bold'
                        : 'text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === 'chats' && activeRoom ? (
                <ChatRoomView
                  room={activeRoom}
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  messages={messages}
                  leaves={leaves}
                  mails={mails}
                  notices={notices}
                  notifications={notifications}
                  activeNotice={activeNotice}
                  typingUserIds={typingByRoom[activeRoom.id] ?? []}
                  todayDate={todayDate}
                  draftText={draftsByRoom[activeRoom.id] ?? ''}
                  draftSavedAt={lastSavedAtByRoom[activeRoom.id] ?? null}
                  fileToken={fileToken}
                  jumpToMessageRequest={jumpToMessageRequest}
                  showInspectorToggle
                  onToggleInspector={() => setShowInspectorDrawer((v) => !v)}
                  onDraftChange={(text) => setRoomDraft(activeRoom.id, text)}
                  onSendMessage={handleSendMessage}
                  onRegisterLeaveFromChat={handleRegisterLeave}
                  onTriggerIntegration={handleTriggerIntegration}
                  onUploadFile={handleUploadFile}
                  onMarkRead={handleMarkRead}
                  onToggleReaction={handleToggleReaction}
                  onEditMessage={handleEditMessage}
                  onRecallMessage={handleRecallMessage}
                  onToggleStarMessage={handleToggleStarMessage}
                  onOpenForwardModal={(ids) => setForwardModalMessageIds(ids)}
                  onDeleteMessage={handleDeleteMessage}
                  onVotePoll={handleVotePoll}
                  onScheduleRsvp={handleScheduleRsvp}
                  onOpenNoticeModal={(initialContent, messageId, options) =>
                    setNoticeModalDraft({
                      open: true,
                      initialContent,
                      messageId,
                      initialUrgent: options?.urgent,
                      initialTitle: options?.initialTitle,
                    })
                  }
                  onAcknowledgeNotice={handleAcknowledgeNotice}
                  onOpenNoticesDrawer={() => {
                    setInspectorTab('notices');
                    setShowInspectorDrawer(true);
                  }}
                  roomNoticesCount={notices.filter((n) => n.roomId === activeRoom.id).length}
                  onOpenPollModal={() => setShowPollModal(true)}
                  onGoToLeaveTab={() => switchTab('leave')}
                  onGoToMailTab={() => handleOpenBmail()}
                  onStartDirectChat={handleStartDirectChat}
                  onPreviewImage={(f) => setLightboxFile(f)}
                  onTypingChange={(typing) => sendTyping(activeRoom.id, typing)}
                  onSelectUserProfile={(u) => setProfileModalUser(u)}
                  apiFetch={apiFetch}
                  onEgoSelfMessage={handleEgoSelfMessage}
                  scheduledMessages={scheduledMessages}
                  onScheduleMessage={handleScheduleMessage}
                  onCancelScheduledMessage={handleCancelScheduledMessage}
                  onShareLargeLink={handleShareLargeLink}
                  onShareNasFile={handleShareNasFile}
                  onRunRandomDraw={handleRunRandomDraw}
                  onOpenMail={handleOpenMailReader}
                  onMailSent={handleMailSentLocal}
                  onMarkNotificationRead={handleMarkNotificationRead}
                  onMarkAllNotificationsRead={handleMarkAllRead}
                  onOpenRoom={handleSelectRoom}
                  onAnalyzeVoice={handleAnalyzeVoiceMessage}
                  onTranslateOrSummarize={handleTranslateOrSummarizeMessage}
                  onForwardToSelf={handleForwardToSelf}
                  onRevokeFile={handleRevokeSharedFile}
                  onOpenViewOnce={handleOpenViewOnce}
                  onSetDisappearing={(sec) => handleSetDisappearing(activeRoom.id, sec)}
                  roomFiles={files.filter((f) => f.roomId === activeRoom.id)}
                  bmailBridgeStatus={bmailBridgeStatus}
                  onSyncRemoteBmail={handleSyncRemoteBmail}
                  onLaunchBmailSso={handleLaunchBmailSso}
                  externalLargeLinkNonce={externalLargeLinkNonce}
                  chunkUploadProgress={chunkUploadProgress}
                />
              ) : activeTab === 'friends' ? (
                <FriendsDirectory
                  currentUser={currentUser}
                  users={users}
                  leaves={leaves}
                  todayDate={todayDate}
                  onSelectUserProfile={(u) => setProfileModalUser(u)}
                  onStartDirectChat={handleStartDirectChat}
                  onChangeMyPresence={handleChangeMyPresence}
                  onOpenNewChatModal={() => setShowNewChatModal(true)}
                />
              ) : activeTab === 'leave' ? (
                <LeavePortalView
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  leaves={leaves}
                  notifications={notifications}
                  todayDate={todayDate}
                  apiFetch={apiFetch}
                  onRegisterLeave={handleRegisterLeave}
                  onMarkNotificationRead={handleMarkNotificationRead}
                  onMarkAllRead={handleMarkAllRead}
                  onOpenRoom={handleSelectRoom}
                  onOpenMail={handleOpenMailReader}
                />
              ) : (
                <FileVaultView
                  currentUser={currentUser}
                  usersById={usersById}
                  roomsById={roomsById}
                  files={files}
                  fileToken={fileToken}
                  onPreviewImage={(f) => setLightboxFile(f)}
                  onOpenRoom={handleSelectRoom}
                  onSendToSelf={handleForwardToSelf}
                  onRevokeFile={handleRevokeSharedFile}
                />
              )}
            </main>

            {/* Persistent Right Inspector in Web Extension Mode */}
            {activeTab === 'chats' && activeRoom && (
              <div className="hidden lg:block w-[320px] shrink-0 h-full">
                <RightInspectorPanel
                  room={activeRoom}
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  messages={messages}
                  notices={notices}
                  files={files}
                  leaves={leaves}
                  todayDate={todayDate}
                  activeTab={inspectorTab}
                  fileToken={fileToken}
                  onChangeTab={setInspectorTab}
                  onOpenCreateNotice={() => setNoticeModalDraft({ open: true })}
                  onAcknowledgeNotice={handleAcknowledgeNotice}
                  onTogglePinNotice={handleTogglePinNotice}
                  onDeleteNotice={handleDeleteNotice}
                  onPushNoticeUrgent={handlePushNoticeUrgent}
                  onTogglePinRoom={() => handleTogglePinRoomById(activeRoom.id)}
                  onToggleMuteRoom={() => handleToggleMuteRoomById(activeRoom.id)}
                  onSetDisappearing={(sec) => handleSetDisappearing(activeRoom.id, sec)}
                  onLeaveRoom={
                    activeRoom.type === 'group' ? () => handleLeaveRoomById(activeRoom.id) : undefined
                  }
                  onInviteMembers={handleInviteMembers}
                  onJumpToMessage={(messageId) =>
                    setJumpToMessageRequest({ messageId, nonce: Date.now() })
                  }
                  onToggleStarMessage={handleToggleStarMessage}
                  onPreviewImage={(f) => setLightboxFile(f)}
                  onSelectUserProfile={(u) => setProfileModalUser(u)}
                  onSendToSelf={handleForwardToSelf}
                  onRevokeFile={handleRevokeSharedFile}
                />
              </div>
            )}

            {/* Slide-over Inspector Drawer on compact screens in Extension Mode */}
            {showInspectorDrawer && activeTab === 'chats' && activeRoom && (
              <div className="lg:hidden fixed inset-y-14 right-0 z-40 w-80 max-w-full shadow-2xl">
                <RightInspectorPanel
                  room={activeRoom}
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  messages={messages}
                  notices={notices}
                  files={files}
                  leaves={leaves}
                  todayDate={todayDate}
                  activeTab={inspectorTab}
                  fileToken={fileToken}
                  onChangeTab={setInspectorTab}
                  onClose={() => setShowInspectorDrawer(false)}
                  onOpenCreateNotice={() => setNoticeModalDraft({ open: true })}
                  onAcknowledgeNotice={handleAcknowledgeNotice}
                  onTogglePinNotice={handleTogglePinNotice}
                  onDeleteNotice={handleDeleteNotice}
                  onPushNoticeUrgent={handlePushNoticeUrgent}
                  onTogglePinRoom={() => handleTogglePinRoomById(activeRoom.id)}
                  onToggleMuteRoom={() => handleToggleMuteRoomById(activeRoom.id)}
                  onSetDisappearing={(sec) => handleSetDisappearing(activeRoom.id, sec)}
                  onLeaveRoom={
                    activeRoom.type === 'group' ? () => handleLeaveRoomById(activeRoom.id) : undefined
                  }
                  onInviteMembers={handleInviteMembers}
                  onJumpToMessage={(messageId) =>
                    setJumpToMessageRequest({ messageId, nonce: Date.now() })
                  }
                  onToggleStarMessage={handleToggleStarMessage}
                  onPreviewImage={(f) => setLightboxFile(f)}
                  onSelectUserProfile={(u) => setProfileModalUser(u)}
                  onSendToSelf={handleForwardToSelf}
                  onRevokeFile={handleRevokeSharedFile}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ===================================================================== */
        /* MODE 2: MOBILE APP VIEW (Sub-App Inside SGW Desktop & Mobile)         */
        /* ===================================================================== */
        <div className="flex-1 flex flex-col min-h-0">
          {/* App View Top Bar */}
          <header className="shrink-0 h-12 px-3 sm:px-4 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
              <div className="h-7 w-7 rounded-lg bg-[#FEE500] text-[#1C2924] flex items-center justify-center shadow-2xs">
                <MessageCircle className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold tracking-tight text-neutral-900 dark:text-white">
                SG Talk
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setControlTowerTab('brain');
                  setShowControlTower(true);
                }}
                aria-label="AI 음성 어시스턴트 열기"
                className="h-8 px-2.5 sm:px-3 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#FEE500]" />
                <span className="hidden sm:inline">AI 어시스턴트</span>
                <span className="sm:hidden">AI 비서</span>
                {(unreadMailsCount > 0 || unreadNotifications > 0) && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#FEE500] text-[#1C2924] text-[10px] font-extrabold tabular-nums">
                    {unreadMailsCount + unreadNotifications}
                  </span>
                )}
              </button>
              <PWAInstallButton compact />
              {!lockedTarget && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowInstallModal(true)}
                    className="h-8 px-2 sm:px-2.5 rounded-xl bg-[#1C2924] hover:bg-[#263831] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-[#FEE500]" />
                    <span className="hidden sm:inline">확장앱·모바일 설치</span>
                    <span className="sm:hidden">설치</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('extension')}
                    aria-label="웹 확장앱 화면으로 전환"
                    title="웹 확장앱 보기"
                    className="sm:hidden h-8 w-8 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 flex items-center justify-center cursor-pointer"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                  <div className="hidden sm:flex items-center gap-1 p-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setViewMode('app')}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs flex items-center gap-1 whitespace-nowrap cursor-pointer"
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      <span>모바일 앱</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('extension')}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
                    >
                      <PanelLeft className="h-3.5 w-3.5" />
                      <span>웹 확장앱</span>
                    </button>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                aria-label="테마 전환"
                className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
            </div>
          </header>

          {/* Main App Body */}
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            {/* Left Icon Rail (Desktop) */}
            <nav
              aria-label="SGW 앱 메인 탭"
              className="hidden md:flex w-[68px] shrink-0 flex-col items-center justify-between py-4 bg-[#1C2924] text-neutral-400"
            >
              <div className="flex flex-col items-center gap-3 w-full">
                <button
                  type="button"
                  onClick={() => switchTab('friends', { syncMobileChat: false })}
                  aria-label="접속자 및 조직도"
                  title="접속자 · 조직도"
                  className={`relative h-11 w-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer ${
                    activeTab === 'friends'
                      ? 'bg-[#07C160] text-white shadow-sm'
                      : 'hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Users className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => switchTab('chats', { syncMobileChat: false })}
                  aria-label="채팅 목록"
                  title="채팅"
                  className={`relative h-11 w-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer ${
                    activeTab === 'chats'
                      ? 'bg-[#07C160] text-white shadow-sm'
                      : 'hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <MessageCircle className="h-5 w-5" />
                  {totalUnreadMessages > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF4B4B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {totalUnreadMessages > 99 ? '99+' : totalUnreadMessages}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab('leave', { syncMobileChat: false })}
                  aria-label="연차 등록 및 사내 알림"
                  title="연차 · 알림"
                  className={`relative h-11 w-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer ${
                    activeTab === 'leave'
                      ? 'bg-[#07C160] text-white shadow-sm'
                      : 'hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Bell className="h-5 w-5" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF4B4B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadNotifications}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab('files', { syncMobileChat: false })}
                  aria-label="공유 파일함"
                  title="공유 파일함"
                  className={`relative h-11 w-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer ${
                    activeTab === 'files'
                      ? 'bg-[#07C160] text-white shadow-sm'
                      : 'hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <FolderOpen className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => setProfileModalUser(currentUser)}
                  aria-label="내 프로필"
                  title="내 프로필"
                  className="cursor-pointer"
                >
                  <Avatar user={currentUser} size="sm" showOnline />
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="로그아웃"
                  title="로그아웃 / 계정 전환"
                  className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </nav>

            {/* Middle List Column (Friends/Status or Chat List) */}
            {(activeTab === 'friends' || activeTab === 'chats') && (
              <div
                className={`${
                  mobileChatOpen && activeTab === 'chats' ? 'hidden md:flex' : 'flex'
                } w-full md:w-[330px] shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800 h-full pb-16 md:pb-0`}
              >
                {activeTab === 'friends' ? (
                  <FriendsDirectory
                    currentUser={currentUser}
                    users={users}
                    leaves={leaves}
                    todayDate={todayDate}
                    onSelectUserProfile={(u) => setProfileModalUser(u)}
                    onStartDirectChat={handleStartDirectChat}
                    onChangeMyPresence={handleChangeMyPresence}
                    onOpenNewChatModal={() => setShowNewChatModal(true)}
                  />
                ) : (
                  <ChatListPanel
                    currentUser={currentUser}
                    users={users}
                    usersById={usersById}
                    rooms={rooms}
                    messages={messages}
                    leaves={leaves}
                    todayDate={todayDate}
                    activeRoomId={activeRoomId}
                    draftsByRoom={draftsByRoom}
                    typingByRoom={typingByRoom}
                    onSelectRoom={handleSelectRoom}
                    onStartDirectChat={handleStartDirectChat}
                    onOpenSelfChat={handleOpenSelfChat}
                    onOpenNewChatModal={() => setShowNewChatModal(true)}
                    onTogglePinRoom={handleTogglePinRoomById}
                    onToggleMuteRoom={handleToggleMuteRoomById}
                    onMarkRoomRead={handleMarkRoomReadById}
                    onMarkAllRoomsRead={handleMarkAllRoomsRead}
                    onLeaveRoom={handleLeaveRoomById}
                  />
                )}
              </div>
            )}

            {/* Right Active Content Pane */}
            <main
              className={`${
                (activeTab === 'friends' || activeTab === 'chats') && !mobileChatOpen
                  ? 'hidden md:flex'
                  : 'flex'
              } flex-1 min-w-0 min-h-0 flex-row relative pb-16 md:pb-0`}
            >
              <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              {activeTab === 'leave' ? (
                <LeavePortalView
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  leaves={leaves}
                  notifications={notifications}
                  todayDate={todayDate}
                  apiFetch={apiFetch}
                  onRegisterLeave={handleRegisterLeave}
                  onMarkNotificationRead={handleMarkNotificationRead}
                  onMarkAllRead={handleMarkAllRead}
                  onOpenRoom={handleSelectRoom}
                  onOpenMail={handleOpenMailReader}
                />
              ) : activeTab === 'files' ? (
                  <FileVaultView
                  currentUser={currentUser}
                  usersById={usersById}
                  roomsById={roomsById}
                  files={files}
                  fileToken={fileToken}
                  onPreviewImage={(f) => setLightboxFile(f)}
                  onOpenRoom={handleSelectRoom}
                  onSendToSelf={handleForwardToSelf}
                  onRevokeFile={handleRevokeSharedFile}
                />
              ) : activeRoom ? (
                <ChatRoomView
                  room={activeRoom}
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  messages={messages}
                  leaves={leaves}
                  mails={mails}
                  notices={notices}
                  notifications={notifications}
                  activeNotice={activeNotice}
                  typingUserIds={typingByRoom[activeRoom.id] ?? []}
                  todayDate={todayDate}
                  draftText={draftsByRoom[activeRoom.id] ?? ''}
                  draftSavedAt={lastSavedAtByRoom[activeRoom.id] ?? null}
                  fileToken={fileToken}
                  jumpToMessageRequest={jumpToMessageRequest}
                  showBackButton={mobileChatOpen}
                  showInspectorToggle
                  onBack={() => setMobileChatOpen(false)}
                  onToggleInspector={() => setShowInspectorDrawer((v) => !v)}
                  onDraftChange={(text) => setRoomDraft(activeRoom.id, text)}
                  onSendMessage={handleSendMessage}
                  onRegisterLeaveFromChat={handleRegisterLeave}
                  onTriggerIntegration={handleTriggerIntegration}
                  onUploadFile={handleUploadFile}
                  onMarkRead={handleMarkRead}
                  onToggleReaction={handleToggleReaction}
                  onEditMessage={handleEditMessage}
                  onRecallMessage={handleRecallMessage}
                  onToggleStarMessage={handleToggleStarMessage}
                  onOpenForwardModal={(ids) => setForwardModalMessageIds(ids)}
                  onDeleteMessage={handleDeleteMessage}
                  onVotePoll={handleVotePoll}
                  onScheduleRsvp={handleScheduleRsvp}
                  onOpenNoticeModal={(initialContent, messageId, options) =>
                    setNoticeModalDraft({
                      open: true,
                      initialContent,
                      messageId,
                      initialUrgent: options?.urgent,
                      initialTitle: options?.initialTitle,
                    })
                  }
                  onAcknowledgeNotice={handleAcknowledgeNotice}
                  onOpenNoticesDrawer={() => {
                    setInspectorTab('notices');
                    setShowInspectorDrawer(true);
                  }}
                  roomNoticesCount={notices.filter((n) => n.roomId === activeRoom.id).length}
                  onOpenPollModal={() => setShowPollModal(true)}
                  onGoToLeaveTab={() => switchTab('leave', { syncMobileChat: false })}
                  onGoToMailTab={() => {
                    handleOpenBmail();
                    setMobileChatOpen(false);
                  }}
                  onStartDirectChat={handleStartDirectChat}
                  onPreviewImage={(f) => setLightboxFile(f)}
                  onTypingChange={(typing) => sendTyping(activeRoom.id, typing)}
                  onSelectUserProfile={(u) => setProfileModalUser(u)}
                  apiFetch={apiFetch}
                  onEgoSelfMessage={handleEgoSelfMessage}
                  scheduledMessages={scheduledMessages}
                  onScheduleMessage={handleScheduleMessage}
                  onCancelScheduledMessage={handleCancelScheduledMessage}
                  onShareLargeLink={handleShareLargeLink}
                  onShareNasFile={handleShareNasFile}
                  onRunRandomDraw={handleRunRandomDraw}
                  onOpenMail={handleOpenMailReader}
                  onMailSent={handleMailSentLocal}
                  onMarkNotificationRead={handleMarkNotificationRead}
                  onMarkAllNotificationsRead={handleMarkAllRead}
                  onOpenRoom={handleSelectRoom}
                  onAnalyzeVoice={handleAnalyzeVoiceMessage}
                  onTranslateOrSummarize={handleTranslateOrSummarizeMessage}
                  onForwardToSelf={handleForwardToSelf}
                  onRevokeFile={handleRevokeSharedFile}
                  onOpenViewOnce={handleOpenViewOnce}
                  onSetDisappearing={(sec) => handleSetDisappearing(activeRoom.id, sec)}
                  roomFiles={files.filter((f) => f.roomId === activeRoom.id)}
                  bmailBridgeStatus={bmailBridgeStatus}
                  onSyncRemoteBmail={handleSyncRemoteBmail}
                  onLaunchBmailSso={handleLaunchBmailSso}
                  externalLargeLinkNonce={externalLargeLinkNonce}
                  chunkUploadProgress={chunkUploadProgress}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-neutral-400">
                  <MessageCircle className="h-12 w-12 mb-3 opacity-40" />
                  <p className="text-sm font-medium">채팅방을 선택하여 대화를 시작하세요</p>
                </div>
              )}

              </div>

              {showInspectorDrawer && activeRoom && (activeTab === 'chats' || activeTab === 'friends') && (
                <div className="absolute inset-y-0 right-0 z-30 w-80 max-w-full shadow-2xl xl:static xl:shadow-none xl:shrink-0">
                  <RightInspectorPanel
                    room={activeRoom}
                    currentUser={currentUser}
                    users={users}
                    usersById={usersById}
                    messages={messages}
                    notices={notices}
                    files={files}
                    leaves={leaves}
                    todayDate={todayDate}
                    activeTab={inspectorTab}
                    fileToken={fileToken}
                    onChangeTab={setInspectorTab}
                    onClose={() => setShowInspectorDrawer(false)}
                    onOpenCreateNotice={() => setNoticeModalDraft({ open: true })}
                    onAcknowledgeNotice={handleAcknowledgeNotice}
                    onTogglePinNotice={handleTogglePinNotice}
                    onDeleteNotice={handleDeleteNotice}
                    onPushNoticeUrgent={handlePushNoticeUrgent}
                    onTogglePinRoom={() => handleTogglePinRoomById(activeRoom.id)}
                    onToggleMuteRoom={() => handleToggleMuteRoomById(activeRoom.id)}
                    onSetDisappearing={(sec) => handleSetDisappearing(activeRoom.id, sec)}
                    onLeaveRoom={
                      activeRoom.type === 'group' ? () => handleLeaveRoomById(activeRoom.id) : undefined
                    }
                    onInviteMembers={handleInviteMembers}
                    onJumpToMessage={(messageId) =>
                      setJumpToMessageRequest({ messageId, nonce: Date.now() })
                    }
                    onToggleStarMessage={handleToggleStarMessage}
                    onPreviewImage={(f) => setLightboxFile(f)}
                    onSelectUserProfile={(u) => setProfileModalUser(u)}
                    onSendToSelf={handleForwardToSelf}
                    onRevokeFile={handleRevokeSharedFile}
                  />
                </div>
              )}
            </main>

            {/* Mobile Bottom Tab Bar */}
            {!mobileChatOpen && (
              <nav
                aria-label="모바일 하단 탭"
                className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border-t border-neutral-200 dark:border-neutral-800 grid grid-cols-4 items-center"
              >
                <button
                  type="button"
                  onClick={() => switchTab('friends')}
                  className={`flex flex-col items-center justify-center gap-0.5 h-full cursor-pointer ${
                    activeTab === 'friends'
                      ? 'text-[#008069] dark:text-[#07C160] font-bold'
                      : 'text-neutral-500'
                  }`}
                >
                  <Users className="h-5 w-5" />
                  <span className="text-[10px]">접속자</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('chats')}
                  className={`relative flex flex-col items-center justify-center gap-0.5 h-full cursor-pointer ${
                    activeTab === 'chats'
                      ? 'text-[#008069] dark:text-[#07C160] font-bold'
                      : 'text-neutral-500'
                  }`}
                >
                  <MessageCircle className="h-5 w-5" />
                  <span className="text-[10px]">채팅</span>
                  {totalUnreadMessages > 0 && (
                    <span className="absolute top-2 right-3 min-w-[16px] h-4 px-1 rounded-full bg-[#FF4B4B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {totalUnreadMessages}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('leave')}
                  className={`relative flex flex-col items-center justify-center gap-0.5 h-full cursor-pointer ${
                    activeTab === 'leave'
                      ? 'text-[#008069] dark:text-[#07C160] font-bold'
                      : 'text-neutral-500'
                  }`}
                >
                  <Bell className="h-5 w-5" />
                  <span className="text-[10px]">연차</span>
                  {unreadNotifications > 0 && (
                    <span className="absolute top-2 right-3 min-w-[16px] h-4 px-1 rounded-full bg-[#FF4B4B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadNotifications}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('files')}
                  className={`flex flex-col items-center justify-center gap-0.5 h-full cursor-pointer ${
                    activeTab === 'files'
                      ? 'text-[#008069] dark:text-[#07C160] font-bold'
                      : 'text-neutral-500'
                  }`}
                >
                  <FolderOpen className="h-5 w-5" />
                  <span className="text-[10px]">파일함</span>
                </button>
              </nav>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showNewChatModal && (
        <NewChatModal
          currentUser={currentUser}
          users={users}
          onClose={() => setShowNewChatModal(false)}
          onCreateRoom={handleCreateRoom}
        />
      )}

      {profileModalUser && (
        <ProfileModal
          user={profileModalUser}
          isMe={profileModalUser.id === currentUser.id}
          onClose={() => setProfileModalUser(null)}
          onStartDirectChat={handleStartDirectChat}
          onSaveStatusMessage={handleSaveStatusMessage}
        />
      )}

      {noticeModalDraft.open && (
        <NoticeModal
          initialTitle={noticeModalDraft.initialTitle}
          initialContent={noticeModalDraft.initialContent}
          initialUrgent={noticeModalDraft.initialUrgent}
          onClose={() => setNoticeModalDraft({ open: false })}
          onSubmit={handleCreateNotice}
        />
      )}

      {showPollModal && (
        <PollModal
          onClose={() => setShowPollModal(false)}
          onSubmit={async (poll) => {
            await handleSendMessage({
              type: 'poll',
              content: poll.question,
              poll,
            });
          }}
        />
      )}

      {lightboxFile && (
        <ImageLightboxModal
          file={lightboxFile}
          fileToken={fileToken}
          onClose={() => setLightboxFile(null)}
        />
      )}

      {forwardModalMessageIds && forwardModalMessageIds.length > 0 && (
        <ForwardModal
          messageCount={forwardModalMessageIds.length}
          currentUser={currentUser}
          users={users}
          usersById={usersById}
          rooms={rooms}
          currentRoomId={activeRoomId ?? ''}
          onClose={() => setForwardModalMessageIds(null)}
          onForward={(target) =>
            handleForwardMessages({ messageIds: forwardModalMessageIds, ...target })
          }
        />
      )}

      {showInstallModal && (
        <InstallTargetsModal onClose={() => setShowInstallModal(false)} />
      )}

      {showControlTower && (
        <ControlTowerDrawer
          initialTab={controlTowerTab}
          currentUser={currentUser}
          usersById={usersById}
          mails={mails}
          notices={notices}
          notifications={notifications}
          apiFetch={apiFetch}
          onClose={() => setShowControlTower(false)}
          onOpenMail={(mailId) => handleOpenMailReader(mailId)}
          onOpenRoom={(roomId) => {
            handleSelectRoom(roomId);
            setShowControlTower(false);
          }}
          onOpenLeavePortal={() => {
            setActiveTab('leave');
            setMobileChatOpen(false);
            setShowControlTower(false);
          }}
          onTriggerSedmsAction={(menuKey: SedmsMenuKey, title: string, description: string) => {
            handleTriggerIntegration({
              system: 'SEDMS',
              menuKey,
              title,
              description,
              actionLabel: '연동 모듈 열기',
            });
          }}
          onMailSimulated={(mail, notifs) => {
            setMails((prev) => (prev.some((m) => m.id === mail.id) ? prev : [mail, ...prev]));
            if (notifs.length > 0) {
              setNotifications((prev) => {
                const ids = new Set(prev.map((n) => n.id));
                return [...notifs.filter((n) => !ids.has(n.id)), ...prev];
              });
            }
          }}
          onMailSent={handleMailSentLocal}
          onScopedNoticeCreated={(notice) => {
            setNotices((prev) => {
              const unpinned = prev.map((n) =>
                n.roomId === notice.roomId && (!notice.scope || n.scope === notice.scope)
                  ? { ...n, pinned: false }
                  : n,
              );
              return unpinned.some((n) => n.id === notice.id) ? unpinned : [notice, ...unpinned];
            });
          }}
          onAcknowledgeNotice={handleAcknowledgeNotice}
          onDeleteNotice={handleDeleteNotice}
          onPushNoticeUrgent={handlePushNoticeUrgent}
          onMarkNotificationRead={handleMarkNotificationRead}
          onMarkAllNotificationsRead={handleMarkAllRead}
        />
      )}

      {openedMail && (
        <MailReaderModal
          mail={openedMail}
          usersById={usersById}
          colleagues={colleagues}
          currentUser={currentUser}
          activeRoomId={activeRoom?.id ?? null}
          fileToken={fileToken}
          apiFetch={apiFetch}
          onClose={() => setOpenedMailId(null)}
          onMarkRead={handleMarkMailRead}
          onMailSent={handleMailSentLocal}
          onShareSummaryToChat={
            activeRoom
              ? async (summaryText) => {
                  await handleSendMessage({ type: 'text', content: summaryText });
                  setOpenedMailId(null);
                  setShowControlTower(false);
                  setActiveTab('chats');
                  setMobileChatOpen(true);
                }
              : undefined
          }
          onLaunchExternalMailApp={(mailId) => handleOpenBmail(mailId)}
          onFileCopiedToNas={(copiedFile, nasFolder) => {
            setFiles((prev) =>
              prev.some((f) => f.id === copiedFile.id) ? prev : [copiedFile, ...prev],
            );
            postSyncChannel({
              type: 'data:patch',
              kind: 'file:updated',
              payload: { sharedFile: copiedFile },
            });
            pushToast({
              title: `사내 NAS 복사 완료 (${nasFolder})`,
              body: `${copiedFile.filename} 파일이 ${nasFolder} 폴더로 복사되었습니다.`,
              type: 'file',
            });
          }}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
