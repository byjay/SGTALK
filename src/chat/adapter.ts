import type {
  ChatRoom,
  IntegrationActionSummary,
  LeaveRequest,
  LeaveType,
  Message,
  MessageType,
  Notice,
  PollData,
  RoomType,
  SedmsMenuKey,
  SharedFileItem,
  User,
  VoiceAttachment,
} from '../types/client';

export interface SGWChatBootstrapPayload {
  currentUser: User;
  users: User[];
  rooms: ChatRoom[];
  messages: Message[];
  notices: Notice[];
  files: SharedFileItem[];
  leaves: LeaveRequest[];
  todayDate: string;
}

export interface SendMessageInput {
  roomId: string;
  senderId: string;
  type: MessageType;
  content: string;
  replyToId?: string | null;
  emoticonId?: string | null;
  mentions?: string[];
  file?: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    url: string;
    isImage: boolean;
  };
  poll?: PollData;
  voice?: VoiceAttachment;
  integrationAlert?: IntegrationActionSummary;
}

/**
 * SGW_V0 또는 외부 그룹웨어 호스트 앱(SEDMS · SGW)에 채팅 기능만 교체·연동할 때
 * 구현하거나 기본 REST 어댑터(`createRestChatAdapter`)를 그대로 재사용하는 표준 인터페이스입니다.
 */
export interface SGWChatAdapter {
  bootstrap(userId: string): Promise<SGWChatBootstrapPayload>;
  sendMessage(input: SendMessageInput): Promise<{ message: Message; room?: ChatRoom; file?: SharedFileItem }>;
  editMessage(messageId: string, userId: string, content: string): Promise<{ message: Message }>;
  recallMessage(messageId: string, userId: string): Promise<{ message: Message }>;
  deleteMessage(messageId: string, userId: string): Promise<{ message: Message }>;
  toggleReaction(messageId: string, userId: string, emoji: string): Promise<{ message: Message }>;
  toggleStar(messageId: string, userId: string): Promise<{ message: Message }>;
  forwardMessages(input: {
    senderId: string;
    messageIds: string[];
    targetRoomId?: string;
    targetUserId?: string;
  }): Promise<{ room: ChatRoom; messages: Message[] }>;
  markRead(roomId: string, userId: string): Promise<{ messages?: Message[] }>;
  openDirectRoom(userId: string, targetUserId: string): Promise<{ room: ChatRoom }>;
  openSelfRoom(userId: string): Promise<{ room: ChatRoom }>;
  createRoom(input: {
    name: string;
    topic?: string;
    type?: RoomType;
    creatorId: string;
    memberIds: string[];
  }): Promise<{ room: ChatRoom; messages?: Message[] }>;
  inviteMembers(roomId: string, inviterId: string, userIds: string[]): Promise<{ room: ChatRoom; messages?: Message[] }>;
  leaveRoom(roomId: string, userId: string): Promise<{ roomId: string; deleted?: boolean; room?: ChatRoom }>;
  setDisappearing(roomId: string, userId: string, disappearingSeconds: number | null): Promise<{ room: ChatRoom; message?: Message }>;
  togglePinRoom(roomId: string, userId: string): Promise<{ room: ChatRoom }>;
  toggleMuteRoom(roomId: string, userId: string): Promise<{ room: ChatRoom }>;
  uploadFile(
    file: File,
    meta?: { roomId?: string; uploaderId?: string; caption?: string },
  ): Promise<SharedFileItem & { _serverMessage?: Message }>;
  createNotice(roomId: string, authorId: string, title: string, content: string): Promise<{ notice: Notice; message?: Message }>;
  votePoll(messageId: string, userId: string, optionId: string): Promise<{ message: Message }>;
  registerLeaveFromChat(input: {
    userId: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId?: string | null;
    reason?: string;
    roomId?: string;
  }): Promise<{ leave: LeaveRequest; message?: Message }>;
}

export type SGWHostBridgeEvent =
  | { type: 'SGW_CHAT_READY'; version: '1.0' }
  | { type: 'SGW_UNREAD_CHANGED'; count: number }
  | { type: 'SGW_LEAVE_REGISTERED'; leaveId: string; summary: string }
  | { type: 'BMAIL_OPEN'; mailId?: string }
  | { type: 'SEDMS_OPEN_MENU'; menuKey: SedmsMenuKey; payload?: Record<string, string> }
  | {
      type: 'SGW_PROJECT_CALENDAR_OPEN';
      action?: 'view' | 'create';
      date?: string;
      title?: string;
      payload?: Record<string, string>;
    }
  | {
      type: 'SGW_MEETING_MEMO_OPEN';
      action?: 'view' | 'create';
      content?: string;
      sourceRoomId?: string;
      sourceMessageId?: string;
      payload?: Record<string, string>;
    }
  | {
      type: 'SGW_MEETING_OPEN';
      action?: 'start' | 'join';
      roomId?: string;
      title?: string;
      payload?: Record<string, string>;
    };

export function isTrustedSgwOrigin(origin: string, extraAllowedOrigins?: string[]): boolean {
  if (!origin) return false;
  if (typeof window !== 'undefined' && origin === window.location.origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.run.app')) {
      return true;
    }
  } catch {
    return false;
  }

  const envAllowed =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        ?.VITE_SGW_ALLOWED_ORIGINS) ||
    '';

  const configuredList = [
    ...envAllowed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(extraAllowedOrigins ?? []),
  ];

  return configuredList.includes(origin);
}

