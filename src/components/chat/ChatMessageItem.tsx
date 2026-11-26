import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CalendarPlus,
  Check,
  CheckCheck,
  CheckSquare,
  Clock,
  Copy,
  Dices,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Forward,
  Languages,
  Layers,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  NotebookPen,
  Pause,
  Pencil,
  Pin,
  Play,
  Reply,
  RotateCcw,
  Send,
  Siren,
  Smile,
  Sparkles,
  Square,
  Star,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import { Lock } from 'lucide-react';
import { formatVoiceDuration } from '../../shared/chatLogic';
import { computeUnreadCount, formatFileSize, formatKoreanTime } from '../../shared/logic';
import { getNoticePriorityMeta, normalizeNoticePriority } from '../../shared/noticeAlert';
import { SHARE_PROVIDER_LABELS } from '../../shared/voiceAnalysis';
import {
  dataUrlToBlobUrl,
  playDataUrlWithWebAudio,
  playSynthesizedVoiceWithWebAudio,
  playVoiceCueTone,
  speakKoreanVoiceText,
  stopAllSpeechSynthesis,
  synthesizeAudibleWavDataUrl,
  unlockAudioPlayback,
  type WebAudioPlaybackHandle,
} from '../../utils/voiceAudio';
import {
  WORK_EMOTICONS,
  type ChatRoom,
  type IntegrationActionSummary,
  type Message,
  type SharedFileItem,
  type User,
} from '../../types/client';
import { Avatar } from '../Avatar';
import { MessageRichText } from './MessageRichText';
import { ReadReceiptPopover } from './ReadReceiptPopover';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '✅'];

