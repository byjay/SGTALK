import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  Pin,
  PinOff,
  Plus,
  Radio,
  Send,
  Siren,
  Star,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { formatFileSize, formatKoreanTime, isUserOnLeaveOnDate } from '../shared/logic';
import {
  computeNoticeAckStats,
  getNoticePriorityMeta,
  normalizeNoticePriority,
  sortNoticesPinnedFirst,
} from '../shared/noticeAlert';
import { SHARE_PROVIDER_LABELS } from '../shared/voiceAnalysis';
import type {
  ChatRoom,
  InspectorTab,
  LeaveRequest,
  Message,
  Notice,
  SharedFileItem,
  User,
} from '../types/client';
import { Avatar } from './Avatar';

interface RightInspectorPanelProps {
  room: ChatRoom;
  currentUser: User;
  users: User[];
  usersById: Record<string, User>;
  messages?: Message[];
  notices: Notice[];
  files: SharedFileItem[];
  leaves: LeaveRequest[];
  todayDate: string;
  activeTab: InspectorTab;
  onChangeTab: (tab: InspectorTab) => void;
  onClose?: () => void;
  onOpenCreateNotice: () => void;
  onAcknowledgeNotice?: (noticeId: string) => Promise<void> | void;
  onTogglePinNotice?: (noticeId: string) => Promise<void> | void;
  onDeleteNotice?: (noticeId: string) => Promise<void> | void;
  onPushNoticeUrgent?: (noticeId: string) => Promise<void> | void;
  onTogglePinRoom: () => void;
  onToggleMuteRoom: () => void;
  onSetDisappearing?: (seconds: number | null) => Promise<void>;
  onLeaveRoom?: () => void;
  onInviteMembers: (userIds: string[]) => Promise<void>;
  onJumpToMessage?: (messageId: string) => void;
  onToggleStarMessage?: (messageId: string) => Promise<void>;
  onPreviewImage: (file: SharedFileItem) => void;
  onSelectUserProfile: (user: User) => void;
  onSendToSelf?: (messageId: string) => Promise<void> | void;
  onRevokeFile?: (fileId: string) => Promise<void> | void;
  fileToken?: string | null;
}

