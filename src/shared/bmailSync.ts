import type { ChatRoom, MailAttachmentItem, MailMessage, Message, User } from './types';

export interface BmailLedgerAttachmentInput {
  filename: string;
  size_bytes: number;
}

export interface BmailLedgerItem {
  bmail_uid: string;
  direction: 'sent' | 'recv';
  mail_date: string;
  mail_timestamp: string;
  sender: string;
  recipients: string;
  subject: string;
  body_snippet: string;
  attachments: BmailLedgerAttachmentInput[];
  action_status: 'need_reply' | 'done';
  source_system: string;
  projectCode?: string;
  ingestedAt: string;
}

export interface SgwEmployeeDto {
  sub: string;
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  position: string;
  status: string;
  phone?: string;
}

export interface SgwChatRoomDto {
  id: string;
  participants: string[];
  lastMessage: string;
  lastMessageTime: number;
  lastMessageSenderId?: string;
  rev: number;
  unreadCount: number;
}

export interface SgwChatMessageDto {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  timestamp: number;
  readBy: string[];
  hasFile: boolean;
  fileName?: string;
  replyToId?: string;
  mentions?: string[];
  reactions?: Record<string, string[]>;
  isEdited?: boolean;
  isDeleted?: boolean;
}

export interface SgwDirectMessageDto {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  content: string;
  timestamp: number;
  isRead: boolean;
  hasFile: boolean;
  fileName?: string;
  replyToId?: string;
  reactions?: Record<string, string[]>;
  isEdited?: boolean;
  isDeleted?: boolean;
}

export interface BmailRemoteMailItem {
  id: string;
  threadId?: string;
  senderSub: string;
  senderName: string;
  subject: string;
  body: string;
  createdAt: string;
  isRead?: boolean;
  box?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    sizeBytes?: number;
    size?: number;
    mimeType?: string;
    downloadUrl?: string;
  }>;
}

export function extractProjectCodeHint(text: string): string | undefined {
  const match = String(text || '').match(/\b([0-9]{2,4}[A-Z]{1,4}[-_]?[0-9]{1,3}|PRJ[-_][A-Z0-9-]{2,12})\b/);
  return match ? match[1] : undefined;
}

export function normalizeBmailLedgerBatch(rawItems: unknown): BmailLedgerItem[] {
  if (!Array.isArray(rawItems)) return [];
  const now = new Date().toISOString();
  const normalized: BmailLedgerItem[] = [];

  for (const raw of rawItems.slice(0, 100)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const uid = String(item.bmail_uid || item.id || '').trim().slice(0, 160);
    if (!uid) continue;

    const direction: 'sent' | 'recv' = item.direction === 'sent' ? 'sent' : 'recv';
    const mailTimestamp =
      typeof item.mail_timestamp === 'string' && item.mail_timestamp.trim()
        ? item.mail_timestamp.trim()
        : now;
    const mailDate =
      typeof item.mail_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.mail_date)
        ? item.mail_date.slice(0, 10)
        : mailTimestamp.slice(0, 10);
    const subject = String(item.subject || '(제목 없음)').trim().slice(0, 300);
    const bodySnippet = String(item.body_snippet || '').trim().slice(0, 600);
    const attachments: BmailLedgerAttachmentInput[] = Array.isArray(item.attachments)
      ? item.attachments
          .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
          .slice(0, 20)
          .map((a) => ({
            filename: String(a.filename || 'attachment').slice(0, 200),
            size_bytes: Math.max(0, Number(a.size_bytes || a.size || 0) || 0),
          }))
      : [];

    normalized.push({
      bmail_uid: uid,
      direction,
      mail_date: mailDate,
      mail_timestamp: mailTimestamp,
      sender: String(item.sender || 'unknown@sgw.co.kr').trim().slice(0, 240),
      recipients: String(item.recipients || '').trim().slice(0, 500),
      subject,
      body_snippet: bodySnippet,
      attachments,
      action_status: item.action_status === 'need_reply' ? 'need_reply' : 'done',
      source_system: String(item.source_system || 'BMAIL').trim().slice(0, 80),
      projectCode: extractProjectCodeHint(`${subject} ${bodySnippet}`),
      ingestedAt: now,
    });
  }

  return normalized;
}

export function buildSgwEmployeeDto(user: User): SgwEmployeeDto {
  return {
    sub: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    position: user.position,
    status: user.statusMessage || (user.online ? 'online' : 'offline'),
    phone: user.phone,
  };
}