export function postSgwHostEvent(event: SGWHostBridgeEvent, targetOrigin?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('sgw-host-bridge', { detail: event }));
  } catch {
    // Ignore CustomEvent issues in restricted contexts
  }
  try {
    if (window.parent && window.parent !== window) {
      let resolvedOrigin: string | null = null;
      if (targetOrigin && isTrustedSgwOrigin(targetOrigin)) {
        resolvedOrigin = targetOrigin;
      } else if (typeof document !== 'undefined' && document.referrer) {
        try {
          const refOrigin = new URL(document.referrer).origin;
          if (isTrustedSgwOrigin(refOrigin)) {
            resolvedOrigin = refOrigin;
          }
        } catch {
          // Ignore malformed referrer
        }
      }
      if (resolvedOrigin) {
        window.parent.postMessage({ source: 'sgw-messenger', ...event }, resolvedOrigin);
      }
    }
  } catch {
    // Ignore cross-origin postMessage restriction
  }
}

export function buildIntegrationHostEvent(summary: IntegrationActionSummary): SGWHostBridgeEvent {
  if (summary.menuKey === 'project-calendar') {
    return {
      type: 'SGW_PROJECT_CALENDAR_OPEN',
      action: summary.payload?.action === 'create' ? 'create' : 'view',
      date: summary.payload?.date,
      title: summary.title,
      payload: summary.payload,
    };
  }
  if (summary.menuKey === 'meeting-memo') {
    return {
      type: 'SGW_MEETING_MEMO_OPEN',
      action: summary.payload?.action === 'create' ? 'create' : 'view',
      content: summary.payload?.content,
      sourceRoomId: summary.payload?.sourceRoomId,
      sourceMessageId: summary.payload?.sourceMessageId,
      payload: summary.payload,
    };
  }
  if (summary.menuKey === 'meeting') {
    return {
      type: 'SGW_MEETING_OPEN',
      action: summary.payload?.action === 'join' ? 'join' : 'start',
      roomId: summary.payload?.roomId,
      title: summary.title,
      payload: summary.payload,
    };
  }
  if (summary.menuKey === 'bmail') {
    return {
      type: 'BMAIL_OPEN',
      mailId: summary.payload?.mailId,
    };
  }
  return {
    type: 'SEDMS_OPEN_MENU',
    menuKey: summary.menuKey,
    payload: summary.payload,
  };
}

export function createRestChatAdapter(
  apiBaseUrl = '',
  getAuthToken?: () => string | null,
): SGWChatAdapter {
  const base = apiBaseUrl.replace(/\/$/, '');

  async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const token = getAuthToken?.() ?? null;
    const headers = new Headers(init?.headers);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Chat API error: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  const jsonHeaders = { 'Content-Type': 'application/json' };

  return {
    bootstrap: () => jsonFetch(`${base}/api/bootstrap`),

    sendMessage: ({ roomId, ...rest }) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(rest),
      }),

    editMessage: (messageId, _userId, content) =>
      jsonFetch(`${base}/api/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ content }),
      }),

    recallMessage: (messageId) =>
      jsonFetch(`${base}/api/messages/${encodeURIComponent(messageId)}/recall`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    deleteMessage: (messageId) =>
      jsonFetch(`${base}/api/messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
      }),

    toggleReaction: (messageId, _userId, emoji) =>
      jsonFetch(`${base}/api/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ emoji }),
      }),

    toggleStar: (messageId) =>
      jsonFetch(`${base}/api/messages/${encodeURIComponent(messageId)}/star`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    forwardMessages: (input) =>
      jsonFetch(`${base}/api/messages/forward`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(input),
      }),

    markRead: (roomId) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/read`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    openDirectRoom: (_userId, targetUserId) =>
      jsonFetch(`${base}/api/rooms/direct`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ targetUserId }),
      }),

    openSelfRoom: () =>
      jsonFetch(`${base}/api/rooms/self`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    createRoom: (input) =>
      jsonFetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(input),
      }),

    inviteMembers: (roomId, _inviterId, userIds) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/invite`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ userIds }),
      }),

    leaveRoom: (roomId) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/leave`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    setDisappearing: (roomId, _userId, disappearingSeconds) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/disappearing`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ disappearingSeconds }),
      }),

    togglePinRoom: (roomId) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/pin`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    toggleMuteRoom: (roomId) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/mute`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),

    uploadFile: async (file, meta) => {
      const formData = new FormData();
      formData.append('file', file);
      if (meta?.caption) formData.append('caption', meta.caption);
      const roomId = meta?.roomId || 'room-company';
      const data = await jsonFetch<{ file: SharedFileItem; message?: Message }>(
        `${base}/api/rooms/${encodeURIComponent(roomId)}/upload`,
        { method: 'POST', body: formData },
      );
      return { ...data.file, _serverMessage: data.message };
    },

    createNotice: (roomId, _authorId, title, content) =>
      jsonFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/notices`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title, content }),
      }),

    votePoll: (messageId, _userId, optionId) =>
      jsonFetch(`${base}/api/polls/${encodeURIComponent(messageId)}/vote`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ optionId }),
      }),

    registerLeaveFromChat: (input) =>
      jsonFetch(`${base}/api/leaves`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(input),
      }),
  };
}