export function RightInspectorPanel({
  room,
  currentUser,
  users,
  usersById,
  messages = [],
  notices,
  files,
  leaves,
  todayDate,
  activeTab,
  onChangeTab,
  onClose,
  onOpenCreateNotice,
  onAcknowledgeNotice,
  onTogglePinNotice,
  onDeleteNotice,
  onPushNoticeUrgent,
  onTogglePinRoom,
  onToggleMuteRoom,
  onSetDisappearing,
  onLeaveRoom,
  onInviteMembers,
  onJumpToMessage,
  onToggleStarMessage,
  onPreviewImage,
  onSelectUserProfile,
  onSendToSelf,
  onRevokeFile,
  fileToken,
}: RightInspectorPanelProps) {
  const [showInviteBox, setShowInviteBox] = useState(false);
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null);
  const [revokingFileId, setRevokingFileId] = useState<string | null>(null);
  const [busyNoticeId, setBusyNoticeId] = useState<string | null>(null);

  const roomNotices = useMemo(
    () => sortNoticesPinnedFirst(notices.filter((n) => n.roomId === room.id)),
    [notices, room.id],
  );
  const roomFiles = useMemo(
    () => files.filter((f) => f.roomId === room.id),
    [files, room.id],
  );
  const starredMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.roomId === room.id &&
          !m.deleted &&
          (m.starredByUserIds ?? []).includes(currentUser.id),
      ),
    [messages, room.id, currentUser.id],
  );

  const roomMembers = useMemo(
    () =>
      room.memberIds
        .map((id) => usersById[id])
        .filter((u): u is User => Boolean(u && u.role !== 'bot')),
    [room.memberIds, usersById],
  );

  const invitableUsers = useMemo(
    () => users.filter((u) => u.role !== 'bot' && !room.memberIds.includes(u.id)),
    [users, room.memberIds],
  );

  const isPinned = room.pinnedByUserIds.includes(currentUser.id);
  const isMuted = room.mutedByUserIds.includes(currentUser.id);

  const handleInviteSubmit = async () => {
    if (selectedInviteIds.length === 0) return;
    await onInviteMembers(selectedInviteIds);
    setSelectedInviteIds([]);
    setShowInviteBox(false);
  };

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-neutral-900 dark:text-white truncate">
          대화방 정보 · 서랍
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="대화방 서랍 닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="px-3 pt-2.5 pb-2 border-b border-neutral-100 dark:border-neutral-800">
        <div className="grid grid-cols-4 gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
          <button
            type="button"
            onClick={() => onChangeTab('notices')}
            className={`py-1.5 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'notices'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            공지 ({roomNotices.length})
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('starred')}
            className={`py-1.5 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'starred'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            책갈피 ({starredMessages.length})
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('files')}
            className={`py-1.5 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'files'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            파일 ({roomFiles.length})
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('members')}
            className={`py-1.5 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'members'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            멤버 ({roomMembers.length})
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto chat-scroll p-3.5 space-y-3">
        {activeTab === 'notices' && (
          <>
            <button
              type="button"
              onClick={onOpenCreateNotice}
              className="w-full h-9 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>새 공지 등록하기</span>
            </button>

            {roomNotices.length === 0 ? (
              <div className="py-10 text-center text-xs text-neutral-400">
                등록된 공지사항이 없습니다.
              </div>
            ) : (
              <div className="space-y-2.5">
                {roomNotices.map((notice) => {
                  const author = usersById[notice.authorId];
                  const priority = normalizeNoticePriority({
                    priority: notice.priority,
                    isUrgent: notice.isUrgent,
                  });
                  const meta = getNoticePriorityMeta(priority);
                  const isUrgent = priority === 'urgent';
                  const isImportant = priority === 'important';
                  const ackStats = computeNoticeAckStats(notice, room.memberIds, usersById);
                  const iAcked = ackStats.acknowledgedIds.includes(currentUser.id);
                  const canManage =
                    notice.authorId === currentUser.id || currentUser.role === 'admin';
                  const isBusy = busyNoticeId === notice.id;

                  return (
                    <div
                      key={notice.id}
                      className={`p-3 rounded-xl border space-y-2 ${
                        isUrgent
                          ? 'bg-red-50/75 dark:bg-red-950/35 border-red-300 dark:border-red-800'
                          : notice.pinned || isImportant
                            ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60'
                            : 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="flex items-center gap-1.5 font-medium text-neutral-800 dark:text-neutral-200 min-w-0">
                          {isUrgent ? (
                            <Siren className="h-3.5 w-3.5 text-red-600 shrink-0" />
                          ) : isImportant ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          ) : (
                            <Megaphone className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          )}
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                              isUrgent
                                ? 'bg-red-600 text-white'
                                : isImportant
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
                            }`}
                          >
                            {meta.badgeText}
                          </span>
                          <span className="truncate text-[11px]">
                            {notice.pinned ? '상단 고정' : '이전 공지'}
                          </span>
                        </span>
                        <span className="tabular-nums text-[11px] shrink-0">
                          {formatKoreanTime(notice.createdAt)}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                          {notice.title}
                        </h4>
                        <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
                          {notice.content}
                        </p>
                      </div>

                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 space-y-0.5">
                        <div>
                          작성자: {author?.name ?? '사원'} {author?.position ?? ''}
                        </div>
                        <div className="tabular-nums">
                          확인 현황: {ackStats.ackCount}/{ackStats.totalHumanMembers}명
                          {ackStats.acknowledgedNames.length > 0
                            ? ` (${ackStats.acknowledgedNames.slice(0, 4).join(', ')}${
                                ackStats.acknowledgedNames.length > 4
                                  ? ` 외 ${ackStats.acknowledgedNames.length - 4}명`
                                  : ''
                              })`
                            : ''}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-neutral-200/70 dark:border-neutral-700/60">
                        {onAcknowledgeNotice && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyNoticeId(notice.id);
                              try {
                                await onAcknowledgeNotice(notice.id);
                              } finally {
                                setBusyNoticeId(null);
                              }
                            }}
                            className={`h-6 px-2 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                              iAcked
                                ? 'bg-emerald-600/15 text-[#008069] dark:text-[#07C160]'
                                : 'bg-[#008069] hover:bg-[#006B58] text-white'
                            }`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>{iAcked ? '확인 완료됨' : '확인 완료'}</span>
                          </button>
                        )}
                        {onTogglePinNotice && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyNoticeId(notice.id);
                              try {
                                await onTogglePinNotice(notice.id);
                              } finally {
                                setBusyNoticeId(null);
                              }
                            }}
                            className="h-6 px-2 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[10px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 cursor-pointer"
                          >
                            {notice.pinned ? (
                              <PinOff className="h-3 w-3" />
                            ) : (
                              <Pin className="h-3 w-3" />
                            )}
                            <span>{notice.pinned ? '고정 해제' : '상단 고정'}</span>
                          </button>
                        )}
                        {onPushNoticeUrgent && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyNoticeId(notice.id);
                              try {
                                await onPushNoticeUrgent(notice.id);
                              } finally {
                                setBusyNoticeId(null);
                              }
                            }}
                            className="h-6 px-2 rounded-md bg-red-600/10 hover:bg-red-600/20 text-[10px] font-bold text-red-700 dark:text-red-300 flex items-center gap-1 cursor-pointer"
                          >
                            <Radio className="h-3 w-3" />
                            <span>재난문자 전파</span>
                          </button>
                        )}
                        {notice.messageId && onJumpToMessage && (
                          <button
                            type="button"
                            onClick={() => onJumpToMessage(notice.messageId!)}
                            className="h-6 px-2 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[10px] font-semibold text-[#008069] dark:text-[#07C160] cursor-pointer"
                          >
                            원문 이동
                          </button>
                        )}
                        {canManage && onDeleteNotice && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyNoticeId(notice.id);
                              try {
                                await onDeleteNotice(notice.id);
                              } finally {
                                setBusyNoticeId(null);
                              }
                            }}
                            aria-label={`공지 삭제: ${notice.title}`}
                            className="h-6 px-2 rounded-md bg-red-500/10 hover:bg-red-500/20 text-[10px] font-semibold text-red-700 dark:text-red-300 flex items-center gap-0.5 cursor-pointer ml-auto"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>삭제</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'starred' && (
          <>
            {starredMessages.length === 0 ? (
              <div className="py-10 text-center text-xs text-neutral-400 space-y-1">
                <Star className="h-6 w-6 mx-auto text-neutral-300" />
                <p>책갈피한 중요 메시지가 없습니다.</p>
                <p className="text-[11px]">메시지에 마우스를 올려 별표(★)로 보관하세요.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {starredMessages.map((msg) => {
                  const sender = usersById[msg.senderId];
                  return (
                    <div
                      key={msg.id}
                      className="p-3 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-neutral-900 dark:text-white">
                          {sender?.name ?? '사원'} {sender?.position ?? ''}
                        </span>
                        <span className="text-[10px] text-neutral-400 tabular-nums">
                          {formatKoreanTime(msg.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-3">
                        {msg.content}
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        {onJumpToMessage && (
                          <button
                            type="button"
                            onClick={() => onJumpToMessage(msg.id)}
                            className="text-[11px] font-semibold text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                          >
                            대화 위치로 이동
                          </button>
                        )}
                        {onToggleStarMessage && (
                          <button
                            type="button"
                            onClick={() => onToggleStarMessage(msg.id)}
                            className="text-[11px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
                          >
                            해제
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'files' && (
          <>
            {roomFiles.length === 0 ? (
              <div className="py-10 text-center text-xs text-neutral-400">
                이 채팅방에 공유된 파일이나 사진이 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {roomFiles.some((f) => f.isImage) && (
                  <div>
                    <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
                      사진첩
                    </h4>
                    <div className="grid grid-cols-3 gap-1.5">
                      {roomFiles
                        .filter((f) => f.isImage)
                        .map((img) => (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => onPreviewImage(img)}
                            className="aspect-square rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 cursor-pointer hover:opacity-90"
                          >
                            <img
                              src={`${img.url}?inline=1${fileToken ? `&ft=${encodeURIComponent(fileToken)}` : ''}`}
                              alt={img.filename}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
                    파일 목록
                  </h4>
                  <div className="space-y-1.5">
                    {roomFiles.map((file) => {
                      const uploader = usersById[file.uploaderId];
                      const rawShareUrl = file.nasExternalAccessUrl || file.shareUrl || file.url;
                      const absShareUrl =
                        rawShareUrl.startsWith('http')
                          ? rawShareUrl
                          : typeof window !== 'undefined'
                            ? `${window.location.origin}${rawShareUrl}${!file.shareUrl && !file.nasExternalAccessUrl && fileToken ? `?ft=${encodeURIComponent(fileToken)}` : ''}`
                            : rawShareUrl;
                      const downloadHref = file.shareUrl
                        ? file.shareUrl
                        : file.isExternalLink
                          ? file.url
                          : `${file.url}${fileToken ? `?ft=${encodeURIComponent(fileToken)}` : ''}`;
                      const isRevoked = Boolean(file.revoked);
                      const providerLabel = file.shareProvider
                        ? SHARE_PROVIDER_LABELS[file.shareProvider]
                        : undefined;
                      const metaParts: string[] = [formatFileSize(file.size)];
                      if (file.nasFolder) metaParts.push(`NAS: ${file.nasFolder}`);
                      if (providerLabel && !file.nasFolder) metaParts.push(providerLabel);
                      else if ((file.isLargeFile || file.isExternalLink) && !file.nasFolder) metaParts.push('대용량');
                      if (file.hasPasscode) metaParts.push('비밀번호');
                      if (typeof file.downloadCount === 'number' || file.maxDownloads) {
                        metaParts.push(
                          file.maxDownloads
                            ? `${file.downloadCount ?? 0}/${file.maxDownloads}회`
                            : `${file.downloadCount ?? 0}회`,
                        );
                      }
                      metaParts.push(uploader?.name ?? '사원');
                      const canRevoke =
                        !isRevoked &&
                        Boolean(onRevokeFile) &&
                        (file.uploaderId === currentUser.id || currentUser.role === 'admin');
                      return (
                        <div
                          key={file.id}
                          className={`p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-2 ${
                            isRevoked ? 'opacity-70' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onJumpToMessage?.(file.messageId)}
                              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                            >
                              <div className="h-8 w-8 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0">
                                <FileText className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-neutral-900 dark:text-white truncate flex items-center gap-1">
                                  {file.hasPasscode && <Lock className="h-3 w-3 text-amber-600 shrink-0" />}
                                  <span className={`truncate ${isRevoked ? 'line-through' : ''}`}>
                                    {file.filename}
                                  </span>
                                  {isRevoked && (
                                    <span className="text-[10px] font-bold text-red-600 shrink-0">
                                      · 회수됨
                                    </span>
                                  )}
                                </p>
                                <p className="text-[11px] text-neutral-400 tabular-nums truncate">
                                  {metaParts.join(' · ')}
                                </p>
                              </div>
                            </button>
                            {isRevoked ? (
                              <span className="text-[10px] font-semibold text-red-600 shrink-0">
                                중지됨
                              </span>
                            ) : (
                              <a
                                href={downloadHref}
                                target={file.isExternalLink || file.shareUrl ? '_blank' : undefined}
                                rel={file.isExternalLink || file.shareUrl ? 'noopener noreferrer' : undefined}
                                download={file.isExternalLink || file.shareUrl ? undefined : file.filename}
                                aria-label={`${file.filename} 다운로드`}
                                className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-white dark:hover:bg-neutral-700 shrink-0"
                              >
                                <Download className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-neutral-200/70 dark:border-neutral-700/60">
                            {!isRevoked && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(absShareUrl).catch(() => {});
                                  setCopiedFileId(file.id);
                                  window.setTimeout(
                                    () => setCopiedFileId((cur) => (cur === file.id ? null : cur)),
                                    1800,
                                  );
                                }}
                                className="h-6 px-2 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[10px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                {copiedFileId === file.id ? (
                                  <Check className="h-3 w-3 text-[#008069]" />
                                ) : (
                                  <Link2 className="h-3 w-3" />
                                )}
                                <span>{copiedFileId === file.id ? '복사됨' : '링크 복사'}</span>
                              </button>
                            )}
                            <div className="flex items-center gap-1">
                              {!isRevoked && onSendToSelf && room.type !== 'self' && (
                                <button
                                  type="button"
                                  onClick={() => onSendToSelf(file.messageId)}
                                  className="h-6 px-2 rounded-md bg-[#008069]/10 hover:bg-[#008069]/20 text-[10px] font-semibold text-[#008069] dark:text-[#07C160] flex items-center gap-1 whitespace-nowrap cursor-pointer"
                                >
                                  <Send className="h-3 w-3" />
                                  <span>나에게 보내기</span>
                                </button>
                              )}
                              {canRevoke && (
                                <button
                                  type="button"
                                  disabled={revokingFileId === file.id}
                                  onClick={async () => {
                                    if (!onRevokeFile) return;
                                    setRevokingFileId(file.id);
                                    try {
                                      await onRevokeFile(file.id);
                                    } finally {
                                      setRevokingFileId((cur) => (cur === file.id ? null : cur));
                                    }
                                  }}
                                  className="h-6 px-2 rounded-md bg-red-500/10 hover:bg-red-500/20 text-[10px] font-semibold text-red-700 dark:text-red-300 whitespace-nowrap cursor-pointer disabled:opacity-50"
                                >
                                  {revokingFileId === file.id ? '회수 중' : '회수'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'members' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onTogglePinRoom}
                className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              >
                {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                <span>{isPinned ? '고정 해제' : '상단 고정'}</span>
              </button>
              <button
                type="button"
                onClick={onToggleMuteRoom}
                className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              >
                {isMuted ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                <span>{isMuted ? '알림 켜기' : '알림 끄기'}</span>
              </button>
            </div>

            {onSetDisappearing && (
              <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#008069] dark:text-[#07C160]" />
                    <span>사라지는 메시지 (임시 메시지)</span>
                  </span>
                  <span className="text-[11px] text-[#008069] dark:text-[#07C160] font-bold">
                    {room.disappearingSeconds === 86400
                      ? '24시간'
                      : room.disappearingSeconds === 604800
                        ? '7일'
                        : '끔'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-700">
                  {(
                    [
                      { value: null, label: '끔' },
                      { value: 86400, label: '24시간' },
                      { value: 604800, label: '7일' },
                    ] as const
                  ).map((opt) => {
                    const active = (room.disappearingSeconds ?? null) === opt.value;
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => onSetDisappearing(opt.value)}
                        className={`py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#008069] text-white'
                            : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {room.type !== 'company' && room.type !== 'bot' && invitableUsers.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowInviteBox((v) => !v)}
                  className="w-full h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>대화상대 초대하기</span>
                </button>

                {showInviteBox && (
                  <div className="mt-2 p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 space-y-2">
                    <div className="max-h-36 overflow-y-auto space-y-1">
                      {invitableUsers.map((u) => {
                        const checked = selectedInviteIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedInviteIds((prev) =>
                                  checked ? prev.filter((id) => id !== u.id) : [...prev, u.id],
                                )
                              }
                            />
                            <span>
                              {u.name} {u.position} · {u.department}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={handleInviteSubmit}
                      disabled={selectedInviteIds.length === 0}
                      className="w-full h-8 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      선택한 동료 초대 ({selectedInviteIds.length})
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5">
                <Users className="h-3.5 w-3.5" />
                <span>참여 멤버 ({roomMembers.length}명)</span>
              </div>
              {roomMembers.map((member) => {
                const leaveToday = isUserOnLeaveOnDate(leaves, member.id, todayDate);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => onSelectUserProfile(member)}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar user={member} size="sm" showOnline onLeave={Boolean(leaveToday)} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                          {member.name} {member.position}
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                          {member.department}
                          {leaveToday ? ` · ${leaveToday.type}` : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {room.type === 'group' && onLeaveRoom && (
              <button
                type="button"
                onClick={onLeaveRoom}
                className="w-full h-9 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>그룹 채팅방 나가기</span>
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