export function buildSgwChatRoomDto(
  room: ChatRoom,
  roomMessages: Message[],
  currentUserId: string,
): SgwChatRoomDto {
  const ordered = [...roomMessages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const last = ordered[ordered.length - 1];
  const unreadCount = ordered.filter(
    (m) => m.senderId !== currentUserId && !m.deleted && !m.readBy.includes(currentUserId),
  ).length;

  return {
    id: room.id,
    participants: [...room.memberIds],
    lastMessage: last ? (last.deleted ? '삭제된 메시지입니다.' : last.content.slice(0, 300)) : '',
    lastMessageTime: last
      ? new Date(last.createdAt).getTime()
      : new Date(room.updatedAt || room.createdAt).getTime(),
    lastMessageSenderId: last?.senderId,
    rev: ordered.length,
    unreadCount,
  };
}

export function buildSgwChatMessageDto(msg: Message): SgwChatMessageDto {
  return {
    id: msg.id,
    roomId: msg.roomId,
    senderId: msg.senderId,
    content: msg.viewOnce ? '🔒 1회 열람 비밀 메시지' : msg.content,
    timestamp: new Date(msg.createdAt).getTime(),
    readBy: [...msg.readBy],
    hasFile: Boolean(msg.file),
    ...(msg.file?.filename ? { fileName: msg.file.filename } : {}),
    ...(msg.replyToId ? { replyToId: msg.replyToId } : {}),
    ...(msg.mentions?.length ? { mentions: [...msg.mentions] } : {}),
    ...(Object.keys(msg.reactions ?? {}).length > 0 ? { reactions: msg.reactions } : {}),
    ...(msg.editedAt ? { isEdited: true } : {}),
    ...(msg.deleted ? { isDeleted: true } : {}),
  };
}

export function buildSgwDirectMessageDto(
  msg: Message,
  room: ChatRoom,
  usersById: Record<string, User>,
): SgwDirectMessageDto {
  const receiverId =
    room.memberIds.find((id) => id !== msg.senderId) ?? msg.senderId;
  const senderName = usersById[msg.senderId]?.name ?? '사원';
  const receiverName = usersById[receiverId]?.name ?? '사원';

  return {
    id: msg.id,
    senderId: msg.senderId,
    senderName,
    receiverId,
    receiverName,
    content: msg.viewOnce ? '🔒 1회 열람 비밀 메시지' : msg.content,
    timestamp: new Date(msg.createdAt).getTime(),
    isRead: msg.readBy.includes(receiverId),
    hasFile: Boolean(msg.file),
    ...(msg.file?.filename ? { fileName: msg.file.filename } : {}),
    ...(msg.replyToId ? { replyToId: msg.replyToId } : {}),
    ...(Object.keys(msg.reactions ?? {}).length > 0 ? { reactions: msg.reactions } : {}),
    ...(msg.editedAt ? { isEdited: true } : {}),
    ...(msg.deleted ? { isDeleted: true } : {}),
  };
}

export function mapRemoteBmailItemToMailMessage(
  remote: BmailRemoteMailItem,
  currentUserId: string,
  usersById: Record<string, User>,
): MailMessage {
  const senderId = usersById[remote.senderSub] ? remote.senderSub : currentUserId;
  const attachments: MailAttachmentItem[] = (remote.attachments ?? []).map((a) => ({
    id: a.id,
    filename: a.filename,
    size: Number(a.sizeBytes ?? a.size ?? 0),
    mimeType: a.mimeType || 'application/octet-stream',
    downloadUrl: a.downloadUrl,
  }));
  const isBig = attachments.some((a) => a.size >= 10 * 1024 * 1024);

  return {
    id: remote.id,
    provider: isBig ? 'bigmail' : 'bmail',
    senderId,
    recipientIds: [currentUserId],
    subject: remote.subject || '(제목 없음)',
    body: remote.body || '',
    shortSummary: String(remote.body || remote.subject || '').replace(/\s+/g, ' ').trim().slice(0, 72),
    attachments,
    category: '일반',
    readByUserIds: remote.isRead ? [currentUserId] : [],
    inReplyToMailId: remote.threadId ?? null,
    createdAt: remote.createdAt || new Date().toISOString(),
  };
}

export function buildBmailEmbedLaunchUrl(bmailBaseUrl: string, ssoToken: string): string {
  const cleanOrigin = bmailBaseUrl.trim().replace(/\/+$/, '');
  const qs = new URLSearchParams({
    embed: 'sgw',
    sso_token: ssoToken,
  });
  return `${cleanOrigin}/sgw/mail?${qs.toString()}`;
}
