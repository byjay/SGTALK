import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  Bot,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Forward,
  History,
  Layers,
  Mail,
  Megaphone,
  Menu,
  NotebookPen,
  Search,
  Siren,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  buildMailDraftFromMessagesPure,
  buildTranscriptText,
  filterRoomMessages,
  findFirstUnreadMessageId,
  SEDMS_MENU_CATALOG,
  type ChatSearchFilter,
  type InChatMailDraft,
} from '../shared/chatLogic';
import {
  formatKoreanTime,
  getRoomDisplayName,
  groupMessagesByDateAndSender,
} from '../shared/logic';
import { buildRoomTranscriptExportText } from '../shared/nasShare';
import {
  computeNoticeAckStats,
  getNoticePriorityMeta,
  normalizeNoticePriority,
} from '../shared/noticeAlert';
import type {
  ChatRoom,
  IntegrationActionSummary,
  LeaveRequest,
  LeaveType,
  MailMessage,
  Message,
  Notice,
  NotificationItem,
  PollData,
  ScheduleCardData,
  ScheduledMessageItem,
  ShareProvider,
  SharedFileItem,
  User,
  VoiceAttachment,
} from '../types/client';
import { ChatComposer } from './chat/ChatComposer';
import { ChatMessageItem } from './chat/ChatMessageItem';
import { EgoAgentPanel } from './chat/EgoAgentPanel';