interface ChatMessageItemProps {
  message: Message;
  room: ChatRoom;
  roomMembers: User[];
  currentUser: User;
  usersById: Record<string, User>;
  replyTarget: Message | null;
  showSenderHeader: boolean;
  showTimestamp: boolean;
  isHighlighted: boolean;
  searchQuery: string;
  selectionMode: boolean;
  isSelected: boolean;
  reactionPickerOpen: boolean;
  readReceiptOpen: boolean;
  copied: boolean;
  onToggleSelect: (messageId: string) => void;
  onToggleReactionPicker: (messageId: string) => void;
  onToggleReadReceipt: (messageId: string) => void;
  onReply: (msg: Message) => void;
  onToggleStar: (messageId: string) => Promise<void>;
  onForward: (messageId: string) => void;
  onStartSelection: (messageId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
  onRecallMessage: (messageId: string) => Promise<void>;
  onReeditRecalled: (content: string) => void;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onVotePoll: (messageId: string, optionId: string) => Promise<void>;
  onOpenNoticeModal: (initialContent?: string, messageId?: string) => void;
  onCopy: (msg: Message) => void;
  onJumpToMessage: (messageId: string) => void;
  onGoToMailTab: () => void;
  onOpenMail?: (mailId: string) => void;
  onStartDirectChat: (userId: string) => void;
  onPreviewImage: (file: SharedFileItem) => void;
  onSelectUserProfile: (user: User) => void;
  fileToken?: string | null;
  onTriggerIntegration?: (summary: IntegrationActionSummary) => Promise<void> | void;
  onAnalyzeVoice?: (msg: Message) => Promise<void>;
  onTranslateOrSummarize?: (
    messageId: string,
    mode: 'translate' | 'summary',
  ) => Promise<{ resultText?: string; error?: string }>;
  onForwardToSelf?: (messageId: string) => Promise<void> | void;
  onRevokeFile?: (fileId: string) => Promise<void> | void;
  onScheduleRsvp?: (messageId: string, choice: 'yes' | 'maybe' | 'no') => Promise<void> | void;
  onOpenViewOnce?: (
    messageId: string,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  onSendMessageToMail?: (msg: Message) => void;
}

export function ChatMessageItem({
  message: msg,
  room,
  roomMembers,
  currentUser,
  usersById,
  replyTarget,
  showSenderHeader,
  showTimestamp,
  isHighlighted,
  searchQuery,
  selectionMode,
  isSelected,
  reactionPickerOpen,
  readReceiptOpen,
  copied,
  onToggleSelect,
  onToggleReactionPicker,
  onToggleReadReceipt,
  onReply,
  onToggleStar,
  onForward,
  onStartSelection,
  onEditMessage,
  onRecallMessage,
  onReeditRecalled,
  onDeleteMessage,
  onToggleReaction,
  onVotePoll,
  onOpenNoticeModal,
  onCopy,
  onJumpToMessage,
  onGoToMailTab,
  onOpenMail,
  onStartDirectChat,
  onPreviewImage,
  onSelectUserProfile,
  fileToken,
  onTriggerIntegration,
  onAnalyzeVoice,
  onTranslateOrSummarize,
  onForwardToSelf,
  onRevokeFile,
  onScheduleRsvp,
  onOpenViewOnce,
  onSendMessageToMail,
}: ChatMessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(msg.content);
  const [savingEdit, setSavingEdit] = useState(false);

  // Voice playback + speed + seek + transcript & AI analysis
  const [playingVoice, setPlayingVoice] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voiceElapsedSec, setVoiceElapsedSec] = useState(0);
  const [voiceSpeed, setVoiceSpeed] = useState<1 | 1.5 | 2>(1);
  const [speakingTts, setSpeakingTts] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [analyzingVoice, setAnalyzingVoice] = useState(false);
  const [voicePlayError, setVoicePlayError] = useState<string | null>(null);

  // File share link copy, revoke, & quick translate/summary
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);
  const [revokingFile, setRevokingFile] = useState(false);
  const [quickAnalysis, setQuickAnalysis] = useState<{
    open: boolean;
    loading: boolean;
    text?: string;
    error?: string;
  } | null>(null);
  const [openingViewOnce, setOpeningViewOnce] = useState(false);
  const [revealedViewOnceText, setRevealedViewOnceText] = useState<string | null>(null);
  const [viewOnceError, setViewOnceError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const webAudioHandleRef = useRef<WebAudioPlaybackHandle | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const voiceSpeedRef = useRef<1 | 1.5 | 2>(1);
  voiceSpeedRef.current = voiceSpeed;

  const cleanupAudioResources = () => {
    if (playTimerRef.current) {
      window.clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.ontimeupdate = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (webAudioHandleRef.current) {
      webAudioHandleRef.current.stop();
      webAudioHandleRef.current = null;
    }
    stopAllSpeechSynthesis();
    setPlayingVoice(false);
    setSpeakingTts(false);
    setVoiceProgress(0);
    setVoiceElapsedSec(0);
  };

  useEffect(() => {
    setRevealedViewOnceText(null);
    setViewOnceError(null);
    return () => {
      cleanupAudioResources();
    };
  }, [msg.id, msg.voice?.audioDataUrl]);

  const stopVoicePlayback = () => {
    if (playTimerRef.current) {
      window.clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (webAudioHandleRef.current) {
      webAudioHandleRef.current.stop();
      webAudioHandleRef.current = null;
    }
    stopAllSpeechSynthesis();
    setPlayingVoice(false);
    setSpeakingTts(false);
  };

  const ensureAudioElement = (): HTMLAudioElement | null => {
    if (!msg.voice) return null;
    if (audioRef.current) return audioRef.current;
    let src = msg.voice.audioDataUrl;
    if (src && src.startsWith('data:')) {
      const converted = dataUrlToBlobUrl(src);
      if (converted) {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = converted;
        src = converted;
      }
    } else if (!src) {
      const wavDataUrl = synthesizeAudibleWavDataUrl(
        msg.voice.durationSec,
        msg.voice.transcript || msg.id,
      );
      const converted = dataUrlToBlobUrl(wavDataUrl);
      if (converted) {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = converted;
        src = converted;
      } else {
        src = wavDataUrl;
      }
    }
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.playbackRate = voiceSpeed;
    audio.ontimeupdate = () => {
      const dur = audio.duration && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : Math.max(1, msg.voice?.durationSec ?? 1);
      const pct = Math.min(100, Math.round((audio.currentTime / dur) * 100));
      setVoiceProgress(pct);
      setVoiceElapsedSec(Math.round(audio.currentTime));
    };
    audio.onended = () => {
      if (playTimerRef.current) {
        window.clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      setPlayingVoice(false);
      setVoiceProgress(0);
      setVoiceElapsedSec(0);
    };
    audioRef.current = audio;
    return audio;
  };

  const startWebAudioFallback = async (startRatio = 0) => {
    if (!msg.voice) return;
    const totalSec = Math.max(1, msg.voice.durationSec);
    if (webAudioHandleRef.current) {
      webAudioHandleRef.current.stop();
      webAudioHandleRef.current = null;
    }

    const onEnded = () => {
      if (playTimerRef.current) {
        window.clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      webAudioHandleRef.current = null;
      setPlayingVoice(false);
      setVoiceProgress(0);
      setVoiceElapsedSec(0);
    };

    const handle = msg.voice.audioDataUrl
      ? await playDataUrlWithWebAudio(msg.voice.audioDataUrl, {
          rate: voiceSpeed,
          startRatio,
          onEnded,
        })
      : await playSynthesizedVoiceWithWebAudio(totalSec, msg.voice.transcript || msg.id, {
          rate: voiceSpeed,
          startRatio,
          onEnded,
        });

    if (handle) {
      webAudioHandleRef.current = handle;
      setVoicePlayError(null);
    } else if (!msg.voice.transcript) {
      setVoicePlayError('브라우저 오디오 출력 권한이 필요합니다.');
    }
  };

  const startProgressTimer = (initialElapsed = 0) => {
    if (!msg.voice) return;
    if (playTimerRef.current) window.clearInterval(playTimerRef.current);
    const totalSec = Math.max(1, msg.voice.durationSec);
    const stepMs = 120;
    let simElapsed = initialElapsed;
    playTimerRef.current = window.setInterval(() => {
      const audio = audioRef.current;
      if (
        audio &&
        !audio.paused &&
        audio.duration &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        return;
      }
      simElapsed += (stepMs / 1000) * voiceSpeedRef.current;
      const pct = Math.min(100, Math.round((simElapsed / totalSec) * 100));
      setVoiceProgress(pct);
      setVoiceElapsedSec(Math.min(totalSec, Math.round(simElapsed)));
      if (pct >= 100) {
        if (playTimerRef.current) window.clearInterval(playTimerRef.current);
        playTimerRef.current = null;
        setPlayingVoice(false);
        setVoiceProgress(0);
        setVoiceElapsedSec(0);
      }
    }, stepMs);
  };

  const togglePlayVoice = () => {
    void unlockAudioPlayback();
    if (!msg.voice) return;
    if (playingVoice) {
      stopVoicePlayback();
      return;
    }

    setVoicePlayError(null);
    setPlayingVoice(true);
    setVoiceProgress(0);
    setVoiceElapsedSec(0);

    // For transcript-only voice notes, avoid overlapping WebAudio tones over Korean TTS
    if (!msg.voice.audioDataUrl) {
      if (msg.voice.transcript) {
        playVoiceCueTone('click');
        const started = speakKoreanVoiceText(msg.voice.transcript, {
          rate: voiceSpeedRef.current,
          onStart: () => setSpeakingTts(true),
          onEnd: () => setSpeakingTts(false),
          onError: () => {
            setSpeakingTts(false);
            void startWebAudioFallback(0);
          },
        });
        if (!started) {
          void startWebAudioFallback(0);
        }
      } else {
        void startWebAudioFallback(0);
      }
      startProgressTimer(0);
      return;
    }

    // Real recorded audioDataUrl: play via <audio> Blob URL with instant WebAudio decode/playback fallback
    let fallbackStarted = false;
    const triggerFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      void startWebAudioFallback(0);
    };

    try {
      const audio = ensureAudioElement();
      if (audio) {
        audio.currentTime = 0;
        audio.playbackRate = voiceSpeed;
        audio.volume = 1.0;
        audio.onerror = () => triggerFallback();
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            triggerFallback();
          });
        }
      } else {
        triggerFallback();
      }
    } catch {
      triggerFallback();
    }

    startProgressTimer(0);
  };

  const handleCycleVoiceSpeed = () => {
    const nextSpeed: 1 | 1.5 | 2 = voiceSpeed === 1 ? 1.5 : voiceSpeed === 1.5 ? 2 : 1;
    setVoiceSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
    webAudioHandleRef.current?.setRate(nextSpeed);
  };

  const handleSeekVoiceBar = (barIndex: number, totalBars: number) => {
    void unlockAudioPlayback();
    if (!msg.voice) return;
    const ratio = (barIndex + 1) / totalBars;
    const pct = Math.round(ratio * 100);
    setVoiceProgress(pct);
    const targetSec = msg.voice.durationSec * ratio;
    setVoiceElapsedSec(Math.round(targetSec));
    if (webAudioHandleRef.current) {
      void startWebAudioFallback(ratio);
      if (playingVoice) startProgressTimer(targetSec);
      return;
    }
    const audio = ensureAudioElement();
    if (audio && audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = ratio * audio.duration;
    }
  };

  const handleToggleTtsOnly = () => {
    void unlockAudioPlayback();
    if (!msg.voice?.transcript) return;
    if (speakingTts) {
      stopAllSpeechSynthesis();
      setSpeakingTts(false);
      return;
    }
    speakKoreanVoiceText(msg.voice.transcript, {
      rate: voiceSpeed,
      onStart: () => setSpeakingTts(true),
      onEnd: () => setSpeakingTts(false),
      onError: () => setSpeakingTts(false),
    });
  };

  const handleAnalyzeVoiceClick = async () => {
    if (!onAnalyzeVoice || analyzingVoice) return;
    setAnalyzingVoice(true);
    try {
      await onAnalyzeVoice(msg);
      setShowTranscript(true);
    } finally {
      setAnalyzingVoice(false);
    }
  };

  const handleQuickTranslateSummary = async () => {
    if (!onTranslateOrSummarize) return;
    const isEn = /[a-zA-Z]{4,}/.test(msg.content);
    setQuickAnalysis({ open: true, loading: true });
    const res = await onTranslateOrSummarize(msg.id, isEn ? 'translate' : 'summary');
    setQuickAnalysis({
      open: true,
      loading: false,
      text: res.resultText,
      error: res.error,
    });
  };

  const isMe = msg.senderId === currentUser.id;
  const sender = usersById[msg.senderId];
  const unreadCount = computeUnreadCount(msg, room.memberIds, usersById);
  const isStarred = (msg.starredByUserIds ?? []).includes(currentUser.id);
  const canEdit = isMe && msg.type === 'text' && !msg.deleted && !msg.recalled;

  const handleSaveEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editDraft.trim();
    if (!trimmed || savingEdit) return;
    if (trimmed === msg.content) {
      setEditing(false);
      return;
    }
    setSavingEdit(true);
    try {
      await onEditMessage(msg.id, trimmed);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  if (msg.type === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="px-3.5 py-1 rounded-full bg-black/15 dark:bg-white/10 text-white dark:text-neutral-200 text-xs text-center">
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.recalled) {
    return (
      <div className="my-2 flex items-center justify-center gap-2">
        <span className="px-3.5 py-1 rounded-full bg-black/10 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 text-xs text-center flex items-center gap-2">
          <span>{msg.content}</span>
          {isMe && msg.recalledOriginalContent && (
            <button
              type="button"
              onClick={() => onReeditRecalled(msg.recalledOriginalContent!)}
              className="font-bold text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
            >
              다시 편집
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`group relative hover:z-30 focus-within:z-30 flex items-start gap-2 ${
        isMe ? 'justify-end' : 'justify-start'
      } ${showSenderHeader ? 'mt-2.5' : 'mt-0.5'} ${
        isSelected ? 'bg-[#07C160]/10 -mx-2 px-2 py-1 rounded-2xl' : ''
      }`}
    >
      {selectionMode && !msg.deleted && (
        <button
          type="button"
          onClick={() => onToggleSelect(msg.id)}
          aria-label={isSelected ? '메시지 선택 해제' : '메시지 선택'}
          className="mt-2 shrink-0 text-[#008069] dark:text-[#07C160] cursor-pointer"
        >
          {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-neutral-400" />}
        </button>
      )}

      {!isMe && (
        <div className="w-9 shrink-0 flex flex-col items-center">
          {showSenderHeader && sender && (
            <button
              type="button"
              onClick={() => onSelectUserProfile(sender)}
              aria-label={`${sender.name} 프로필 보기`}
              className="cursor-pointer"
            >
              <Avatar user={sender} size="sm" />
            </button>
          )}
        </div>
      )}

      <div
        className={`min-w-0 max-w-[84%] sm:max-w-[70%] flex flex-col ${
          isMe ? 'items-end' : 'items-start'
        }`}
      >
        {!isMe && showSenderHeader && (
          <div className="mb-1 flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {sender?.name ?? '사원'}
            </span>
            <span className="text-[11px] text-neutral-600/80 dark:text-neutral-400">
              {sender?.position} · {sender?.department}
            </span>
          </div>
        )}

        <div
          className={`relative flex items-end gap-1.5 min-w-0 max-w-full ${
            isMe ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          <div
            className={`relative min-w-0 max-w-full rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-2xs transition-all ${
              isHighlighted ? 'ring-2 ring-[#FEE500] shadow-md' : ''
            } ${
              msg.deleted
                ? 'bg-white/60 dark:bg-neutral-800/60 text-neutral-500 italic'
                : msg.type === 'emoticon'
                  ? 'bg-transparent px-1 py-1 shadow-none'
                  : isMe
                    ? 'bg-[#CEF5C8] dark:bg-[#005C4B] text-[#111B21] dark:text-[#E9EDEF] rounded-tr-xs'
                    : 'bg-white dark:bg-[#202C33] text-neutral-900 dark:text-[#E9EDEF] rounded-tl-xs'
            }`}
          >
            {msg.forwardedFrom && !msg.deleted && (
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium opacity-75">
                <Forward className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  전달됨 · {msg.forwardedFrom.senderName}
                  {msg.forwardedFrom.roomName ? ` (${msg.forwardedFrom.roomName})` : ''}
                </span>
              </div>
            )}

            {replyTarget && !msg.deleted && (
              <button
                type="button"
                onClick={() => onJumpToMessage(replyTarget.id)}
                className="w-full text-left mb-2 pb-1.5 pl-2 border-l-2 border-[#008069] dark:border-[#07C160] border-b border-b-black/10 dark:border-b-white/10 text-xs opacity-85 hover:opacity-100 cursor-pointer"
              >
                <div className="font-semibold">
                  {usersById[replyTarget.senderId]?.name ?? '사원'}에게 답장
                </div>
                <div className="truncate max-w-[240px]">{replyTarget.content}</div>
              </button>
            )}

            {msg.type === 'emoticon' && !msg.deleted && (() => {
              const emo = WORK_EMOTICONS.find((e) => e.id === msg.emoticonId);
              return (
                <div
                  className="p-3 rounded-2xl border border-black/10 flex flex-col items-center gap-1 min-w-[118px]"
                  style={{ backgroundColor: emo?.bg ?? '#FEF3C7' }}
                >
                  <span className="text-4xl leading-none">{emo?.emoji ?? '👌'}</span>
                  <span className="text-xs font-bold text-neutral-800">
                    {emo?.caption ?? msg.content}
                  </span>
                </div>
              );
            })()}

            {msg.type === 'image' && msg.file && !msg.deleted && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onPreviewImage({
                      ...msg.file!,
                      roomId: msg.roomId,
                      uploaderId: msg.senderId,
                      messageId: msg.id,
                      createdAt: msg.createdAt,
                    })
                  }
                  className="block rounded-xl overflow-hidden border border-black/10 cursor-pointer"
                >
                  <img
                    src={`${msg.file.url}?inline=1${fileToken ? `&ft=${encodeURIComponent(fileToken)}` : ''}`}
                    alt={msg.file.filename}
                    referrerPolicy="no-referrer"
                    className="max-h-60 max-w-full object-cover"
                  />
                </button>
                <div className="text-xs opacity-80 truncate">{msg.file.filename}</div>
              </div>
            )}

            {msg.type === 'file' && msg.file && !msg.deleted && (() => {
              const rawShareUrl = msg.file.shareUrl || msg.file.url;
              const absShareUrl =
                rawShareUrl.startsWith('http')
                  ? rawShareUrl
                  : typeof window !== 'undefined'
                    ? `${window.location.origin}${rawShareUrl}${fileToken && !msg.file.shareUrl ? `?ft=${encodeURIComponent(fileToken)}` : ''}`
                    : rawShareUrl;
              const downloadHref = msg.file.shareUrl
                ? msg.file.shareUrl
                : msg.file.isExternalLink
                  ? msg.file.url
                  : `${msg.file.url}${fileToken ? `?ft=${encodeURIComponent(fileToken)}` : ''}`;
              const isLargeOrLink = Boolean(msg.file.isLargeFile || msg.file.isExternalLink || msg.file.shareUrl);
              const isRevoked = Boolean(msg.file.revoked);
              const providerLabel = msg.file.shareProvider
                ? SHARE_PROVIDER_LABELS[msg.file.shareProvider]
                : undefined;
              const metaParts: string[] = [formatFileSize(msg.file.size)];
              if (msg.file.nasFolder) metaParts.push(`NAS: ${msg.file.nasFolder}`);
              else if (providerLabel) metaParts.push(providerLabel);
              else if (isLargeOrLink) metaParts.push('대용량 링크');
              if (msg.file.hasPasscode) metaParts.push('비밀번호 보호');
              if (typeof msg.file.downloadCount === 'number' || msg.file.maxDownloads) {
                metaParts.push(
                  msg.file.maxDownloads
                    ? `다운로드 ${msg.file.downloadCount ?? 0}/${msg.file.maxDownloads}회`
                    : `다운로드 ${msg.file.downloadCount ?? 0}회`,
                );
              }
              if (msg.file.shareExpiresAt) {
                metaParts.push(`만료 ${msg.file.shareExpiresAt.slice(0, 10)}`);
              }
              const canRevoke = !isRevoked && Boolean(onRevokeFile) && (isMe || currentUser.role === 'admin');
              return (
                <div className={`space-y-2 min-w-0 w-full sm:min-w-[260px] ${isRevoked ? 'opacity-70' : ''}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {msg.file.hasPasscode && <Lock className="h-3 w-3 text-amber-600 shrink-0" />}
                        <span className={`text-xs font-bold truncate ${isRevoked ? 'line-through' : ''}`}>
                          {msg.file.filename}
                        </span>
                        {msg.file.nasFolder && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-600/15 text-[#075E54] dark:text-[#07C160] text-[10px] font-bold shrink-0">
                            <FolderOpen className="h-2.5 w-2.5" />
                            <span>NAS</span>
                          </span>
                        )}
                        {isRevoked && (
                          <span className="text-[10px] font-bold text-red-600 dark:text-red-400 shrink-0">
                            · 회수됨
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] opacity-75 tabular-nums leading-snug break-words">
                        {metaParts.join(' · ')}
                      </div>
                    </div>
                    {isRevoked ? (
                      <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 shrink-0">
                        중지됨
                      </span>
                    ) : (
                      <a
                        href={downloadHref}
                        target={msg.file.isExternalLink || msg.file.shareUrl ? '_blank' : undefined}
                        rel={msg.file.isExternalLink || msg.file.shareUrl ? 'noopener noreferrer' : undefined}
                        download={msg.file.isExternalLink || msg.file.shareUrl ? undefined : msg.file.filename}
                        aria-label={`${msg.file.filename} 다운로드`}
                        className="h-8 w-8 rounded-lg bg-black/10 hover:bg-black/20 flex items-center justify-center shrink-0"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/10 dark:border-white/10">
                    {!isRevoked && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(absShareUrl).catch(() => {});
                          setCopiedShareUrl(true);
                          window.setTimeout(() => setCopiedShareUrl(false), 1800);
                        }}
                        className="h-7 px-2 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedShareUrl ? <Check className="h-3 w-3 text-[#008069]" /> : <Link2 className="h-3 w-3" />}
                        <span>{copiedShareUrl ? '링크 복사됨' : '링크 복사'}</span>
                      </button>
                    )}
                    {!isRevoked && onForwardToSelf && room.type !== 'self' && (
                      <button
                        type="button"
                        onClick={() => onForwardToSelf(msg.id)}
                        className="h-7 px-2 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Send className="h-3 w-3" />
                        <span>나에게 보내기</span>
                      </button>
                    )}
                    {canRevoke && (
                      <button
                        type="button"
                        disabled={revokingFile}
                        onClick={async () => {
                          if (!onRevokeFile) return;
                          setRevokingFile(true);
                          try {
                            await onRevokeFile(msg.file!.id);
                          } finally {
                            setRevokingFile(false);
                          }
                        }}
                        className="h-7 px-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {revokingFile ? '회수 중...' : '링크 회수'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {msg.type === 'voice' && msg.voice && !msg.deleted && (
              <div className="min-w-[235px] sm:min-w-[270px] space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={togglePlayVoice}
                    aria-label={playingVoice ? '음성 메시지 일시정지' : '음성 메시지 재생'}
                    className="h-9 w-9 rounded-full bg-[#008069] hover:bg-[#006B58] text-white flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    {playingVoice ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>
                  <div className="flex-1 flex items-center gap-[3px] h-7" role="group" aria-label="음성 파형 탐색">
                    {(() => {
                      const raw = msg.voice.waveform?.length
                        ? msg.voice.waveform
                        : [35, 65, 50, 80, 45, 70, 55, 40, 75, 60, 45, 50, 68, 42, 74, 52, 60, 46];
                      const targetLen = 18;
                      const normalizedBars = Array.from({ length: targetLen }, (_, idx) => {
                        const srcIdx = Math.floor((idx / targetLen) * raw.length);
                        return raw[Math.min(raw.length - 1, srcIdx)] ?? 48;
                      });
                      return normalizedBars.map((bar, idx, arr) => {
                        const barThreshold = ((idx + 1) / arr.length) * 100;
                        const activeBar = voiceProgress >= barThreshold && (playingVoice || voiceProgress > 0);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSeekVoiceBar(idx, arr.length)}
                            aria-label={`${Math.round(((idx + 1) / arr.length) * 100)}% 지점으로 이동`}
                            className={`flex-1 max-w-[6px] rounded-full transition-colors cursor-pointer ${
                              activeBar
                                ? 'bg-[#008069] dark:bg-[#07C160]'
                                : 'bg-black/20 dark:bg-white/25 hover:bg-[#008069]/60'
                            }`}
                            style={{ height: `${Math.max(22, Math.min(100, bar))}%` }}
                          />
                        );
                      });
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={handleCycleVoiceSpeed}
                    aria-label={`재생 속도 변경 (현재 ${voiceSpeed}배속)`}
                    className="h-6 px-1.5 rounded-md bg-black/10 dark:bg-white/15 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {voiceSpeed}x
                  </button>
                  <span className="text-[11px] font-semibold tabular-nums opacity-85 shrink-0">
                    {playingVoice
                      ? `${formatVoiceDuration(voiceElapsedSec)}/${formatVoiceDuration(msg.voice.durationSec)}`
                      : formatVoiceDuration(msg.voice.durationSec)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowTranscript((v) => !v)}
                      aria-label="음성 메시지 문자로 변환"
                      className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {showTranscript ? '변환 닫기' : '문자로 변환'}
                    </button>
                    {msg.voice.transcript && (
                      <button
                        type="button"
                        onClick={handleToggleTtsOnly}
                        aria-label="음성 텍스트 한국어 음성으로 듣기"
                        className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Volume2 className="h-3 w-3" />
                        <span>{speakingTts ? '중지' : '음성 읽기'}</span>
                      </button>
                    )}
                    {onAnalyzeVoice && (
                      <button
                        type="button"
                        disabled={analyzingVoice}
                        onClick={handleAnalyzeVoiceClick}
                        className="px-2 py-0.5 rounded-md bg-[#008069]/15 hover:bg-[#008069]/25 text-[#075E54] dark:text-[#07C160] text-[11px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {analyzingVoice ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        <span>{analyzingVoice ? '분석 중...' : 'AI 음성 분석'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {voicePlayError && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">{voicePlayError}</p>
                )}

                {(showTranscript || msg.voice.analysis) && (
                  <div className="p-2.5 rounded-xl bg-black/5 dark:bg-black/25 text-xs leading-relaxed space-y-1.5">
                    {showTranscript && (
                      <div>
                        <span className="font-semibold opacity-70 mr-1">변환 텍스트:</span>
                        <span>{msg.voice.transcript || '음성 메모가 전달되었습니다.'}</span>
                      </div>
                    )}
                    {msg.voice.analysis && (
                      <div className="pt-1 border-t border-black/10 dark:border-white/10 space-y-1">
                        <div className="font-bold text-[#075E54] dark:text-[#07C160]">
                          AI 요약 · {msg.voice.analysis.summary}
                        </div>
                        {msg.voice.analysis.keywords.length > 0 && (
                          <div className="text-[11px] opacity-80">
                            핵심어: {msg.voice.analysis.keywords.join(' · ')}
                          </div>
                        )}
                        {msg.voice.analysis.actionItems.length > 0 && (
                          <div className="text-[11px] opacity-85">
                            후속 조치: {msg.voice.analysis.actionItems.join(' / ')}
                          </div>
                        )}
                        {msg.voice.analysis.suggestedMenuKey && onTriggerIntegration && (
                          <button
                            type="button"
                            onClick={() =>
                              onTriggerIntegration({
                                system: 'SGW',
                                menuKey: msg.voice!.analysis!.suggestedMenuKey!,
                                title: msg.voice!.analysis!.summary,
                                description: msg.voice!.transcript || msg.voice!.analysis!.summary,
                                actionLabel: '관련 업무 화면 열기',
                              })
                            }
                            className="mt-1 h-7 px-2.5 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-[11px] font-bold whitespace-nowrap cursor-pointer"
                          >
                            관련 업무 연동 열기
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {msg.type === 'leave_alert' && msg.leaveAlert && !msg.deleted && (
              <div className="min-w-0 w-full sm:min-w-[240px] space-y-2">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-black/10 dark:border-white/10">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <CalendarPlus className="h-3.5 w-3.5" />
                    SGW 연차 등록 알림 (bmail 연동)
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums">
                    {msg.leaveAlert.leaveType} · {msg.leaveAlert.daysCount}일
                  </span>
                </div>
                <div className="text-xs space-y-1">
                  <div>
                    <span className="font-semibold">{msg.leaveAlert.userName}</span>{' '}
                    {msg.leaveAlert.position} · {msg.leaveAlert.department}
                  </div>
                  <div className="tabular-nums opacity-85">
                    일정:{' '}
                    {msg.leaveAlert.startDate === msg.leaveAlert.endDate
                      ? msg.leaveAlert.startDate
                      : `${msg.leaveAlert.startDate} ~ ${msg.leaveAlert.endDate}`}
                  </div>
                  <div className="opacity-85">업무 대행: {msg.leaveAlert.substituteName}</div>
                  <div className="opacity-75">사유: {msg.leaveAlert.reason}</div>
                </div>
              </div>
            )}

            {msg.type === 'mail_alert' && msg.mailAlert && !msg.deleted && (() => {
              const providerLabel = msg.mailAlert.provider === 'bigmail' ? '빅메일' : '비메일';
              const attCount = msg.mailAlert.attachmentCount ?? 0;
              const attSummary =
                attCount === 0
                  ? '첨부 없음'
                  : msg.mailAlert.attachmentNames?.[0]
                    ? `📎 ${msg.mailAlert.attachmentNames[0]}${attCount > 1 ? ` 외 ${attCount - 1}개` : ''}`
                    : `📎 첨부 ${attCount}건`;
              return (
                <div className="min-w-0 w-full sm:min-w-[250px] space-y-2">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-black/10 dark:border-white/10">
                    <span className="text-xs font-bold text-[#008069] dark:text-[#07C160] flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      <span>{providerLabel} 수신 알림</span>
                    </span>
                    <span className="text-[11px] opacity-75">
                      {msg.mailAlert.category} · {attSummary}
                    </span>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="font-bold">{msg.mailAlert.subject}</div>
                    <div className="opacity-75">
                      발신: {msg.mailAlert.senderName} ({msg.mailAlert.senderEmail})
                    </div>
                    <p className="opacity-85 line-clamp-2">
                      {msg.mailAlert.shortSummary || msg.mailAlert.preview}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenMail && msg.mailAlert?.mailId) {
                          onOpenMail(msg.mailAlert.mailId);
                        } else {
                          onGoToMailTab();
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-[11px] font-bold whitespace-nowrap cursor-pointer"
                    >
                      상세히 보기 (이메일 앱)
                    </button>
                    {msg.mailAlert.senderId !== currentUser.id && (
                      <button
                        type="button"
                        onClick={() => onStartDirectChat(msg.mailAlert!.senderId)}
                        className="px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/10 text-[11px] font-medium whitespace-nowrap cursor-pointer"
                      >
                        1:1 대화
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {msg.type === 'notice_alert' && !msg.deleted && (() => {
              const priority = normalizeNoticePriority({
                priority: msg.noticeAlert?.priority,
                isUrgent: msg.noticeAlert?.isUrgent,
              });
              const meta = getNoticePriorityMeta(priority);
              const isUrgent = priority === 'urgent';
              const isImportant = priority === 'important';
              return (
                <div
                  className={`min-w-0 w-full sm:min-w-[240px] space-y-1.5 rounded-xl p-2.5 border ${
                    isUrgent
                      ? 'bg-red-50/90 dark:bg-red-950/45 border-red-300 dark:border-red-700'
                      : isImportant
                        ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                        : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 pb-1 border-b border-black/10 dark:border-white/10">
                    <span
                      className={`flex items-center gap-1.5 text-xs font-extrabold ${
                        isUrgent
                          ? 'text-red-700 dark:text-red-300'
                          : isImportant
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {isUrgent ? (
                        <Siren className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Megaphone className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>
                        {isUrgent
                          ? '긴급재난문자 공지 전파'
                          : msg.noticeAlert?.title || '방 공지가 등록되었습니다'}
                      </span>
                    </span>
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
                  </div>
                  {msg.noticeAlert?.title && isUrgent && (
                    <div className="text-xs font-bold text-red-900 dark:text-red-100">
                      {msg.noticeAlert.title}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</p>
                  {msg.noticeAlert?.pushAllMembers && (
                    <div className="text-[10px] font-semibold text-red-700 dark:text-red-300">
                      전 회원 긴급 푸시 알림 전송됨
                    </div>
                  )}
                </div>
              );
            })()}

            {msg.type === 'integration_alert' && msg.integrationAlert && !msg.deleted && (
              <div className="min-w-0 w-full sm:min-w-[250px] space-y-2">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-black/10 dark:border-white/10">
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      msg.integrationAlert.system === 'SEDMS'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                    }`}
                  >
                    <Layers className="h-3 w-3" />
                    <span>{msg.integrationAlert.system} 연동</span>
                  </span>
                  <span className="text-[10px] opacity-70 font-mono">
                    {msg.integrationAlert.menuKey}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-bold">{msg.integrationAlert.title}</div>
                  {msg.integrationAlert.description && (
                    <p className="text-xs opacity-85 whitespace-pre-wrap break-words">
                      {msg.integrationAlert.description}
                    </p>
                  )}
                </div>
                {onTriggerIntegration && (
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => onTriggerIntegration(msg.integrationAlert!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-[11px] font-bold cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{msg.integrationAlert.actionLabel || '연동 화면 열기'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {msg.type === 'poll' && msg.poll && !msg.deleted && (
              <div className="min-w-0 w-full sm:min-w-[240px] space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <BarChart3 className="h-4 w-4 text-amber-700" />
                  <span>{msg.poll.question}</span>
                </div>
                <div className="space-y-1.5">
                  {msg.poll.options.map((opt) => {
                    const totalVotes = msg.poll!.options.reduce(
                      (sum, o) => sum + o.voterIds.length,
                      0,
                    );
                    const voted = opt.voterIds.includes(currentUser.id);
                    const pct =
                      totalVotes > 0 ? Math.round((opt.voterIds.length / totalVotes) * 100) : 0;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onVotePoll(msg.id, opt.id)}
                        className={`w-full relative overflow-hidden rounded-xl border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                          voted
                            ? 'border-[#008069] bg-[#07C160]/12 font-bold'
                            : 'border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5 hover:bg-black/10'
                        }`}
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-[#07C160]/25 pointer-events-none"
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            {voted && <Check className="h-3.5 w-3.5" />}
                            {opt.text}
                          </span>
                          <span className="tabular-nums opacity-75">{opt.voterIds.length}명</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {msg.type === 'schedule_card' && msg.scheduleCard && !msg.deleted && (() => {
              const sc = msg.scheduleCard;
              const myYes = sc.attendeesYes.includes(currentUser.id);
              const myMaybe = sc.attendeesMaybe.includes(currentUser.id);
              const myNo = sc.attendeesNo.includes(currentUser.id);
              const yesNames = sc.attendeesYes.map((id) => usersById[id]?.name ?? '임직원');
              return (
                <div className="min-w-0 w-full sm:min-w-[260px] space-y-2.5">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-black/10 dark:border-white/10">
                    <span className="text-xs font-bold text-[#075E54] dark:text-[#07C160] flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 shrink-0" />
                      <span>일정 공유 · 참석 확인</span>
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums opacity-75">
                      참석 {sc.attendeesYes.length}명
                    </span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="text-sm font-bold">{sc.title}</div>
                    <div className="opacity-85 tabular-nums flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>{sc.dateTime}</span>
                    </div>
                    {sc.location && (
                      <div className="opacity-80 flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span>{sc.location}</span>
                      </div>
                    )}
                    {sc.memo && <p className="opacity-75 whitespace-pre-wrap pt-0.5">{sc.memo}</p>}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => onScheduleRsvp?.(msg.id, 'yes')}
                      className={`h-8 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                        myYes
                          ? 'bg-[#008069] border-[#008069] text-white'
                          : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/15 hover:bg-black/10'
                      }`}
                    >
                      <span>참석</span>
                      <span className="tabular-nums">({sc.attendeesYes.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onScheduleRsvp?.(msg.id, 'maybe')}
                      className={`h-8 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                        myMaybe
                          ? 'bg-amber-600 border-amber-600 text-white'
                          : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/15 hover:bg-black/10'
                      }`}
                    >
                      <span>미정</span>
                      <span className="tabular-nums">({sc.attendeesMaybe.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onScheduleRsvp?.(msg.id, 'no')}
                      className={`h-8 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                        myNo
                          ? 'bg-neutral-700 border-neutral-700 text-white'
                          : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/15 hover:bg-black/10'
                      }`}
                    >
                      <span>불참</span>
                      <span className="tabular-nums">({sc.attendeesNo.length})</span>
                    </button>
                  </div>
                  {yesNames.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px] opacity-75">
                      <Users className="h-3 w-3 shrink-0" />
                      <span className="truncate">참석: {yesNames.join(', ')}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {msg.type === 'draw_card' && msg.drawCard && !msg.deleted && (
              <div className="min-w-0 w-full sm:min-w-[250px] space-y-2">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-black/10 dark:border-white/10">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <Dices className="h-4 w-4 shrink-0" />
                    <span>랜덤 추첨 결과</span>
                  </span>
                  <span className="text-[10px] opacity-70 tabular-nums">
                    총 {msg.drawCard.candidates.length}명
                  </span>
                </div>
                <div className="text-xs font-semibold opacity-85">{msg.drawCard.topic}</div>
                <div className="p-2.5 rounded-xl bg-[#FEE500]/75 dark:bg-amber-500/20 border border-amber-400/50 text-center">
                  <div className="text-[10px] font-bold text-neutral-600 dark:text-amber-200">
                    당첨 · 선정
                  </div>
                  <div className="text-base font-extrabold text-neutral-900 dark:text-white mt-0.5">
                    🎉 {msg.drawCard.winner}
                  </div>
                </div>
                <div className="text-[11px] opacity-75 break-words">
                  후보: {msg.drawCard.candidates.join(', ')}
                </div>
              </div>
            )}

            {(msg.type === 'text' || msg.deleted) && (
              editing ? (
                <form onSubmit={handleSaveEdit} className="min-w-[220px] space-y-2">
                  <textarea
                    rows={2}
                    autoFocus
                    aria-label="메시지 내용 수정"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditing(false);
                        setEditDraft(msg.content);
                      } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleSaveEdit();
                      }
                    }}
                    className="w-full p-2 rounded-xl bg-white/90 dark:bg-neutral-900 border border-[#008069] text-sm text-neutral-900 dark:text-white resize-none focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEditDraft(msg.content);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-black/10 dark:bg-white/10 text-xs font-medium cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={savingEdit || !editDraft.trim()}
                      className="px-2.5 py-1 rounded-lg bg-[#008069] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      저장
                    </button>
                  </div>
                </form>
              ) : msg.deleted ? (
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              ) : msg.viewOnce ? (
                <div className="min-w-[210px] space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                    <span className="inline-flex items-center gap-1 text-[#075E54] dark:text-[#07C160]">
                      <Lock className="h-3.5 w-3.5" />
                      <span>1회 열람 비밀 메시지</span>
                    </span>
                    {isMe && (
                      <span className="text-[10px] font-medium opacity-75 tabular-nums">
                        열람 {msg.viewedByUserIds?.length ?? 0}명
                      </span>
                    )}
                  </div>
                  {isMe ? (
                    <div className="p-2 rounded-xl bg-black/5 dark:bg-black/25">
                      <MessageRichText
                        content={msg.content}
                        roomMembers={roomMembers}
                        currentUserId={currentUser.id}
                        isMe={isMe}
                        highlightQuery={searchQuery}
                        onSelectUserProfile={onSelectUserProfile}
                      />
                    </div>
                  ) : revealedViewOnceText !== null ? (
                    <div className="space-y-1.5 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-[#008069] dark:text-[#07C160]">
                        <span>열람 완료 · 창을 닫으면 보안 잠금됩니다</span>
                        <button
                          type="button"
                          onClick={() => setRevealedViewOnceText(null)}
                          className="inline-flex items-center gap-0.5 hover:underline cursor-pointer"
                        >
                          <EyeOff className="h-3 w-3" />
                          <span>숨기기</span>
                        </button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words text-neutral-900 dark:text-white">
                        {revealedViewOnceText}
                      </p>
                    </div>
                  ) : (msg.viewedByUserIds ?? []).includes(currentUser.id) ? (
                    <div className="px-2.5 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800/80 text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                      <EyeOff className="h-3.5 w-3.5 shrink-0" />
                      <span>1회 열람 완료 (보안 잠금됨)</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-neutral-600 dark:text-neutral-300">
                        열람 즉시 기록되며 이후 다시 확인할 수 없습니다.
                      </p>
                      <button
                        type="button"
                        disabled={openingViewOnce || !onOpenViewOnce}
                        onClick={async () => {
                          if (!onOpenViewOnce || openingViewOnce) return;
                          setOpeningViewOnce(true);
                          setViewOnceError(null);
                          try {
                            const res = await onOpenViewOnce(msg.id);
                            if (res.ok && typeof res.content === 'string') {
                              setRevealedViewOnceText(res.content);
                            } else {
                              setViewOnceError(res.error || '비밀 메시지를 열 수 없습니다.');
                            }
                          } finally {
                            setOpeningViewOnce(false);
                          }
                        }}
                        className="h-8 px-3 rounded-xl bg-[#075E54] hover:bg-[#054a42] disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>{openingViewOnce ? '잠금 해제 중...' : '1회 열람하기'}</span>
                      </button>
                      {viewOnceError && (
                        <p className="text-[11px] text-red-600 dark:text-red-400">{viewOnceError}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <MessageRichText
                  content={msg.content}
                  roomMembers={roomMembers}
                  currentUserId={currentUser.id}
                  isMe={isMe}
                  highlightQuery={searchQuery}
                  onSelectUserProfile={onSelectUserProfile}
                />
              )
            )}

            {isStarred && !msg.deleted && (
              <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                <span>책갈피됨</span>
              </div>
            )}

            {quickAnalysis?.open && !msg.deleted && (
              <div className="mt-2 p-2 rounded-xl bg-black/5 dark:bg-black/25 text-xs leading-relaxed space-y-1">
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold opacity-75">
                  <span>빠른 번역 · 요약</span>
                  <button
                    type="button"
                    onClick={() => setQuickAnalysis(null)}
                    className="hover:underline cursor-pointer"
                  >
                    닫기
                  </button>
                </div>
                {quickAnalysis.loading ? (
                  <div className="text-[11px] opacity-75">분석 중...</div>
                ) : quickAnalysis.error ? (
                  <div className="text-[11px] text-red-600 dark:text-red-400">{quickAnalysis.error}</div>
                ) : (
                  <div className="text-xs whitespace-pre-wrap">{quickAnalysis.text}</div>
                )}
              </div>
            )}
          </div>

          {/* Unread Digit + Read Receipt + Expiring Timer + Timestamp */}
          <div
            className={`relative flex flex-col shrink-0 text-[10px] leading-tight ${
              isMe ? 'items-end' : 'items-start'
            }`}
          >
            {!msg.deleted && room.type !== 'self' && (
              <button
                type="button"
                onClick={() => onToggleReadReceipt(msg.id)}
                aria-label={unreadCount > 0 ? `안 읽음 ${unreadCount}명 상세 보기` : '읽음 확인 상세 보기'}
                title="누가 읽었는지 확인"
                className="cursor-pointer hover:underline flex items-center gap-0.5"
              >
                {unreadCount > 0 ? (
                  <>
                    {isMe && <Check className="h-3 w-3 text-neutral-400" />}
                    <span className="font-bold text-[#D97706] dark:text-[#FACC15] tabular-nums">
                      {unreadCount}
                    </span>
                  </>
                ) : isMe ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-[#008069] dark:text-[#53BDEB] font-semibold">
                    <CheckCheck className="h-3.5 w-3.5" aria-label="모두 읽음" />
                  </span>
                ) : null}
              </button>
            )}

            {msg.expiresAt && !msg.deleted && (
              <span
                title="사라지는 메시지 적용됨"
                className="inline-flex items-center gap-0.5 text-[9px] text-[#008069] dark:text-[#07C160]"
              >
                <Clock className="h-2.5 w-2.5" />
              </span>
            )}

            {msg.editedAt && !msg.deleted && (
              <span className="text-[9px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                (수정됨)
              </span>
            )}

            {showTimestamp && (
              <span className="text-neutral-700/80 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                {formatKoreanTime(msg.createdAt)}
              </span>
            )}

            {readReceiptOpen && (
              <ReadReceiptPopover
                message={msg}
                roomMemberIds={room.memberIds}
                usersById={usersById}
                alignRight={isMe}
                onClose={() => onToggleReadReceipt(msg.id)}
              />
            )}
          </div>

          {/* Hover Quick Action Bar */}
          {!msg.deleted && !editing && (
            <div
              className={`absolute -top-8 pb-1.5 ${
                isMe ? 'right-0' : 'left-0'
              } z-30 transition-opacity ${
                reactionPickerOpen
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
              }`}
            >
              <div className="flex items-center gap-0.5 bg-white/95 dark:bg-neutral-800/95 border border-black/10 dark:border-neutral-700 rounded-lg px-1 py-0.5 shadow-sm">
              {['👍', '❤️', '😂', '✅'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction(msg.id, emoji)}
                  aria-label={`${emoji} 빠른 공감`}
                  title={`${emoji} 공감`}
                  className="h-6 w-6 rounded flex items-center justify-center text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onToggleReactionPicker(msg.id)}
                aria-label="공감 이모지 더보기"
                title="공감 더보기"
                className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onReply(msg)}
                aria-label="답장하기"
                title="답장"
                className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              >
                <Reply className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onToggleStar(msg.id)}
                aria-label={isStarred ? '책갈피 해제' : '중요 메시지 책갈피'}
                title="책갈피"
                className={`h-6 w-6 rounded flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer ${
                  isStarred ? 'text-amber-500' : 'text-neutral-600 dark:text-neutral-300'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-amber-400' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => onForward(msg.id)}
                aria-label="메시지 전달"
                title="전달"
                className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              >
                <Forward className="h-3.5 w-3.5" />
              </button>
              {onSendMessageToMail && !msg.viewOnce && (
                <button
                  type="button"
                  onClick={() => onSendMessageToMail(msg)}
                  aria-label="이 메시지를 bmail로 발송"
                  title="bmail 발송"
                  className="h-6 px-1.5 rounded flex items-center gap-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
                >
                  <Mail className="h-3 w-3" />
                  <span className="hidden sm:inline">메일 발송</span>
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(msg.content);
                    setEditing(true);
                  }}
                  aria-label="메시지 수정"
                  title="수정"
                  className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenNoticeModal(msg.content, msg.id)}
                aria-label="이 메시지를 공지로 등록"
                title="공지로 등록"
                className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onCopy(msg)}
                aria-label="메시지 복사"
                title="복사"
                className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onStartSelection(msg.id)}
                aria-label="다중 선택 모드 시작"
                title="선택"
                className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              >
                <CheckSquare className="h-3.5 w-3.5" />
              </button>
              {onTranslateOrSummarize && (
                <button
                  type="button"
                  onClick={handleQuickTranslateSummary}
                  aria-label="메시지 번역 또는 요약"
                  title="번역 · 요약"
                  className="h-6 px-1.5 rounded flex items-center gap-1 text-[10px] font-semibold text-[#008069] dark:text-[#07C160] hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
                >
                  <Languages className="h-3 w-3" />
                  <span className="hidden sm:inline">번역·요약</span>
                </button>
              )}
              {onTriggerIntegration && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onTriggerIntegration({
                        system: 'SGW',
                        menuKey: 'meeting-memo',
                        title: 'SGW 미팅메모로 메시지 연동',
                        description: msg.content.slice(0, 120),
                        actionLabel: 'SGW 미팅메모 열기',
                        payload: {
                          action: 'create',
                          content: msg.content,
                          sourceRoomId: room.id,
                          sourceMessageId: msg.id,
                        },
                      })
                    }
                    aria-label="이 메시지를 SGW 미팅메모로 연동"
                    title="미팅메모 연동"
                    className="h-6 px-1.5 rounded flex items-center gap-1 text-[10px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
                  >
                    <NotebookPen className="h-3 w-3" />
                    <span className="hidden sm:inline">미팅메모</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onTriggerIntegration({
                        system: 'SGW',
                        menuKey: 'project-calendar',
                        title: msg.content.slice(0, 60) || '프로젝트 달력 일정 연동',
                        description: msg.content.slice(0, 120),
                        actionLabel: '프로젝트 달력 열기',
                        payload: {
                          action: 'create',
                          title: msg.content.slice(0, 60),
                        },
                      })
                    }
                    aria-label="이 메시지를 프로젝트 달력에 연동"
                    title="달력 연동"
                    className="h-6 px-1.5 rounded flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
                  >
                    <Calendar className="h-3 w-3" />
                    <span className="hidden sm:inline">달력</span>
                  </button>
                </>
              )}
              {isMe && (
                <>
                  <button
                    type="button"
                    onClick={() => onRecallMessage(msg.id)}
                    aria-label="메시지 회수"
                    title="회수 (다시 편집 가능)"
                    className="h-6 w-6 rounded flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:text-amber-600 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteMessage(msg.id)}
                    aria-label="메시지 삭제"
                    title="삭제"
                    className="h-6 w-6 rounded flex items-center justify-center text-neutral-500 hover:text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}

              {reactionPickerOpen && (
                <div
                  className={`absolute top-full mt-1 ${
                    isMe ? 'right-0' : 'left-0'
                  } z-30 flex items-center gap-1 p-1.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-lg`}
                >
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onToggleReaction(msg.id, emoji);
                        onToggleReactionPicker(msg.id);
                      }}
                      className="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center justify-center text-base cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              </div>
            </div>
          )}
        </div>

        {Object.keys(msg.reactions).length > 0 && !msg.deleted && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(msg.reactions).map(([emoji, userIds]) => {
              const reacted = userIds.includes(currentUser.id);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction(msg.id, emoji)}
                  className={`h-6 px-2 rounded-full text-xs flex items-center gap-1 border transition-colors cursor-pointer ${
                    reacted
                      ? 'bg-[#CEF5C8] dark:bg-[#005C4B] border-[#008069]/35 text-[#111B21] dark:text-white font-semibold'
                      : 'bg-white/90 dark:bg-neutral-800 border-black/10 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200'
                  }`}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