interface ChatRoomViewProps {
  room: ChatRoom;
  currentUser: User;
  users: User[];
  usersById: Record<string, User>;
  messages: Message[];
  leaves?: LeaveRequest[];
  mails?: MailMessage[];
  notices?: Notice[];
  notifications?: NotificationItem[];
  activeNotice: Notice | null;
  typingUserIds: string[];
  todayDate: string;
  draftText?: string;
  draftSavedAt?: number | null;
  fileToken?: string | null;
  jumpToMessageRequest?: { messageId: string; nonce: number } | null;
  showBackButton?: boolean;
  showInspectorToggle?: boolean;
  onBack?: () => void;
  onToggleInspector?: () => void;
  onDraftChange?: (text: string) => void;
  onSendMessage: (payload: {
    type: Message['type'];
    content: string;
    replyToId?: string | null;
    emoticonId?: string;
    poll?: PollData;
    scheduleCard?: Omit<ScheduleCardData, 'attendeesYes' | 'attendeesMaybe' | 'attendeesNo'>;
    voice?: VoiceAttachment;
    viewOnce?: boolean;
  }) => Promise<void>;
  onRegisterLeaveFromChat: (input: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId: string | null;
    reason: string;
  }) => Promise<{ ok: boolean; error?: string; notificationsCount?: number }>;
  onTriggerIntegration?: (
    summary: IntegrationActionSummary,
    options?: { recordInChat?: boolean },
  ) => Promise<void> | void;
  onUploadFile: (file: File, caption?: string) => Promise<void>;
  onMarkRead: () => void;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onEditMessage: (messageId: string, content: string) => Promise<void>;
  onRecallMessage: (messageId: string) => Promise<void>;
  onToggleStarMessage: (messageId: string) => Promise<void>;
  onOpenForwardModal: (messageIds: string[]) => void;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onVotePoll: (messageId: string, optionId: string) => Promise<void>;
  onScheduleRsvp?: (messageId: string, choice: 'yes' | 'maybe' | 'no') => Promise<void> | void;
  onOpenNoticeModal: (
    initialContent?: string,
    messageId?: string,
    options?: { urgent?: boolean; initialTitle?: string },
  ) => void;
  onAcknowledgeNotice?: (noticeId: string) => Promise<void> | void;
  onOpenNoticesDrawer?: () => void;
  roomNoticesCount?: number;
  onOpenPollModal: () => void;
  onGoToLeaveTab: () => void;
  onGoToMailTab: () => void;
  onStartDirectChat: (userId: string) => void;
  onPreviewImage: (file: SharedFileItem) => void;
  onTypingChange: (isTyping: boolean) => void;
  onSelectUserProfile: (user: User) => void;
  apiFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  onEgoSelfMessage?: (message: Message) => void;
  scheduledMessages?: ScheduledMessageItem[];
  onScheduleMessage?: (content: string, scheduledAt: string) => Promise<void>;
  onCancelScheduledMessage?: (id: string) => Promise<void>;
  onShareLargeLink?: (input: {
    filename: string;
    externalUrl: string;
    sizeValue: number;
    sizeUnit: 'MB' | 'GB' | 'TB';
    expiresDays: number;
    shareProvider: ShareProvider;
    passcode?: string;
    maxDownloads?: number;
    caption?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onShareNasFile?: (input: {
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
  }) => Promise<{ ok: boolean; error?: string }>;
  onRunRandomDraw?: (topic: string, candidatesText: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenMail?: (mailId: string) => void;
  onMailSent?: (mail: MailMessage, uploadedFile?: SharedFileItem) => void;
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onOpenRoom?: (roomId: string) => void;
  onAnalyzeVoice?: (msg: Message) => Promise<void>;
  onTranslateOrSummarize?: (
    messageId: string,
    mode: 'translate' | 'summary',
  ) => Promise<{ resultText?: string; error?: string }>;
  onForwardToSelf?: (messageId: string) => Promise<void> | void;
  onRevokeFile?: (fileId: string) => Promise<void> | void;
  onOpenViewOnce?: (
    messageId: string,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  onSetDisappearing?: (disappearingSeconds: number | null) => Promise<void> | void;
  roomFiles?: SharedFileItem[];
  bmailBridgeStatus?: { bmailBaseUrlConfigured: boolean; embedSupported: boolean } | null;
  onSyncRemoteBmail?: () => Promise<{ ok: boolean; importedCount?: number; error?: string }>;
  onLaunchBmailSso?: () => Promise<{ ok: boolean; launchUrl?: string; error?: string }>;
  externalLargeLinkNonce?: number;
  chunkUploadProgress?: {
    filename: string;
    percent: number;
    chunkIndex: number;
    totalChunks: number;
  } | null;
}

const SEARCH_FILTERS: { id: ChatSearchFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'files', label: '파일·사진' },
  { id: 'links', label: '링크' },
  { id: 'starred', label: '책갈피' },
  { id: 'notices', label: '공지·투표' },
];

export function ChatRoomView({
  room,
  currentUser,
  users,
  usersById,
  messages,
  leaves = [],
  mails = [],
  notices = [],
  notifications = [],
  activeNotice,
  typingUserIds,
  todayDate,
  draftText = '',
  draftSavedAt = null,
  fileToken = null,
  jumpToMessageRequest,
  showBackButton = false,
  showInspectorToggle = true,
  onBack,
  onToggleInspector,
  onDraftChange,
  onSendMessage,
  onRegisterLeaveFromChat,
  onTriggerIntegration,
  onUploadFile,
  onMarkRead,
  onToggleReaction,
  onEditMessage,
  onRecallMessage,
  onToggleStarMessage,
  onOpenForwardModal,
  onDeleteMessage,
  onVotePoll,
  onScheduleRsvp,
  onOpenNoticeModal,
  onAcknowledgeNotice,
  onOpenNoticesDrawer,
  roomNoticesCount = 0,
  onOpenPollModal,
  onGoToLeaveTab,
  onGoToMailTab,
  onStartDirectChat,
  onPreviewImage,
  onTypingChange,
  onSelectUserProfile,
  apiFetch,
  onEgoSelfMessage,
  scheduledMessages = [],
  onScheduleMessage,
  onCancelScheduledMessage,
  onShareLargeLink,
  onShareNasFile,
  onRunRandomDraw,
  onOpenMail,
  onMailSent,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenRoom,
  onAnalyzeVoice,
  onTranslateOrSummarize,
  onForwardToSelf,
  onRevokeFile,
  onOpenViewOnce,
  onSetDisappearing,
  roomFiles = [],
  bmailBridgeStatus = null,
  onSyncRemoteBmail,
  onLaunchBmailSso,
  externalLargeLinkNonce = 0,
  chunkUploadProgress = null,
}: ChatRoomViewProps) {
  const [localDraft, setLocalDraft] = useState(draftText);
  const effectiveDraft = onDraftChange ? draftText : localDraft;
  const setEffectiveDraft = onDraftChange ?? setLocalDraft;
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const [noticeHidden, setNoticeHidden] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<ChatSearchFilter>('all');
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);

  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [readReceiptMsgId, setReadReceiptMsgId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [exportedTranscript, setExportedTranscript] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [leaveTriggerCount, setLeaveTriggerCount] = useState(0);
  const [leaveLookupTriggerCount, setLeaveLookupTriggerCount] = useState(0);
  const [showSedmsMenuDrawer, setShowSedmsMenuDrawer] = useState(false);
  const [showEgoPanel, setShowEgoPanel] = useState(true);

  // Multi-select mode & quick bmail draft trigger
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [composerMailDraft, setComposerMailDraft] = useState<{
    draft: InChatMailDraft | null;
    nonce: number;
  }>({ draft: null, nonce: 0 });

  // Unread divider captured on room entry + scroll-to-bottom floating button
  const [unreadDividerMsgId, setUnreadDividerMsgId] = useState<string | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const colleagues = useMemo(
    () => users.filter((u) => u.id !== currentUser.id && u.role !== 'bot'),
    [users, currentUser.id],
  );

  const roomMembers = useMemo(
    () =>
      room.memberIds
        .map((id) => usersById[id])
        .filter((u): u is User => Boolean(u)),
    [room.memberIds, usersById],
  );

  const roomMessages = useMemo(
    () => messages.filter((m) => m.roomId === room.id),
    [messages, room.id],
  );

  const messageById = useMemo(() => {
    const map: Record<string, Message> = {};
    for (const m of roomMessages) map[m.id] = m;
    return map;
  }, [roomMessages]);

  const decoratedMessages = useMemo(
    () => groupMessagesByDateAndSender(roomMessages),
    [roomMessages],
  );

  const matchingMessageIds = useMemo(() => {
    if (!showSearch) return [];
    if (!searchQuery.trim() && searchFilter === 'all') return [];
    return filterRoomMessages(
      decoratedMessages.map((d) => d.message),
      {
        query: searchQuery,
        filter: searchFilter,
        currentUserId: currentUser.id,
        usersById,
      },
    );
  }, [showSearch, searchQuery, searchFilter, decoratedMessages, currentUser.id, usersById]);

  const displayName = getRoomDisplayName(room, currentUser.id, usersById);
  const humanCount = room.memberIds.filter((id) => usersById[id]?.role !== 'bot').length;

  const jumpToMessage = (messageId: string) => {
    const el = messageRefs.current[messageId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMsgId(messageId);
      window.setTimeout(() => {
        setHighlightedMsgId((cur) => (cur === messageId ? null : cur));
      }, 2200);
    }
  };

  // Capture unread divider when switching rooms, then mark room read
  useEffect(() => {
    setNoticeHidden(false);
    setReplyTo(null);
    setReactionPickerMsgId(null);
    setReadReceiptMsgId(null);
    setSelectionMode(false);
    setSelectedIds([]);
    setSearchMatchIdx(0);

    const sorted = decoratedMessages.map((d) => d.message);
    const firstUnread = findFirstUnreadMessageId(sorted, currentUser.id);
    setUnreadDividerMsgId(firstUnread);
    onMarkRead();

    window.requestAnimationFrame(() => {
      if (firstUnread && messageRefs.current[firstUnread]) {
        messageRefs.current[firstUnread]?.scrollIntoView({ behavior: 'auto', block: 'center' });
      } else {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    });
  }, [room.id]);

  // Restore notice banner when a new or updated activeNotice appears
  useEffect(() => {
    if (!activeNotice?.id) return;
    setNoticeHidden(false);
    if (activeNotice.isUrgent || activeNotice.priority === 'urgent') {
      setNoticeExpanded(true);
    }
  }, [activeNotice?.id, activeNotice?.isUrgent, activeNotice?.priority]);

  // Keep marking new messages read while viewing active room
  useEffect(() => {
    onMarkRead();
    if (!showScrollBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [roomMessages.length]);

  useEffect(() => {
    if (jumpToMessageRequest?.messageId) {
      jumpToMessage(jumpToMessageRequest.messageId);
    }
  }, [jumpToMessageRequest?.nonce]);

  useEffect(() => {
    if (matchingMessageIds.length > 0) {
      const clampedIdx = Math.min(searchMatchIdx, matchingMessageIds.length - 1);
      if (clampedIdx !== searchMatchIdx) setSearchMatchIdx(clampedIdx);
    } else {
      setSearchMatchIdx(0);
    }
  }, [matchingMessageIds.length]);

  const stepSearchResult = (delta: number) => {
    if (matchingMessageIds.length === 0) return;
    const nextIdx =
      (searchMatchIdx + delta + matchingMessageIds.length) % matchingMessageIds.length;
    setSearchMatchIdx(nextIdx);
    jumpToMessage(matchingMessageIds[nextIdx]);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    for (const f of dropped) {
      await onUploadFile(f);
    }
  };

  const handleCopy = (msg: Message) => {
    navigator.clipboard?.writeText(msg.content).catch(() => {});
    setCopiedId(msg.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCopySelectedTranscript = () => {
    const picked = roomMessages.filter((m) => selectedIds.includes(m.id));
    if (picked.length === 0) return;
    const text = buildTranscriptText(picked, usersById);
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedTranscript(true);
    window.setTimeout(() => setCopiedTranscript(false), 1600);
  };

  const handleExportTranscript = () => {
    const text = buildRoomTranscriptExportText(displayName, roomMessages, usersById);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SGW_${displayName.replace(/[^\w.\-가-힣]/g, '_')}_${todayDate}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportedTranscript(true);
    window.setTimeout(() => setExportedTranscript(false), 1800);
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const activeTypingNames = typingUserIds
    .filter((id) => id !== currentUser.id && room.memberIds.includes(id))
    .map((id) => usersById[id]?.name)
    .filter(Boolean);

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-[#E5EEE8] dark:bg-[#0B141A]"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drag & Drop File Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-[#07C160]/15 dark:bg-neutral-900/90 backdrop-blur-xs flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[#008069] dark:border-[#07C160] m-3 rounded-2xl pointer-events-none">
          <Upload className="h-10 w-10 text-[#008069] dark:text-[#07C160]" />
          <p className="text-base font-bold text-[#008069] dark:text-[#07C160]">
            여기에 파일을 놓으면 채팅방에 바로 전송됩니다
          </p>
        </div>
      )}

      {/* Chat Room Top Bar */}
      <div className="shrink-0 px-4 py-2.5 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xs border-b border-black/10 dark:border-neutral-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              aria-label="채팅 목록으로 돌아가기"
              className="h-9 w-9 rounded-xl flex items-center justify-center text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-bold text-neutral-900 dark:text-white truncate">
                {displayName}
              </h2>
              {room.type === 'self' ? (
                <span className="px-1.5 py-0.5 rounded bg-[#FEE500] text-[#1C2924] text-[10px] font-bold shrink-0">
                  나
                </span>
              ) : room.type !== 'direct' ? (
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0">
                  {humanCount}
                </span>
              ) : null}
              {room.disappearingSeconds ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#07C160]/15 text-[#075E54] dark:text-[#07C160] text-[10px] font-semibold shrink-0">
                  <Clock className="h-3 w-3" />
                  <span>
                    {room.disappearingSeconds === 300
                      ? '5분'
                      : room.disappearingSeconds === 3600
                        ? '1시간'
                        : room.disappearingSeconds === 86400
                          ? '24시간'
                          : '7일'}
                  </span>
                </span>
              ) : null}
            </div>
            {room.description && (
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                {room.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onSetDisappearing && (
            <label className="hidden md:flex items-center gap-1 h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 shrink-0">
              <Clock className="h-3.5 w-3.5 text-[#008069] dark:text-[#07C160] shrink-0" />
              <select
                aria-label="사라지는 메시지 타이머"
                value={room.disappearingSeconds ? String(room.disappearingSeconds) : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onSetDisappearing(val ? Number(val) : null);
                }}
                className="bg-transparent text-[11px] font-semibold focus:outline-none cursor-pointer"
              >
                <option value="">사라짐 꺼짐</option>
                <option value="300">5분 후 사라짐</option>
                <option value="3600">1시간 후 사라짐</option>
                <option value="86400">24시간 후 사라짐</option>
                <option value="604800">7일 후 사라짐</option>
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setLeaveTriggerCount((c) => c + 1)}
            className="hidden sm:flex h-8 px-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-800 dark:text-amber-300 items-center gap-1 hover:bg-amber-100 transition-colors whitespace-nowrap cursor-pointer"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            <span>대화로 연차등록</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectionMode((v) => !v);
              setSelectedIds([]);
            }}
            aria-label="메시지 다중 선택"
            title="메시지 선택·전달·복사"
            className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              selectionMode
                ? 'bg-[#008069] text-white'
                : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            <CheckSquare className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            aria-label="대화 내용 검색"
            title="대화 내용 검색 및 필터"
            className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showSearch
                ? 'bg-[#008069] text-white'
                : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleExportTranscript}
            aria-label="대화 내용 텍스트 내보내기"
            title="대화 내용 .txt 저장"
            className={`h-9 px-2 rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer ${
              exportedTranscript
                ? 'bg-[#008069] text-white'
                : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            {exportedTranscript ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            <span className="hidden xl:inline text-[11px] font-medium whitespace-nowrap">
              {exportedTranscript ? '저장됨' : '대화 저장'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onOpenNoticeModal()}
            aria-label="공지 등록"
            title="공지 등록"
            className="h-9 w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <Megaphone className="h-4 w-4" />
          </button>

          {showInspectorToggle && (
            <button
              type="button"
              onClick={onToggleInspector}
              aria-label="채팅방 서랍 열기"
              title="공지 · 책갈피 · 파일 · 멤버 서랍"
              className="h-9 w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Self Chat SEDMS x SGW Deep Integration Hub Bar */}
      {room.type === 'self' && (
        <div className="shrink-0 bg-white/90 dark:bg-neutral-900/90 border-b border-black/10 dark:border-neutral-800 px-3 sm:px-4 py-2 space-y-2">
          <div className="flex items-center gap-1.5 overflow-x-auto chat-scroll">
            <button
              type="button"
              onClick={() => setShowEgoPanel((v) => !v)}
              aria-expanded={showEgoPanel}
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0 transition-colors ${
                showEgoPanel
                  ? 'bg-[#075E54] border-[#075E54] text-[#FEE500]'
                  : 'bg-[#FEE500]/80 border-[#FEE500] text-[#1C2924]'
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>EGO 자율 AI</span>
            </button>
            <button
              type="button"
              onClick={() => setLeaveTriggerCount((c) => c + 1)}
              className="h-7 px-2.5 rounded-lg bg-amber-100/90 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              <span>연차등록</span>
            </button>
            <button
              type="button"
              onClick={() => setLeaveLookupTriggerCount((c) => c + 1)}
              className="h-7 px-2.5 rounded-lg bg-emerald-100/80 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-[#075E54] dark:text-[#07C160] flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0"
            >
              <History className="h-3.5 w-3.5" />
              <span>내 연차·기록</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onTriggerIntegration?.({
                  system: 'SGW',
                  menuKey: 'project-calendar',
                  title: 'SGW 프로젝트 달력 열기',
                  description: '프로젝트 일정 및 마일스톤을 SGW 프로젝트 달력과 연동합니다.',
                  actionLabel: '프로젝트 달력 열기',
                  payload: { action: 'view' },
                })
              }
              className="h-7 px-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>프로젝트 달력</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onTriggerIntegration?.({
                  system: 'SGW',
                  menuKey: 'meeting-memo',
                  title: 'SGW 미팅메모 열기',
                  description: '대화/음성 메모를 SGW 미팅메모(회의록)와 연동합니다.',
                  actionLabel: 'SGW 미팅메모 열기',
                  payload: { action: 'view' },
                })
              }
              className="h-7 px-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-[11px] font-semibold text-teal-800 dark:text-teal-200 flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0"
            >
              <NotebookPen className="h-3.5 w-3.5" />
              <span>SGW 미팅메모</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onTriggerIntegration?.({
                  system: 'SGW',
                  menuKey: 'meeting',
                  title: 'SGW 회의 바로 시작',
                  description: 'SGW 실시간 회의실과 즉시 연동합니다.',
                  actionLabel: '회의 바로 시작',
                  payload: { action: 'start' },
                })
              }
              className="h-7 px-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-[11px] font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0"
            >
              <Video className="h-3.5 w-3.5" />
              <span>회의 바로 연동</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSedmsMenuDrawer((v) => !v)}
              aria-expanded={showSedmsMenuDrawer}
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer shrink-0 ${
                showSedmsMenuDrawer
                  ? 'bg-[#008069] border-[#008069] text-white'
                  : 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>SEDMS 전체메뉴</span>
              {showSedmsMenuDrawer ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          </div>

          {showSedmsMenuDrawer && (
            <div
              aria-label="SEDMS 전체 연동 메뉴"
              className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1"
            >
              {SEDMS_MENU_CATALOG.map((item) => (
                <button
                  key={item.menuKey}
                  type="button"
                  onClick={() => {
                    setShowSedmsMenuDrawer(false);
                    if (item.menuKey === 'leave') {
                      setLeaveTriggerCount((c) => c + 1);
                    } else if (item.menuKey === 'bmail') {
                      onTriggerIntegration?.({
                        system: item.system,
                        menuKey: item.menuKey,
                        title: item.label,
                        description: item.description,
                        actionLabel: item.actionLabel,
                      });
                    } else {
                      onTriggerIntegration?.({
                        system: item.system,
                        menuKey: item.menuKey,
                        title: item.label,
                        description: item.description,
                        actionLabel: item.actionLabel,
                        payload: { action: 'view' },
                      });
                    }
                  }}
                  className="p-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-800/60 hover:bg-[#07C160]/10 hover:border-[#008069]/40 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-neutral-900 dark:text-white truncate">
                      {item.shortLabel}
                    </span>
                    <span className="text-[9px] font-mono text-[#008069] dark:text-[#07C160]">
                      {item.slashCommand}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                    {item.system} · {item.description}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {room.type === 'self' && showEgoPanel && (
        <EgoAgentPanel
          apiFetch={apiFetch ?? ((url, init) => fetch(url, init))}
          onTriggerIntegration={onTriggerIntegration}
          onEgoSelfMessage={onEgoSelfMessage}
          onClose={() => setShowEgoPanel(false)}
        />
      )}

      {/* Multi-Select Action Bar */}
      {selectionMode && (
        <div className="shrink-0 px-4 py-2 bg-[#075E54] text-white flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold tabular-nums">
            {selectedIds.length}개 메시지 선택됨
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleCopySelectedTranscript}
              className="h-7 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-40 flex items-center gap-1 font-medium cursor-pointer"
            >
              {copiedTranscript ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedTranscript ? '복사됨' : '대화 복사'}</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                const picked = roomMessages.filter((m) => selectedIds.includes(m.id));
                if (picked.length === 0) return;
                const draft = buildMailDraftFromMessagesPure(displayName, picked, usersById);
                setComposerMailDraft({ draft, nonce: Date.now() });
                setSelectionMode(false);
                setSelectedIds([]);
              }}
              className="h-7 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 flex items-center gap-1 font-bold cursor-pointer"
            >
              <Mail className="h-3.5 w-3.5" />
              <span>선택 bmail 발송</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => onOpenForwardModal(selectedIds)}
              className="h-7 px-2.5 rounded-lg bg-[#07C160] hover:bg-[#06ad56] disabled:opacity-40 flex items-center gap-1 font-bold cursor-pointer"
            >
              <Forward className="h-3.5 w-3.5" />
              <span>선택 전달</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectionMode(false);
                setSelectedIds([]);
              }}
              aria-label="선택 모드 종료"
              className="h-7 px-2 rounded-lg hover:bg-white/15 cursor-pointer"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Enhanced In-Room Search & Type Filter Bar */}
      {showSearch && (
        <div className="shrink-0 px-4 py-2.5 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-neutral-400 shrink-0" />
            <input
              type="search"
              autoFocus
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matchingMessageIds.length > 0) {
                  e.preventDefault();
                  stepSearchResult(e.shiftKey ? -1 : 1);
                }
              }}
              placeholder="메시지 내용, 보낸사람, 파일명 검색..."
              aria-label="방 내 메시지 검색"
              className="flex-1 text-sm bg-transparent text-neutral-900 dark:text-white focus:outline-none"
            />
            {matchingMessageIds.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold text-[#008069] dark:text-[#07C160] tabular-nums px-1">
                  {searchMatchIdx + 1} / {matchingMessageIds.length}
                </span>
                <button
                  type="button"
                  onClick={() => stepSearchResult(-1)}
                  aria-label="이전 검색 결과"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => stepSearchResult(1)}
                  aria-label="다음 검색 결과"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            )}
            {(searchQuery || searchFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchFilter('all');
                }}
                aria-label="검색 초기화"
                className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer shrink-0"
              >
                초기화
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {SEARCH_FILTERS.map((sf) => (
              <button
                key={sf.id}
                type="button"
                onClick={() => {
                  setSearchFilter(sf.id);
                  setSearchMatchIdx(0);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  searchFilter === sf.id
                    ? 'bg-[#008069] text-white font-semibold'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                {sf.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Pinned Notice Banner */}
      {activeNotice && noticeHidden && (
        <div className="shrink-0 mx-3 mt-2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white/85 dark:bg-neutral-800/85 border border-black/5 dark:border-neutral-700 text-[11px]">
          <button
            type="button"
            onClick={() => setNoticeHidden(false)}
            className="flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-200 hover:underline min-w-0 truncate cursor-pointer"
          >
            <Megaphone className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span className="truncate">접어둔 공지 다시 열기: {activeNotice.title}</span>
          </button>
          {onOpenNoticesDrawer && (
            <button
              type="button"
              onClick={onOpenNoticesDrawer}
              className="text-[11px] font-semibold text-[#008069] dark:text-[#07C160] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              전체 공지 ({Math.max(1, roomNoticesCount)})
            </button>
          )}
        </div>
      )}

      {activeNotice && !noticeHidden && (() => {
        const noticePriority = normalizeNoticePriority({
          priority: activeNotice.priority,
          isUrgent: activeNotice.isUrgent,
        });
        const priorityMeta = getNoticePriorityMeta(noticePriority);
        const isUrgentNotice = noticePriority === 'urgent';
        const isImportantNotice = noticePriority === 'important';
        const ackStats = computeNoticeAckStats(activeNotice, room.memberIds, usersById);
        const iAcknowledged = ackStats.acknowledgedIds.includes(currentUser.id);
        return (
          <div
            className={`shrink-0 mx-3 mt-2.5 rounded-xl shadow-xs overflow-hidden border ${
              isUrgentNotice
                ? 'bg-red-50/95 dark:bg-red-950/60 border-red-300 dark:border-red-700'
                : isImportantNotice
                  ? 'bg-amber-50/95 dark:bg-amber-950/45 border-amber-300 dark:border-amber-700'
                  : 'bg-white/95 dark:bg-neutral-800/95 border-black/5 dark:border-neutral-700'
            }`}
          >
            <div className="px-3.5 py-2.5 flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => setNoticeExpanded((v) => !v)}
                className="flex items-start gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
              >
                {isUrgentNotice ? (
                  <Siren className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0 animate-pulse" />
                ) : isImportantNotice ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                ) : (
                  <Megaphone className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold shrink-0 ${
                        isUrgentNotice
                          ? 'bg-red-600 text-white'
                          : isImportantNotice
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-600/15 text-[#075E54] dark:text-[#07C160]'
                      }`}
                    >
                      {priorityMeta.badgeText}
                    </span>
                    <span className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                      {activeNotice.title}
                    </span>
                    <span className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0">
                      확인 {ackStats.ackCount}/{ackStats.totalHumanMembers}명
                    </span>
                  </div>
                  <p
                    className={`text-xs text-neutral-700 dark:text-neutral-200 mt-0.5 ${
                      noticeExpanded ? 'whitespace-pre-wrap' : 'truncate'
                    }`}
                  >
                    {activeNotice.content}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {onAcknowledgeNotice && (
                  <button
                    type="button"
                    onClick={() => onAcknowledgeNotice(activeNotice.id)}
                    className={`h-7 px-2 rounded-lg text-[11px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
                      iAcknowledged
                        ? 'bg-emerald-600/15 text-[#008069] dark:text-[#07C160]'
                        : isUrgentNotice
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-[#008069] hover:bg-[#006B58] text-white'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{iAcknowledged ? '확인 완료' : '공지 확인'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNoticeExpanded((v) => !v)}
                  aria-label={noticeExpanded ? '공지 접기' : '공지 펼치기'}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                >
                  {noticeExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setNoticeHidden(true)}
                  aria-label="공지 배너 접어두기"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {noticeExpanded && (
              <div className="px-3.5 py-2 bg-neutral-50/90 dark:bg-neutral-900/60 border-t border-neutral-200/70 dark:border-neutral-700 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
                <span>
                  작성자: {usersById[activeNotice.authorId]?.name ?? '사원'} ·{' '}
                  {formatKoreanTime(activeNotice.createdAt)} · 확인 ({ackStats.ackCount}/
                  {ackStats.totalHumanMembers}명)
                </span>
                <div className="flex items-center gap-3">
                  {activeNotice.messageId && (
                    <button
                      type="button"
                      onClick={() => jumpToMessage(activeNotice.messageId!)}
                      className="font-semibold text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                    >
                      원문 이동
                    </button>
                  )}
                  {onOpenNoticesDrawer && (
                    <button
                      type="button"
                      onClick={onOpenNoticesDrawer}
                      className="font-semibold text-neutral-700 dark:text-neutral-200 hover:underline cursor-pointer"
                    >
                      전체 공지 ({Math.max(1, roomNoticesCount)})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenNoticeModal()}
                    className="font-semibold text-neutral-700 dark:text-neutral-200 hover:underline cursor-pointer"
                  >
                    새 공지 등록
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Message Feed + Floating Scroll Button Wrapper */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <div
          ref={feedRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowScrollBottom(distFromBottom > 180);
          }}
          className="flex-1 overflow-y-auto chat-scroll px-3 sm:px-4 pt-8 pb-3 space-y-1.5"
        >
          {decoratedMessages.map(({ message: msg, dateHeader, showSenderHeader, showTimestamp }) => {
            const isMatched =
              highlightedMsgId === msg.id || matchingMessageIds.includes(msg.id);
            const showUnreadDivider = unreadDividerMsgId === msg.id;

            return (
              <div
                key={msg.id}
                ref={(el) => {
                  messageRefs.current[msg.id] = el;
                }}
              >
                {dateHeader && (
                  <div className="my-3 flex justify-center">
                    <span className="px-3 py-1 rounded-full bg-black/15 dark:bg-white/10 text-white dark:text-neutral-200 text-[11px] font-medium">
                      {dateHeader}
                    </span>
                  </div>
                )}

                {showUnreadDivider && (
                  <div className="my-3 flex items-center gap-2">
                    <div className="flex-1 h-px bg-[#008069]/30 dark:bg-[#07C160]/40" />
                    <span className="px-3 py-0.5 rounded-full bg-[#008069] text-white text-[11px] font-semibold">
                      여기까지 읽었습니다
                    </span>
                    <div className="flex-1 h-px bg-[#008069]/30 dark:bg-[#07C160]/40" />
                  </div>
                )}

                <ChatMessageItem
                  message={msg}
                  room={room}
                  roomMembers={roomMembers}
                  currentUser={currentUser}
                  usersById={usersById}
                  replyTarget={msg.replyToId ? messageById[msg.replyToId] ?? null : null}
                  showSenderHeader={showSenderHeader}
                  showTimestamp={showTimestamp}
                  isHighlighted={isMatched}
                  searchQuery={showSearch ? searchQuery : ''}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.includes(msg.id)}
                  reactionPickerOpen={reactionPickerMsgId === msg.id}
                  readReceiptOpen={readReceiptMsgId === msg.id}
                  copied={copiedId === msg.id}
                  onToggleSelect={toggleSelectId}
                  onToggleReactionPicker={(id) =>
                    setReactionPickerMsgId((cur) => (cur === id ? null : id))
                  }
                  onToggleReadReceipt={(id) =>
                    setReadReceiptMsgId((cur) => (cur === id ? null : id))
                  }
                  onReply={(m) => setReplyTo(m)}
                  onToggleStar={onToggleStarMessage}
                  onForward={(id) => onOpenForwardModal([id])}
                  onStartSelection={(id) => {
                    setSelectionMode(true);
                    setSelectedIds([id]);
                  }}
                  onEditMessage={onEditMessage}
                  onRecallMessage={onRecallMessage}
                  onReeditRecalled={(originalText) => {
                    setEffectiveDraft(originalText);
                    setComposerFocusNonce((n) => n + 1);
                  }}
                  onDeleteMessage={onDeleteMessage}
                  onToggleReaction={onToggleReaction}
                  onVotePoll={onVotePoll}
                  onScheduleRsvp={onScheduleRsvp}
                  onOpenNoticeModal={onOpenNoticeModal}
                  onCopy={handleCopy}
                  onJumpToMessage={jumpToMessage}
                  onGoToMailTab={onGoToMailTab}
                  onOpenMail={onOpenMail}
                  onStartDirectChat={onStartDirectChat}
                  onPreviewImage={onPreviewImage}
                  onSelectUserProfile={onSelectUserProfile}
                  fileToken={fileToken}
                  onTriggerIntegration={onTriggerIntegration}
                  onAnalyzeVoice={onAnalyzeVoice}
                  onTranslateOrSummarize={onTranslateOrSummarize}
                  onForwardToSelf={onForwardToSelf}
                  onRevokeFile={onRevokeFile}
                  onOpenViewOnce={onOpenViewOnce}
                  onSendMessageToMail={(targetMsg) => {
                    const draft = buildMailDraftFromMessagesPure(
                      displayName,
                      [targetMsg],
                      usersById,
                    );
                    setComposerMailDraft({ draft, nonce: Date.now() });
                  }}
                />
              </div>
            );
          })}

          {activeTypingNames.length > 0 && (
            <div className="px-2 py-1 text-xs font-medium text-[#075E54] dark:text-[#07C160]">
              {activeTypingNames.join(', ')}님이 입력 중입니다...
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Floating Scroll to Bottom Button */}
        {showScrollBottom && (
          <button
            type="button"
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="맨 아래 최신 메시지로 이동"
            className="absolute right-4 bottom-3 z-20 h-9 px-3 rounded-full bg-white/95 dark:bg-neutral-800/95 border border-black/10 dark:border-neutral-700 shadow-lg flex items-center gap-1 text-xs font-semibold text-[#008069] dark:text-[#07C160] hover:bg-white cursor-pointer"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>최신 대화</span>
          </button>
        )}
      </div>

      {/* Rich Chat Composer */}
      <ChatComposer
        roomId={room.id}
        roomName={displayName}
        roomType={room.type}
        currentUser={currentUser}
        leaves={leaves}
        roomMessages={roomMessages}
        mails={mails}
        notices={notices}
        notifications={notifications}
        draftText={effectiveDraft}
        draftSavedAt={draftSavedAt}
        roomMembers={roomMembers}
        colleagues={colleagues}
        usersById={usersById}
        replyTo={replyTo}
        todayDate={todayDate}
        openLeaveDraftTrigger={leaveTriggerCount}
        openLeaveLookupTrigger={leaveLookupTriggerCount}
        focusNonce={composerFocusNonce}
        onDraftChange={setEffectiveDraft}
        onClearReply={() => setReplyTo(null)}
        onSendMessage={async (payload) => {
          await onSendMessage(payload);
          const egoMatch = payload.content.match(/^(?:@ego|\/ego|ego[:：])\s+(.+)/i);
          if (room.type === 'self' && payload.type === 'text' && egoMatch && apiFetch) {
            const res = await apiFetch('/api/ego/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ goal: egoMatch[1].trim(), recordInSelfChat: true }),
            }).catch(() => null);
            if (res && res.ok) {
              const data = await res.json();
              if (data.selfRoomMessage) onEgoSelfMessage?.(data.selfRoomMessage);
            }
          }
        }}
        onUploadFile={onUploadFile}
        onRegisterLeaveFromChat={onRegisterLeaveFromChat}
        onTriggerIntegration={onTriggerIntegration}
        onOpenNoticeModal={onOpenNoticeModal}
        onOpenPollModal={onOpenPollModal}
        onGoToLeaveTab={onGoToLeaveTab}
        onTypingChange={onTypingChange}
        apiFetch={apiFetch}
        scheduledMessages={scheduledMessages}
        onScheduleMessage={onScheduleMessage}
        onCancelScheduledMessage={onCancelScheduledMessage}
        onShareLargeLink={onShareLargeLink}
        onShareNasFile={onShareNasFile}
        onRunRandomDraw={onRunRandomDraw}
        onOpenMail={onOpenMail}
        onMailSent={onMailSent}
        onAcknowledgeNotice={onAcknowledgeNotice}
        onMarkNotificationRead={onMarkNotificationRead}
        onMarkAllNotificationsRead={onMarkAllNotificationsRead}
        onOpenRoom={onOpenRoom}
        onExportTranscript={handleExportTranscript}
        externalLargeLinkNonce={externalLargeLinkNonce}
        roomFiles={roomFiles}
        externalMailDraft={composerMailDraft.draft}
        externalMailNonce={composerMailDraft.nonce}
        bmailBridgeStatus={bmailBridgeStatus}
        onSyncRemoteBmail={onSyncRemoteBmail}
        onLaunchBmailSso={onLaunchBmailSso}
        chunkUploadProgress={chunkUploadProgress}
      />
    </div>
  );
}
