import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  BarChart3,
  BellRing,
  Calendar,
  CalendarClock,
  CalendarPlus,
  Check,
  Dices,
  Download,
  EyeOff,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  Mail,
  Megaphone,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Siren,
  Smile,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  applyComposerTriggerReplacement,
  detectComposerTrigger,
  detectInChatQuickIntent,
  formatVoiceDuration,
  parseSgwIntegrationCommand,
  SEDMS_MENU_CATALOG,
  summarizeRoomMessagesPure,
  type ActiveComposerTrigger,
  type InChatMailDraft,
  type InChatQuickIntent,
} from '../../shared/chatLogic';
import {
  calculateLeaveDays,
  executeLeaveHistoryQuery,
  formatFileSize,
  formatKoreanTime,
  parseChatLeaveCommand,
  type LeaveHistoryQueryResult,
} from '../../shared/logic';
import { SHARE_PROVIDER_LABELS } from '../../shared/voiceAnalysis';
import { NAS_DEFAULT_FOLDERS } from '../../shared/nasShare';
import {
  createMicAnalyser,
  dataUrlToBlobUrl,
  mapSpeechRecognitionError,
  pickSupportedAudioMimeType,
  playDataUrlWithWebAudio,
  playSynthesizedVoiceWithWebAudio,
  playVoiceCueTone,
  unlockAudioPlayback,
  type MicAnalyserHandle,
  type WebAudioPlaybackHandle,
} from '../../utils/voiceAudio';
import {
  WORK_EMOTICONS,
  type ChatRoom,
  type IntegrationActionSummary,
  type LeaveRequest,
  type LeaveType,
  type MailMessage,
  type Message,
  type NasFolderInfo,
  type Notice,
  type NotificationItem,
  type PollData,
  type ScheduleCardData,
  type ScheduledMessageItem,
  type ShareProvider,
  type SharedFileItem,
  type User,
  type VoiceAnalysisResult,
  type VoiceAttachment,
} from '../../types/client';
import { Avatar } from '../Avatar';
import {
  InChatAlertsPanel,
  InChatMailPanel,
  InChatSummaryPanel,
} from './InChatActionPanels';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultEventLike {
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

interface SlashCommandOption {
  id: string;
  command: string;
  label: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommandOption[] = [
  { id: 'cmd-notice', command: '/공지', label: '/공지', description: '채팅방 상단 공지사항 등록' },
  { id: 'cmd-urgent-notice', command: '/긴급공지', label: '/긴급공지', description: '전 회원 긴급재난문자 공지 즉시 발송' },
  { id: 'cmd-nas', command: '/나스', label: '/나스', description: '100GB+ 사내 NAS 복사 · 외부 링크 공유' },
  { id: 'cmd-mail', command: '/메일', label: '/메일', description: '톡 내 bmail·빅메일 수신함·요약 바로 열기' },
  { id: 'cmd-mail-compose', command: '/메일쓰기', label: '/메일쓰기', description: '톡에서 바로 bmail·빅메일·NAS 첨부 발송' },
  { id: 'cmd-alerts', command: '/알림', label: '/알림', description: '미확인 공지·메일·업무 통합 알림 보기' },
  { id: 'cmd-summary', command: '/요약', label: '/요약', description: '현재 채팅방 대화 핵심 요약 생성' },
  { id: 'cmd-poll', command: '/투표', label: '/투표', description: '실시간 팀 투표 만들기' },
  { id: 'cmd-schedule', command: '/일정', label: '/일정', description: '일정 공유 카드(참석/미정/불참) 올리기' },
  { id: 'cmd-draw', command: '/추첨', label: '/추첨', description: '랜덤 추첨 · 당번 정하기 실행' },
  { id: 'cmd-scheduled-msg', command: '/예약', label: '/예약', description: '메시지 예약 전송 설정' },
  { id: 'cmd-view-once', command: '/1회열람', label: '/1회열람', description: '수신자가 한 번만 볼 수 있는 비밀 메시지 전송' },
  { id: 'cmd-export', command: '/대화저장', label: '/대화저장', description: '현재 대화방 내용 .txt 파일로 저장' },
  { id: 'cmd-file', command: '/파일', label: '/파일', description: '파일 첨부 선택창 열기' },
  { id: 'cmd-leave-info', command: '/내연차', label: '/내연차', description: '내 잔여 연차 정보 및 과거 기록 조회' },
  { id: 'cmd-leave-history', command: '/연차조회', label: '/연차조회', description: '대화로 과거 연차·휴가 스케줄 조회' },
  { id: 'cmd-leave', command: '/연차', label: '/연차', description: '대화형 본인 연차 등록 폼 열기' },
  ...SEDMS_MENU_CATALOG.filter((m) => m.menuKey !== 'leave' && m.menuKey !== 'bmail').map((m) => ({
    id: `cmd-${m.menuKey}`,
    command: m.slashCommand,
    label: m.slashCommand,
    description: `${m.system} · ${m.label}`,
  })),
];

const AI_VOICE_QUICK_CHIPS = [
  '최근 대화 요약해줘',
  'bmail·빅메일 확인해줘',
  '100GB NAS 공유 열어줘',
  '긴급 공지 등록해줘',
  '내 연차 몇일 남았어?',
  '내일 연차 등록',
  '프로젝트 달력 열어줘',
  '오늘 회의록 미팅메모 작성',
];

const LEAVE_TYPES: LeaveType[] = ['연차', '오전반차', '오후반차', '병가', '공가'];

interface ChatComposerProps {
  roomId: string;
  roomName?: string;
  roomType: ChatRoom['type'];
  currentUser?: User;
  leaves?: LeaveRequest[];
  roomMessages?: Message[];
  mails?: MailMessage[];
  notices?: Notice[];
  notifications?: NotificationItem[];
  draftText: string;
  draftSavedAt?: number | null;
  roomMembers: User[];
  colleagues: User[];
  usersById: Record<string, User>;
  replyTo: Message | null;
  todayDate: string;
  openLeaveDraftTrigger: number;
  openLeaveLookupTrigger?: number;
  focusNonce?: number;
  onDraftChange: (text: string) => void;
  onClearReply: () => void;
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
  onUploadFile: (file: File, caption?: string) => Promise<void>;
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
  onOpenNoticeModal: (
    initialContent?: string,
    messageId?: string,
    options?: { urgent?: boolean; initialTitle?: string },
  ) => void;
  onOpenPollModal: () => void;
  onGoToLeaveTab: () => void;
  onTypingChange: (isTyping: boolean) => void;
  apiFetch?: (url: string, init?: RequestInit) => Promise<Response>;
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
  onAcknowledgeNotice?: (noticeId: string) => Promise<void> | void;
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onOpenRoom?: (roomId: string) => void;
  onExportTranscript?: () => void;
  externalLargeLinkNonce?: number;
  roomFiles?: SharedFileItem[];
  externalMailDraft?: InChatMailDraft | null;
  externalMailNonce?: number;
  bmailBridgeStatus?: { bmailBaseUrlConfigured: boolean; embedSupported: boolean } | null;
  onSyncRemoteBmail?: () => Promise<{ ok: boolean; importedCount?: number; error?: string }>;
  onLaunchBmailSso?: () => Promise<{ ok: boolean; launchUrl?: string; error?: string }>;
  chunkUploadProgress?: {
    filename: string;
    percent: number;
    chunkIndex: number;
    totalChunks: number;
  } | null;
}

export function ChatComposer({
  roomId,
  roomName = '채팅방',
  roomType,
  currentUser,
  leaves = [],
  roomMessages = [],
  mails = [],
  notices = [],
  notifications = [],
  draftText,
  draftSavedAt = null,
  roomMembers,
  colleagues,
  usersById,
  replyTo,
  todayDate,
  openLeaveDraftTrigger,
  openLeaveLookupTrigger = 0,
  focusNonce = 0,
  onDraftChange,
  onClearReply,
  onSendMessage,
  onUploadFile,
  onRegisterLeaveFromChat,
  onTriggerIntegration,
  onOpenNoticeModal,
  onOpenPollModal,
  onGoToLeaveTab,
  onTypingChange,
  apiFetch,
  scheduledMessages = [],
  onScheduleMessage,
  onCancelScheduledMessage,
  onShareLargeLink,
  onShareNasFile,
  onRunRandomDraw,
  onOpenMail,
  onMailSent,
  onAcknowledgeNotice,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenRoom,
  onExportTranscript,
  externalLargeLinkNonce = 0,
  roomFiles = [],
  externalMailDraft = null,
  externalMailNonce = 0,
  bmailBridgeStatus = null,
  onSyncRemoteBmail,
  onLaunchBmailSso,
  chunkUploadProgress = null,
}: ChatComposerProps) {
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showEmoticons, setShowEmoticons] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedAttachment[]>([]);
  const stagedFilesRef = useRef<StagedAttachment[]>([]);
  stagedFilesRef.current = stagedFiles;
  const [sending, setSending] = useState(false);
  const [cursorPos, setCursorPos] = useState(draftText.length);
  const [activeIndex, setActiveIndex] = useState(0);

  // Voice / Conversational Command Bar state
  const [showVoiceCmdBar, setShowVoiceCmdBar] = useState(false);
  const [voiceCmdListening, setVoiceCmdListening] = useState(false);
  const [voiceCmdText, setVoiceCmdText] = useState('');
  const [voiceCmdStatus, setVoiceCmdStatus] = useState<string | null>(null);
  const speechRecRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const cmdRecorderRef = useRef<MediaRecorder | null>(null);
  const cmdStreamRef = useRef<MediaStream | null>(null);
  const cmdChunksRef = useRef<Blob[]>([]);

  // Voice Clip Recording + Preview Playback + Live Mic Analyser
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordWaveform, setRecordWaveform] = useState<number[]>([35, 60, 48, 72]);
  const [recordTranscript, setRecordTranscript] = useState('');
  const [micStatus, setMicStatus] = useState<'idle' | 'acquiring' | 'active' | 'error'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [recordedPreview, setRecordedPreview] = useState<{
    audioDataUrl?: string;
    mimeType?: string;
    durationSec: number;
    waveform: number[];
    transcript: string;
  } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const recordTimerRef = useRef<number | null>(null);
  const recordStartAtRef = useRef<number>(0);
  const waveSampleTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<MicAnalyserHandle | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const previewWebAudioRef = useRef<WebAudioPlaybackHandle | null>(null);
  const previewStopTimerRef = useRef<number | null>(null);

  // Scheduled Sending Popover
  const [showSchedulePopover, setShowSchedulePopover] = useState(false);
  const [scheduleContent, setScheduleContent] = useState('');
  const [scheduleAtInput, setScheduleAtInput] = useState(() =>
    toLocalDatetimeInputValue(new Date(Date.now() + 5 * 60_000)),
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [schedulingSubmitting, setSchedulingSubmitting] = useState(false);

  // 100GB-Scale NAS Folder Copy & External Download Link Panel
  const [showLargeLinkPanel, setShowLargeLinkPanel] = useState(false);
  const [largeShareMode, setLargeShareMode] = useState<'nas' | 'cloud'>('nas');
  const [nasFolders, setNasFolders] = useState<NasFolderInfo[]>(
    NAS_DEFAULT_FOLDERS.map((folder) => ({ folder, files: [] })),
  );
  const [selectedNasFolder, setSelectedNasFolder] = useState<string>(NAS_DEFAULT_FOLDERS[0]);
  const [selectedSourceNasPath, setSelectedSourceNasPath] = useState('');
  const [nasLocalFile, setNasLocalFile] = useState<File | null>(null);
  const [loadingNasFolders, setLoadingNasFolders] = useState(false);
  const [largeFilename, setLargeFilename] = useState('');
  const [largeUrl, setLargeUrl] = useState('');
  const [largeSizeValue, setLargeSizeValue] = useState('100');
  const [largeSizeUnit, setLargeSizeUnit] = useState<'MB' | 'GB' | 'TB'>('GB');
  const [largeShareProvider, setLargeShareProvider] = useState<ShareProvider>('s3');
  const [largeExpiresDays, setLargeExpiresDays] = useState('7');
  const [largePasscode, setLargePasscode] = useState('');
  const [largeMaxDownloads, setLargeMaxDownloads] = useState('');
  const [largeCaption, setLargeCaption] = useState('');
  const [largeError, setLargeError] = useState<string | null>(null);
  const [sharingLargeLink, setSharingLargeLink] = useState(false);
  const nasFileInputRef = useRef<HTMLInputElement | null>(null);

  // KakaoTalk Schedule Card & Random Draw Panels
  const [showScheduleCardPanel, setShowScheduleCardPanel] = useState(false);
  const [scTitle, setScTitle] = useState('');
  const [scDateTime, setScDateTime] = useState('내일 오전 10:00');
  const [scLocation, setScLocation] = useState('');
  const [scMemo, setScMemo] = useState('');
  const [scError, setScError] = useState<string | null>(null);
  const [submittingScheduleCard, setSubmittingScheduleCard] = useState(false);

  const [showDrawPanel, setShowDrawPanel] = useState(false);
  const [drawTopic, setDrawTopic] = useState('회의 발표자 · 당번 추첨');
  const [drawCandidatesText, setDrawCandidatesText] = useState('');
  const [drawError, setDrawError] = useState<string | null>(null);
  const [submittingDraw, setSubmittingDraw] = useState(false);

  const [chatLeaveDraft, setChatLeaveDraft] = useState<{
    open: boolean;
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId: string;
    reason: string;
    error?: string;
    submitting?: boolean;
  } | null>(null);
  const [leaveLookupPanel, setLeaveLookupPanel] = useState<{
    open: boolean;
    question: string;
    result: LeaveHistoryQueryResult;
  } | null>(null);

  // Unified In-Chat Hub Panels (Mail, Alerts, Conversation Summary)
  const [inChatMailTab, setInChatMailTab] = useState<'inbox' | 'compose' | null>(null);
  const [mailDraftState, setMailDraftState] = useState<{
    draft: InChatMailDraft | null;
    nonce: number;
  }>({ draft: null, nonce: 0 });
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [showInChatAlerts, setShowInChatAlerts] = useState(false);
  const [roomSummaryPanel, setRoomSummaryPanel] = useState<{
    open: boolean;
    loading: boolean;
    summaryText: string;
    bullets: string[];
    messageCount: number;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  const stopPreviewPlayback = () => {
    if (previewStopTimerRef.current) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
    previewWebAudioRef.current?.stop();
    previewWebAudioRef.current = null;
    setPreviewPlaying(false);
  };

  useEffect(() => {
    setShowPlusMenu(false);
    setShowEmoticons(false);
    setShowSchedulePopover(false);
    setShowLargeLinkPanel(false);
    setShowScheduleCardPanel(false);
    setShowDrawPanel(false);
    setInChatMailTab(null);
    setViewOnceMode(false);
    setShowInChatAlerts(false);
    setRoomSummaryPanel(null);
    setActiveIndex(0);
    setVoiceCmdStatus(null);
    setLeaveLookupPanel(null);
    stopPreviewPlayback();
    setRecordedPreview(null);
    setMicStatus('idle');
    setMicError(null);
    stopVoiceCommandListening();
    void cancelVoiceRecording();
  }, [roomId]);

  useEffect(() => {
    if (!showLargeLinkPanel || !apiFetch) return;
    let active = true;
    setLoadingNasFolders(true);
    apiFetch('/api/nas/folders')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { folders?: NasFolderInfo[] } | null) => {
        if (!active || !data?.folders?.length) return;
        setNasFolders(data.folders);
        setSelectedNasFolder((prev) =>
          data.folders!.some((f) => f.folder === prev) ? prev : data.folders![0].folder,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingNasFolders(false);
      });
    return () => {
      active = false;
    };
  }, [showLargeLinkPanel, apiFetch]);

  useEffect(() => {
    if (externalLargeLinkNonce > 0) {
      setShowPlusMenu(false);
      setShowEmoticons(false);
      setLargeShareMode('nas');
      setShowLargeLinkPanel(true);
    }
  }, [externalLargeLinkNonce]);

  useEffect(() => {
    if (externalMailNonce > 0 && externalMailDraft) {
      closeInlinePanels('mail');
      setMailDraftState({ draft: externalMailDraft, nonce: externalMailNonce });
      setInChatMailTab('compose');
    }
  }, [externalMailNonce, externalMailDraft]);

  useEffect(() => {
    if (focusNonce > 0) {
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        const len = textareaRef.current?.value.length ?? 0;
        textareaRef.current?.setSelectionRange(len, len);
      });
    }
  }, [focusNonce]);

  useEffect(() => {
    if (openLeaveDraftTrigger > 0) {
      openInlineLeaveDraft();
    }
  }, [openLeaveDraftTrigger]);

  useEffect(() => {
    if (openLeaveLookupTrigger > 0) {
      runLeaveLookupInChat('내 연차 정보 및 과거 기록');
    }
  }, [openLeaveLookupTrigger]);

  useEffect(() => {
    return () => {
      for (const sf of stagedFilesRef.current) {
        if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (waveSampleTimerRef.current) window.clearInterval(waveSampleTimerRef.current);
      stopPreviewPlayback();
      micAnalyserRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      cmdStreamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        speechRecRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const stopCmdFallbackCapture = async () => {
    const mr = cmdRecorderRef.current;
    cmdRecorderRef.current = null;
    const stream = cmdStreamRef.current;
    cmdStreamRef.current = null;
    if (!mr || mr.state === 'inactive') {
      stream?.getTracks().forEach((t) => t.stop());
      cmdChunksRef.current = [];
      return;
    }
    const audioDataUrl = await new Promise<string | undefined>((resolve) => {
      let settled = false;
      const done = (url?: string) => {
        if (settled) return;
        settled = true;
        stream?.getTracks().forEach((t) => t.stop());
        resolve(url);
      };
      const safetyTimer = window.setTimeout(() => done(undefined), 900);
      mr.onstop = () => {
        window.clearTimeout(safetyTimer);
        const blob = new Blob(cmdChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        cmdChunksRef.current = [];
        if (blob.size > 0) {
          const reader = new FileReader();
          reader.onloadend = () =>
            done(typeof reader.result === 'string' ? reader.result : undefined);
          reader.onerror = () => done(undefined);
          reader.readAsDataURL(blob);
        } else {
          done(undefined);
        }
      };
      try {
        if (typeof mr.requestData === 'function') mr.requestData();
        mr.stop();
      } catch {
        window.clearTimeout(safetyTimer);
        done(undefined);
      }
    });

    if (audioDataUrl && apiFetch) {
      setVoiceCmdStatus('녹음된 음성을 AI 서버로 분석하는 중입니다...');
      const res = await apiFetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioDataUrl, mimeType: mr.mimeType || 'audio/webm' }),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as { transcript?: string };
        if (data.transcript?.trim()) {
          setVoiceCmdText(data.transcript.trim());
          setVoiceCmdStatus('음성 텍스트 변환이 완료되었습니다. 실행 버튼을 누르세요.');
          return;
        }
      }
      setVoiceCmdStatus('음성을 텍스트로 수정 후 실행해 주세요.');
    }
  };

  const stopVoiceCommandListening = () => {
    try {
      speechRecRef.current?.stop();
    } catch {
      // ignore
    }
    speechRecRef.current = null;
    setVoiceCmdListening(false);
    void stopCmdFallbackCapture();
  };

  const startVoiceCommandListening = async () => {
    void unlockAudioPlayback();
    setShowPlusMenu(false);
    setShowEmoticons(false);
    setShowVoiceCmdBar(true);

    if (voiceCmdListening) {
      playVoiceCueTone('stop');
      stopVoiceCommandListening();
      return;
    }

    const startCmdAudioFallback = async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setVoiceCmdListening(false);
        setVoiceCmdStatus('음성 마이크 인식을 지원하지 않는 환경입니다. 아래 명령어 입력 또는 빠른 칩으로 바로 실행하세요.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        cmdStreamRef.current = stream;
        const mimeType = pickSupportedAudioMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 48000 });
        cmdChunksRef.current = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) cmdChunksRef.current.push(ev.data);
        };
        recorder.start(200);
        cmdRecorderRef.current = recorder;
        setVoiceCmdListening(true);
        playVoiceCueTone('start');
        setVoiceCmdStatus('음성 녹음 중... 말씀 후 [중지]를 누르면 AI 음성 분석으로 자동 변환됩니다.');
      } catch {
        setVoiceCmdListening(false);
        setVoiceCmdStatus('마이크 권한을 확인할 수 없어 텍스트 입력 모드로 대기 중입니다.');
      }
    };

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      await startCmdAudioFallback();
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = 0; i < ev.results.length; i += 1) {
          transcript += ev.results[i]?.[0]?.transcript ?? '';
        }
        if (transcript.trim()) {
          setVoiceCmdText(transcript.trim());
        }
      };
      rec.onerror = (ev) => {
        setVoiceCmdListening(false);
        setVoiceCmdStatus(mapSpeechRecognitionError(ev?.error ?? ''));
      };
      rec.onend = () => {
        setVoiceCmdListening(false);
      };
      speechRecRef.current = rec;
      playVoiceCueTone('start');
      rec.start();
      setVoiceCmdListening(true);
      setVoiceCmdStatus('듣고 있습니다... 예: "내일 연차 등록", "프로젝트 달력 열어줘", "미팅메모 작성"');
    } catch {
      await startCmdAudioFallback();
    }
  };

  const runLeaveLookupInChat = (rawQuestion: string, forceMode = false): boolean => {
    const actor = currentUser ?? Object.values(usersById)[0];
    if (!actor) return false;
    const allUsers = Object.values(usersById);
    const result = executeLeaveHistoryQuery(rawQuestion, leaves, allUsers, actor, todayDate, {
      forceConversationMode: forceMode,
    });
    if (!result.query.matched) return false;
    setLeaveLookupPanel({
      open: true,
      question: rawQuestion.trim(),
      result,
    });
    return true;
  };

  const closeInlinePanels = (
    keep?:
      | 'mail'
      | 'alerts'
      | 'summary'
      | 'nas'
      | 'schedule_card'
      | 'draw'
      | 'leave_draft'
      | 'leave_lookup'
      | 'scheduled_msg',
  ) => {
    setShowPlusMenu(false);
    setShowEmoticons(false);
    if (keep !== 'mail') setInChatMailTab(null);
    if (keep !== 'alerts') setShowInChatAlerts(false);
    if (keep !== 'summary') setRoomSummaryPanel(null);
    if (keep !== 'nas') setShowLargeLinkPanel(false);
    if (keep !== 'schedule_card') setShowScheduleCardPanel(false);
    if (keep !== 'draw') setShowDrawPanel(false);
    if (keep !== 'leave_draft') setChatLeaveDraft(null);
    if (keep !== 'leave_lookup') setLeaveLookupPanel(null);
    if (keep !== 'scheduled_msg') setShowSchedulePopover(false);
  };

  const openInChatRoomSummary = async () => {
    closeInlinePanels('summary');
    const localFallback = summarizeRoomMessagesPure(roomName, roomMessages, usersById);
    setRoomSummaryPanel({
      open: true,
      loading: Boolean(apiFetch),
      ...localFallback,
    });
    if (!apiFetch) return;
    const res = await apiFetch(`/api/rooms/${roomId}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (res && res.ok) {
      const data = (await res.json()) as {
        summaryText?: string;
        bullets?: string[];
        messageCount?: number;
      };
      setRoomSummaryPanel({
        open: true,
        loading: false,
        summaryText: data.summaryText || localFallback.summaryText,
        bullets: data.bullets?.length ? data.bullets : localFallback.bullets,
        messageCount: data.messageCount ?? localFallback.messageCount,
      });
    } else {
      setRoomSummaryPanel((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  const runInChatQuickIntent = async (intent: InChatQuickIntent): Promise<string> => {
    switch (intent.kind) {
      case 'notice':
        closeInlinePanels();
        onOpenNoticeModal(intent.prefillContent, undefined, {
          urgent: intent.urgent,
          initialTitle: intent.prefillTitle,
        });
        return intent.urgent
          ? '긴급 재난문자 공지 등록창을 열었습니다.'
          : '채팅방 공지사항 등록창을 열었습니다.';
      case 'poll':
        closeInlinePanels();
        onOpenPollModal();
        return '팀 투표 만들기 창을 열었습니다.';
      case 'schedule_card':
        openScheduleCardCreator();
        return '일정 공유·참석 확인 카드 작성창을 열었습니다.';
      case 'draw':
        openDrawCreator();
        return '랜덤 추첨 · 당번 정하기 패널을 열었습니다.';
      case 'nas':
        closeInlinePanels('nas');
        setLargeError(null);
        setLargeShareMode(onShareNasFile ? 'nas' : 'cloud');
        setShowLargeLinkPanel(true);
        return '100GB+ NAS 폴더 복사 및 외부 다운로드 링크 공유 패널을 열었습니다.';
      case 'file':
        closeInlinePanels();
        fileInputRef.current?.click();
        return '파일 첨부 선택창을 열었습니다.';
      case 'mail':
        closeInlinePanels('mail');
        setInChatMailTab(intent.tab);
        return intent.tab === 'compose'
          ? '톡 내 bmail·빅메일 바로 작성 패널을 열었습니다.'
          : '톡 내 bmail·빅메일 수신함 및 요약 패널을 열었습니다.';
      case 'alerts':
        closeInlinePanels('alerts');
        setShowInChatAlerts(true);
        return '톡 내 통합 알림 브리핑 패널을 열었습니다.';
      case 'summary':
        await openInChatRoomSummary();
        return '현재 채팅방의 최근 대화 핵심 요약을 생성했습니다.';
      case 'scheduled_msg':
        closeInlinePanels('scheduled_msg');
        setScheduleContent((prev) => prev || draftText.trim());
        setScheduleAtInput(toLocalDatetimeInputValue(new Date(Date.now() + 5 * 60_000)));
        setScheduleError(null);
        setShowSchedulePopover(true);
        return '메시지 예약 전송 설정창을 열었습니다.';
      case 'view_once':
        closeInlinePanels();
        setViewOnceMode(true);
        window.requestAnimationFrame(() => textareaRef.current?.focus());
        return '1회 열람 비밀 메시지 모드를 켰습니다. 메시지를 입력해 전송하세요.';
      case 'export_transcript':
        closeInlinePanels();
        onExportTranscript?.();
        return '현재 채팅방 대화 내역을 .txt 파일로 저장했습니다.';
    }
  };

  const executeVoiceOrNaturalCommand = async (rawCommand: string) => {
    const trimmed = rawCommand.trim();
    if (!trimmed || sending) return;

    if (runLeaveLookupInChat(trimmed)) {
      setVoiceCmdStatus('내 연차 정보 및 과거 기록을 조회했습니다.');
      setVoiceCmdText('');
      stopVoiceCommandListening();
      return;
    }

    const parsedLeave = parseChatLeaveCommand(trimmed, todayDate, colleagues);
    if (parsedLeave.matched) {
      openInlineLeaveDraft(parsedLeave);
      setVoiceCmdStatus('음성/대화 연차 등록 양식을 열었습니다. 확인 후 등록을 완료하세요.');
      setVoiceCmdText('');
      stopVoiceCommandListening();
      return;
    }

    const quickIntent = detectInChatQuickIntent(trimmed);
    if (quickIntent) {
      const statusMsg = await runInChatQuickIntent(quickIntent);
      setVoiceCmdStatus(statusMsg);
      setVoiceCmdText('');
      stopVoiceCommandListening();
      return;
    }

    const parsedIntegration = parseSgwIntegrationCommand(trimmed);
    if (parsedIntegration.matched && onTriggerIntegration) {
      setSending(true);
      try {
        await onTriggerIntegration(parsedIntegration.summary);
        setVoiceCmdStatus(`실행 완료: ${parsedIntegration.summary.title}`);
        setVoiceCmdText('');
        stopVoiceCommandListening();
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    try {
      await onSendMessage({
        type: 'text',
        content: trimmed,
        replyToId: replyTo?.id ?? null,
      });
      setVoiceCmdStatus('일반 대화 메시지로 전송했습니다.');
      setVoiceCmdText('');
      onClearReply();
      stopVoiceCommandListening();
    } finally {
      setSending(false);
    }
  };

  const stopMediaCapture = (): Promise<{ audioDataUrl?: string; mimeType?: string }> => {
    return new Promise((resolve) => {
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      if (waveSampleTimerRef.current) {
        window.clearInterval(waveSampleTimerRef.current);
        waveSampleTimerRef.current = null;
      }
      micAnalyserRef.current?.stop();
      micAnalyserRef.current = null;

      const mr = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      const stream = mediaStreamRef.current;
      mediaStreamRef.current = null;

      const releaseStream = () => {
        try {
          stream?.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
      };

      if (mr && mr.state !== 'inactive') {
        const mimeType = mr.mimeType || 'audio/webm';
        let settled = false;
        const finishWithChunks = () => {
          if (settled) return;
          settled = true;
          const chunks = audioChunksRef.current;
          audioChunksRef.current = [];
          releaseStream();
          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size > 0) {
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve({
                audioDataUrl: typeof reader.result === 'string' ? reader.result : undefined,
                mimeType,
              });
            reader.onerror = () => resolve({ mimeType });
            reader.readAsDataURL(blob);
          } else {
            resolve({ mimeType });
          }
        };
        const safetyTimer = window.setTimeout(finishWithChunks, 900);
        mr.onstop = () => {
          window.clearTimeout(safetyTimer);
          finishWithChunks();
        };
        try {
          if (typeof mr.requestData === 'function') mr.requestData();
          mr.stop();
        } catch {
          window.clearTimeout(safetyTimer);
          finishWithChunks();
        }
      } else {
        audioChunksRef.current = [];
        releaseStream();
        resolve({});
      }
    });
  };

  const startVoiceRecording = async () => {
    if (recordingVoice) return;
    void unlockAudioPlayback();
    stopPreviewPlayback();
    setRecordedPreview(null);
    setShowPlusMenu(false);
    setShowEmoticons(false);
    setShowSchedulePopover(false);
    setShowLargeLinkPanel(false);

    recordStartAtRef.current = Date.now();
    setRecordingVoice(true);
    setRecordSeconds(1);
    setRecordWaveform([38, 66, 52, 82, 44]);
    setRecordTranscript('');
    setMicStatus('acquiring');
    setMicError(null);
    playVoiceCueTone('start');

    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    recordTimerRef.current = window.setInterval(() => {
      const elapsed = Math.max(1, Math.round((Date.now() - recordStartAtRef.current) / 1000));
      setRecordSeconds(elapsed);
    }, 250);

    if (waveSampleTimerRef.current) window.clearInterval(waveSampleTimerRef.current);
    waveSampleTimerRef.current = window.setInterval(() => {
      const analyser = micAnalyserRef.current;
      const bar = analyser
        ? Math.round(22 + analyser.readNormalizedLevel() * 76)
        : 24 + Math.floor(Math.random() * 54);
      setRecordWaveform((prev) => [...prev.slice(-19), bar]);
    }, 220);

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setMicStatus('error');
        setMicError('이 브라우저에서 마이크 녹음을 지원하지 않습니다. 음성 메모를 입력해 전송하거나 브라우저를 업데이트하세요.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      micAnalyserRef.current = createMicAnalyser(stream);
      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 48000 });
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onerror = () => {
        setMicStatus('error');
        setMicError('녹음기 오류가 발생했습니다. [다시 연결]을 눌러 주세요.');
      };
      recorder.start(200);
      mediaRecorderRef.current = recorder;
      setMicStatus('active');
    } catch (err) {
      const msg = err instanceof Error ? err.name : '';
      setMicStatus('error');
      setMicError(
        msg === 'NotAllowedError' || msg === 'PermissionDeniedError'
          ? '마이크 권한이 차단되어 있습니다. 주소창 권한에서 마이크를 허용한 뒤 [다시 연결]을 누르거나 아래 메모를 입력해 전송하세요.'
          : '마이크 장치를 연결할 수 없습니다. 장치 연결을 확인하거나 아래 메모를 입력해 음성 메시지로 전송할 수 있습니다.',
      );
    }
  };

  const cancelVoiceRecording = async () => {
    stopPreviewPlayback();
    setRecordedPreview(null);
    setMicStatus('idle');
    setMicError(null);
    if (!recordingVoice) {
      await stopMediaCapture();
      return;
    }
    playVoiceCueTone('stop');
    setRecordingVoice(false);
    setRecordSeconds(0);
    setRecordTranscript('');
    await stopMediaCapture();
  };

  const finishVoiceToPreview = async () => {
    if (!recordingVoice) return;
    playVoiceCueTone('stop');
    const durationSec = Math.max(
      1,
      Math.round((Date.now() - recordStartAtRef.current) / 1000) || recordSeconds,
    );
    const waveform = [...recordWaveform];
    const transcript = recordTranscript.trim();
    setRecordingVoice(false);
    setRecordSeconds(0);
    setMicStatus('idle');
    const { audioDataUrl, mimeType } = await stopMediaCapture();
    setRecordedPreview({
      audioDataUrl,
      mimeType,
      durationSec,
      waveform,
      transcript,
    });
  };

  const togglePreviewVoice = async () => {
    if (!recordedPreview) return;
    await unlockAudioPlayback();
    if (previewPlaying) {
      stopPreviewPlayback();
      return;
    }
    setPreviewPlaying(true);

    const finish = () => {
      stopPreviewPlayback();
    };

    if (recordedPreview.audioDataUrl) {
      const blobUrl = dataUrlToBlobUrl(recordedPreview.audioDataUrl);
      if (blobUrl) previewBlobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl ?? recordedPreview.audioDataUrl);
      audio.volume = 1.0;
      previewAudioRef.current = audio;
      audio.onended = finish;
      audio.onerror = async () => {
        const handle = await playDataUrlWithWebAudio(recordedPreview.audioDataUrl!, {
          onEnded: finish,
        });
        if (handle) {
          previewWebAudioRef.current = handle;
        } else {
          finish();
        }
      };
      try {
        await audio.play();
        return;
      } catch {
        const handle = await playDataUrlWithWebAudio(recordedPreview.audioDataUrl, {
          onEnded: finish,
        });
        if (handle) {
          previewWebAudioRef.current = handle;
          return;
        }
      }
    }

    const synthHandle = await playSynthesizedVoiceWithWebAudio(
      recordedPreview.durationSec,
      recordedPreview.transcript || 'preview',
      { onEnded: finish },
    );
    if (synthHandle) {
      previewWebAudioRef.current = synthHandle;
      return;
    }

    previewStopTimerRef.current = window.setTimeout(
      finish,
      Math.max(1200, recordedPreview.durationSec * 1000),
    );
  };

  const submitVoiceClipPayload = async (payload: {
    audioDataUrl?: string;
    mimeType?: string;
    durationSec: number;
    waveform: number[];
    manualTranscript: string;
  }) => {
    let resolvedTranscript = payload.manualTranscript;
    let analysis: VoiceAnalysisResult | undefined;

    if (apiFetch) {
      const res = await apiFetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioDataUrl: payload.audioDataUrl,
          mimeType: payload.mimeType,
          transcript: payload.manualTranscript || undefined,
          durationSec: payload.durationSec,
        }),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as {
          transcript?: string;
          analysis?: VoiceAnalysisResult;
        };
        if (data.transcript?.trim()) resolvedTranscript = data.transcript.trim();
        if (data.analysis) analysis = data.analysis;
      }
    }

    if (!resolvedTranscript) {
      resolvedTranscript = `음성 메시지 (${payload.durationSec}초)`;
    }

    await onSendMessage({
      type: 'voice',
      content: `[음성 메시지] ${resolvedTranscript}`,
      replyToId: replyTo?.id ?? null,
      voice: {
        durationSec: payload.durationSec,
        waveform: payload.waveform,
        transcript: resolvedTranscript,
        audioDataUrl: payload.audioDataUrl,
        mimeType: payload.mimeType,
        analysis,
      },
    });
    onClearReply();
  };

  const sendVoicePreview = async () => {
    if (!recordedPreview || sending) return;
    setSending(true);
    stopPreviewPlayback();
    const clip = recordedPreview;
    setRecordedPreview(null);
    setRecordTranscript('');
    try {
      await submitVoiceClipPayload({
        audioDataUrl: clip.audioDataUrl,
        mimeType: clip.mimeType,
        durationSec: clip.durationSec,
        waveform: clip.waveform,
        manualTranscript: clip.transcript.trim(),
      });
    } finally {
      setSending(false);
    }
  };

  const sendVoiceMessage = async () => {
    if (!recordingVoice || sending) return;
    setSending(true);
    playVoiceCueTone('stop');
    const durationSec = Math.max(
      1,
      Math.round((Date.now() - recordStartAtRef.current) / 1000) || recordSeconds,
    );
    const waveform = [...recordWaveform];
    const manualTranscript = recordTranscript.trim();
    setRecordingVoice(false);
    setRecordSeconds(0);
    setRecordTranscript('');
    setMicStatus('idle');
    setMicError(null);
    try {
      const { audioDataUrl, mimeType } = await stopMediaCapture();
      await submitVoiceClipPayload({
        audioDataUrl,
        mimeType,
        durationSec,
        waveform,
        manualTranscript,
      });
    } finally {
      setSending(false);
    }
  };

  const pendingScheduled = useMemo(
    () =>
      scheduledMessages.filter(
        (s) => s.roomId === roomId && s.status === 'pending',
      ),
    [scheduledMessages, roomId],
  );

  const handleConfirmSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onScheduleMessage || schedulingSubmitting) return;
    const text = (scheduleContent || draftText).trim();
    if (!text) {
      setScheduleError('예약 전송할 메시지 내용을 입력해 주세요.');
      return;
    }
    const parsedTime = new Date(scheduleAtInput);
    if (Number.isNaN(parsedTime.getTime()) || parsedTime.getTime() <= Date.now() + 5_000) {
      setScheduleError('현재 시각보다 이후 시점을 선택해 주세요.');
      return;
    }
    setScheduleError(null);
    setSchedulingSubmitting(true);
    try {
      await onScheduleMessage(text, parsedTime.toISOString());
      setShowSchedulePopover(false);
      setScheduleContent('');
      onDraftChange('');
    } finally {
      setSchedulingSubmitting(false);
    }
  };

  const handleConfirmLargeLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sharingLargeLink) return;
    setLargeError(null);
    setSharingLargeLink(true);
    try {
      const parsedMaxDl = Number(largeMaxDownloads);
      const maxDlVal =
        largeMaxDownloads.trim() && Number.isFinite(parsedMaxDl) && parsedMaxDl > 0
          ? Math.round(parsedMaxDl)
          : undefined;

      if (largeShareMode === 'nas' && onShareNasFile) {
        const res = await onShareNasFile({
          nasFolder: selectedNasFolder,
          filename: largeFilename.trim() || nasLocalFile?.name || '',
          sourceNasRelativePath: selectedSourceNasPath || undefined,
          externalNasUrl: largeUrl.trim() || undefined,
          sizeValue: Number(largeSizeValue) || 100,
          sizeUnit: largeSizeUnit,
          expiresDays: Number(largeExpiresDays) || 7,
          passcode: largePasscode.trim() || undefined,
          maxDownloads: maxDlVal,
          caption: largeCaption.trim() || undefined,
          localFile: nasLocalFile,
        });
        if (!res.ok) {
          setLargeError(res.error || 'NAS 파일 복사 및 외부 링크 공유에 실패했습니다.');
          return;
        }
      } else if (onShareLargeLink) {
        const res = await onShareLargeLink({
          filename: largeFilename.trim(),
          externalUrl: largeUrl.trim(),
          sizeValue: Number(largeSizeValue) || 100,
          sizeUnit: largeSizeUnit,
          expiresDays: Number(largeExpiresDays) || 7,
          shareProvider: largeShareProvider,
          passcode: largePasscode.trim() || undefined,
          maxDownloads: maxDlVal,
          caption: largeCaption.trim() || undefined,
        });
        if (!res.ok) {
          setLargeError(res.error || '대용량 링크 공유에 실패했습니다.');
          return;
        }
      }

      setShowLargeLinkPanel(false);
      setLargeFilename('');
      setLargeUrl('');
      setLargePasscode('');
      setLargeMaxDownloads('');
      setLargeCaption('');
      setNasLocalFile(null);
      setSelectedSourceNasPath('');
    } finally {
      setSharingLargeLink(false);
    }
  };

  const openScheduleCardCreator = () => {
    setShowPlusMenu(false);
    setShowEmoticons(false);
    setShowDrawPanel(false);
    setScError(null);
    setShowScheduleCardPanel(true);
  };

  const openDrawCreator = () => {
    setShowPlusMenu(false);
    setShowEmoticons(false);
    setShowScheduleCardPanel(false);
    setDrawError(null);
    const defaultMembers = roomMembers
      .filter((u) => u.role !== 'bot')
      .map((u) => u.name)
      .join(', ');
    if (!drawCandidatesText.trim() && defaultMembers) {
      setDrawCandidatesText(defaultMembers);
    }
    setShowDrawPanel(true);
  };

  const handleConfirmScheduleCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingScheduleCard) return;
    const title = scTitle.trim();
    const dateTime = scDateTime.trim();
    if (!title) {
      setScError('일정 제목을 입력해 주세요.');
      return;
    }
    if (!dateTime) {
      setScError('일시 정보를 입력해 주세요.');
      return;
    }
    setScError(null);
    setSubmittingScheduleCard(true);
    try {
      await onSendMessage({
        type: 'schedule_card',
        content: `[일정 공유] ${title} (${dateTime})`,
        scheduleCard: {
          title,
          dateTime,
          ...(scLocation.trim() ? { location: scLocation.trim() } : {}),
          ...(scMemo.trim() ? { memo: scMemo.trim() } : {}),
        },
      });
      setShowScheduleCardPanel(false);
      setScTitle('');
      setScLocation('');
      setScMemo('');
    } finally {
      setSubmittingScheduleCard(false);
    }
  };

  const handleConfirmRandomDraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRunRandomDraw || submittingDraw) return;
    setDrawError(null);
    setSubmittingDraw(true);
    try {
      const res = await onRunRandomDraw(drawTopic.trim() || '랜덤 추첨', drawCandidatesText);
      if (!res.ok) {
        setDrawError(res.error || '추첨 실행에 실패했습니다.');
        return;
      }
      setShowDrawPanel(false);
    } finally {
      setSubmittingDraw(false);
    }
  };

  const activeTrigger: ActiveComposerTrigger | null = useMemo(
    () => detectComposerTrigger(draftText, cursorPos),
    [draftText, cursorPos],
  );

  const mentionCandidates = useMemo(() => {
    if (!activeTrigger || activeTrigger.kind !== 'mention') return [];
    const q = activeTrigger.query;
    type MentionCandidate = {
      id: string;
      name: string;
      department: string;
      position: string;
      user?: User;
    };
    const allItem: MentionCandidate = {
      id: 'all',
      name: '전체',
      department: '방 전체 멤버 호출',
      position: '',
    };
    const humanMembers = roomMembers.filter((u) => u.role !== 'bot');
    const items: MentionCandidate[] = [
      allItem,
      ...humanMembers.map((u) => ({
        id: u.id,
        name: u.name,
        department: u.department,
        position: u.position,
        user: u,
      })),
    ];
    return items.filter(
      (item) =>
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.department.toLowerCase().includes(q),
    );
  }, [activeTrigger, roomMembers]);

  const commandCandidates = useMemo(() => {
    if (!activeTrigger || activeTrigger.kind !== 'command') return [];
    const q = activeTrigger.query;
    return SLASH_COMMANDS.filter(
      (c) => !q || c.command.slice(1).toLowerCase().includes(q) || c.description.includes(q),
    );
  }, [activeTrigger]);

  const openInlineLeaveDraft = (prefill?: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId: string | null;
    reason: string;
  }) => {
    setChatLeaveDraft({
      open: true,
      type: prefill?.type ?? '연차',
      startDate: prefill?.startDate ?? todayDate,
      endDate: prefill?.endDate ?? todayDate,
      substituteId: prefill?.substituteId ?? '',
      reason: prefill?.reason ?? '개인 사유',
    });
  };

  const stageFiles = (files: File[]) => {
    if (files.length === 0) return;
    const next: StagedAttachment[] = files.map((file) => ({
      id: `stage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setStagedFiles((prev) => [...prev, ...next]);
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  };

  const handleSelectMention = (name: string) => {
    if (!activeTrigger) return;
    const { nextText, nextCursor } = applyComposerTriggerReplacement(
      draftText,
      activeTrigger,
      `@${name}`,
    );
    onDraftChange(nextText);
    setCursorPos(nextCursor);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSelectCommand = async (cmd: SlashCommandOption) => {
    onDraftChange('');
    setCursorPos(0);
    setActiveIndex(0);
    if (cmd.id === 'cmd-leave-info') runLeaveLookupInChat('내 연차 정보', true);
    else if (cmd.id === 'cmd-leave-history') runLeaveLookupInChat('과거 연차 기록 조회', true);
    else if (cmd.id === 'cmd-leave') openInlineLeaveDraft();
    else {
      const quick = detectInChatQuickIntent(cmd.command);
      if (quick) {
        await runInChatQuickIntent(quick);
        return;
      }
      const parsed = parseSgwIntegrationCommand(cmd.command);
      if (parsed.matched && onTriggerIntegration) {
        await onTriggerIntegration(parsed.summary);
      }
    }
  };

  const handleTextChange = (val: string, selectionEnd: number) => {
    onDraftChange(val);
    setCursorPos(selectionEnd);
    setActiveIndex(0);
    onTypingChange(val.trim().length > 0);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      onTypingChange(false);
    }, 1800);
  };

  const handleConfirmChatLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatLeaveDraft) return;
    const calc = calculateLeaveDays(
      chatLeaveDraft.type,
      chatLeaveDraft.startDate,
      chatLeaveDraft.endDate,
    );
    if (!calc.valid) {
      setChatLeaveDraft((prev) => (prev ? { ...prev, error: calc.error } : null));
      return;
    }

    setChatLeaveDraft((prev) => (prev ? { ...prev, submitting: true, error: undefined } : null));
    const res = await onRegisterLeaveFromChat({
      type: chatLeaveDraft.type,
      startDate: chatLeaveDraft.startDate,
      endDate: chatLeaveDraft.endDate,
      substituteId: chatLeaveDraft.substituteId || null,
      reason: chatLeaveDraft.reason,
    });

    if (!res.ok) {
      setChatLeaveDraft((prev) =>
        prev ? { ...prev, submitting: false, error: res.error || '연차 등록 실패' } : null,
      );
      return;
    }

    setChatLeaveDraft(null);
    onDraftChange('');
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = draftText.trim();
    if ((!trimmed && stagedFiles.length === 0) || sending) return;

    if (trimmed) {
      const inlineViewOnceMatch = trimmed.match(/^\/(?:비밀|1회열람|보안메시지)\s+(.+)$/s);
      if (inlineViewOnceMatch && stagedFiles.length === 0) {
        setSending(true);
        try {
          await onSendMessage({
            type: 'text',
            content: inlineViewOnceMatch[1].trim(),
            replyToId: replyTo?.id ?? null,
            viewOnce: true,
          });
          onDraftChange('');
          onClearReply();
          setViewOnceMode(false);
          onTypingChange(false);
        } finally {
          setSending(false);
        }
        return;
      }

      const quickIntent = detectInChatQuickIntent(trimmed);
      if (quickIntent) {
        onDraftChange('');
        onTypingChange(false);
        await runInChatQuickIntent(quickIntent);
        return;
      }

      if (runLeaveLookupInChat(trimmed)) {
        onDraftChange('');
        onTypingChange(false);
        return;
      }

      const parsedLeave = parseChatLeaveCommand(trimmed, todayDate, colleagues);
      if (parsedLeave.matched) {
        openInlineLeaveDraft(parsedLeave);
        onDraftChange('');
        onTypingChange(false);
        return;
      }

      if (roomType === 'self' || trimmed.startsWith('/')) {
        const parsedIntegration = parseSgwIntegrationCommand(trimmed);
        if (parsedIntegration.matched && onTriggerIntegration) {
          setSending(true);
          try {
            await onTriggerIntegration(parsedIntegration.summary);
            onDraftChange('');
            onTypingChange(false);
          } finally {
            setSending(false);
          }
          return;
        }
      }
    }

    setSending(true);
    try {
      if (stagedFiles.length > 0) {
        for (let i = 0; i < stagedFiles.length; i += 1) {
          const caption = i === 0 ? trimmed : '';
          await onUploadFile(stagedFiles[i].file, caption);
          if (stagedFiles[i].previewUrl) URL.revokeObjectURL(stagedFiles[i].previewUrl!);
        }
        setStagedFiles([]);
        onDraftChange('');
        onClearReply();
      } else if (trimmed) {
        await onSendMessage({
          type: 'text',
          content: trimmed,
          replyToId: replyTo?.id ?? null,
          ...(viewOnceMode ? { viewOnce: true } : {}),
        });
        onDraftChange('');
        onClearReply();
        setViewOnceMode(false);
      }
      onTypingChange(false);
    } finally {
      setSending(false);
    }
  };

  const handleSendEmoticon = async (emoticonId: string, caption: string) => {
    setShowEmoticons(false);
    await onSendMessage({
      type: 'emoticon',
      content: caption,
      emoticonId,
      replyToId: replyTo?.id ?? null,
    });
    onClearReply();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      stageFiles(pastedFiles);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (activeTrigger?.kind === 'mention' && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const picked = mentionCandidates[activeIndex % mentionCandidates.length];
        if (picked) handleSelectMention(picked.name);
        return;
      }
    }

    if (activeTrigger?.kind === 'command' && commandCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % commandCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + commandCandidates.length) % commandCandidates.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const picked = commandCandidates[activeIndex % commandCandidates.length];
        if (picked) handleSelectCommand(picked);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="shrink-0 bg-white dark:bg-neutral-900 border-t border-black/10 dark:border-neutral-800 relative">
      {/* Hidden File Inputs (multiple supported) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          setShowPlusMenu(false);
          const MAX_DIRECT_CHUNK_BYTES = 500 * 1024 * 1024;
          const overLimit = picked.find((f) => f.size > MAX_DIRECT_CHUNK_BYTES);
          if (overLimit && (onShareNasFile || onShareLargeLink)) {
            setLargeShareMode(onShareNasFile ? 'nas' : 'cloud');
            setNasLocalFile(null);
            setLargeFilename(overLimit.name);
            setLargeSizeValue(
              String(Math.max(1, Number((overLimit.size / 1024 ** 3).toFixed(2)))),
            );
            setLargeSizeUnit('GB');
            setLargeError(
              `선택한 파일(${formatFileSize(overLimit.size)})은 500MB를 초과하여 사내 NAS 폴더 복사 및 외부 다운로드 링크 공유로 전환됩니다.`,
            );
            setShowLargeLinkPanel(true);
            e.target.value = '';
            return;
          }
          if (picked.length === 1 && !draftText.trim()) {
            onUploadFile(picked[0]);
          } else {
            stageFiles(picked);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          setShowPlusMenu(false);
          stageFiles(picked);
          e.target.value = '';
        }}
      />
      <input
        ref={nasFileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) {
            setNasLocalFile(picked);
            setSelectedSourceNasPath('');
            setLargeFilename(picked.name);
            if (picked.size >= 1024 ** 3) {
              setLargeSizeValue(String(Number((picked.size / 1024 ** 3).toFixed(2))));
              setLargeSizeUnit('GB');
            } else {
              setLargeSizeValue(String(Math.max(1, Number((picked.size / 1024 ** 2).toFixed(1)))));
              setLargeSizeUnit('MB');
            }
          }
          e.target.value = '';
        }}
      />

      {/* @Mention Autocomplete Popover */}
      {activeTrigger?.kind === 'mention' && mentionCandidates.length > 0 && (
        <div
          role="listbox"
          aria-label="대화 상대 멘션 추천"
          className="absolute bottom-full left-3 mb-2 z-30 w-72 max-h-56 overflow-y-auto chat-scroll p-1.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl space-y-0.5"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-neutral-400 flex items-center gap-1">
            <AtSign className="h-3 w-3" />
            <span>대화 상대 멘션</span>
          </div>
          {mentionCandidates.map((cand, idx) => (
            <button
              key={cand.id}
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              onClick={() => handleSelectMention(cand.name)}
              className={`w-full px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-left text-xs transition-colors cursor-pointer ${
                idx === activeIndex
                  ? 'bg-[#07C160]/15 text-[#075E54] dark:text-white font-semibold'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              {'user' in cand && cand.user ? (
                <Avatar user={cand.user} size="xs" showOnline />
              ) : (
                <div className="h-7 w-7 rounded-xl bg-[#008069] text-white flex items-center justify-center font-bold text-xs">
                  @
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate">
                  {cand.name} {cand.position}
                </div>
                <div className="text-[10px] text-neutral-400 truncate">{cand.department}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Slash Command Palette Popover */}
      {activeTrigger?.kind === 'command' && commandCandidates.length > 0 && (
        <div
          role="listbox"
          aria-label="슬래시 명령어 목록"
          className="absolute bottom-full left-3 mb-2 z-30 w-72 p-1.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl space-y-0.5"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-neutral-400">
            빠른 채팅 명령어 (Tab/클릭)
          </div>
          {commandCandidates.map((cmd, idx) => (
            <button
              key={cmd.id}
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              onClick={() => handleSelectCommand(cmd)}
              className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-left text-xs cursor-pointer ${
                idx === activeIndex
                  ? 'bg-[#07C160]/15 text-[#075E54] dark:text-white font-semibold'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              <span className="font-mono font-bold text-[#008069] dark:text-[#07C160]">
                {cmd.label}
              </span>
              <span className="text-[11px] text-neutral-500 truncate">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Conversational Leave Info & Past History Result Panel */}
      {leaveLookupPanel?.open && (
        <div className="p-3.5 bg-emerald-50/95 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-900 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#075E54] dark:text-[#07C160]">
              대화형 내 연차 · 과거 기록 조회 ({leaveLookupPanel.question})
            </span>
            <button
              type="button"
              onClick={() => setLeaveLookupPanel(null)}
              aria-label="연차 조회 결과 닫기"
              className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-emerald-200/80 dark:border-emerald-800 text-xs text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed">
            {leaveLookupPanel.result.summaryText}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {['내 연차 정보', '지난달 내 연차 기록', '과거 연차 전체'].map((qChip) => (
                <button
                  key={qChip}
                  type="button"
                  onClick={() => runLeaveLookupInChat(qChip, true)}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 cursor-pointer"
                >
                  {qChip}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {roomType === 'self' && (
                <button
                  type="button"
                  onClick={async () => {
                    const summary = leaveLookupPanel.result.summaryText;
                    setLeaveLookupPanel(null);
                    await onSendMessage({ type: 'text', content: summary });
                  }}
                  className="h-7 px-2.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-neutral-900 text-[11px] font-semibold text-[#075E54] dark:text-[#07C160] hover:bg-emerald-50 cursor-pointer"
                >
                  채팅에 기록 남기기
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setLeaveLookupPanel(null);
                  onGoToLeaveTab();
                }}
                className="h-7 px-2.5 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-[11px] font-bold cursor-pointer"
              >
                스케줄·달력 전체 열기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conversational Self-Leave Registration Bar */}
      {chatLeaveDraft?.open && (
        <form
          onSubmit={handleConfirmChatLeave}
          className="p-3.5 bg-amber-50/90 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <CalendarPlus className="h-4 w-4" />
              대화형 본인 연차 등록 (전 사원 bmail·메신저 즉시 알림)
            </span>
            <button
              type="button"
              onClick={() => setChatLeaveDraft(null)}
              aria-label="대화 연차 등록 닫기"
              className="text-neutral-500 hover:text-neutral-900 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {chatLeaveDraft.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{chatLeaveDraft.error}</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select
              aria-label="휴가 유형"
              value={chatLeaveDraft.type}
              onChange={(e) => {
                const t = e.target.value as LeaveType;
                setChatLeaveDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        type: t,
                        endDate: t === '오전반차' || t === '오후반차' ? prev.startDate : prev.endDate,
                      }
                    : null,
                );
              }}
              className="h-8 px-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <input
              type="date"
              aria-label="연차 시작일"
              value={chatLeaveDraft.startDate}
              onChange={(e) => {
                const val = e.target.value;
                setChatLeaveDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        startDate: val,
                        endDate:
                          prev.type === '오전반차' || prev.type === '오후반차' || val > prev.endDate
                            ? val
                            : prev.endDate,
                      }
                    : null,
                );
              }}
              className="h-8 px-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs tabular-nums"
            />

            <input
              type="date"
              aria-label="연차 종료일"
              disabled={chatLeaveDraft.type === '오전반차' || chatLeaveDraft.type === '오후반차'}
              value={chatLeaveDraft.endDate}
              onChange={(e) =>
                setChatLeaveDraft((prev) => (prev ? { ...prev, endDate: e.target.value } : null))
              }
              className="h-8 px-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs tabular-nums disabled:opacity-60"
            />

            <select
              aria-label="업무 대행자"
              value={chatLeaveDraft.substituteId}
              onChange={(e) =>
                setChatLeaveDraft((prev) =>
                  prev ? { ...prev, substituteId: e.target.value } : null,
                )
              }
              className="h-8 px-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs"
            >
              <option value="">대행자 선택(선택)</option>
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.position}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="연차 사유"
              value={chatLeaveDraft.reason}
              onChange={(e) =>
                setChatLeaveDraft((prev) => (prev ? { ...prev, reason: e.target.value } : null))
              }
              placeholder="사유 입력 (예: 개인 일정)"
              className="flex-1 h-8 px-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs"
            />
            <button
              type="submit"
              disabled={chatLeaveDraft.submitting}
              className="h-8 px-3.5 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {chatLeaveDraft.submitting ? '등록 중...' : '연차 확정 · 알림 발송'}
            </button>
          </div>
        </form>
      )}

      {/* Staged Attachment Preview Bar (Clipboard Paste / Multi-file) */}
      {stagedFiles.length > 0 && (
        <div className="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-2 overflow-x-auto chat-scroll">
          {stagedFiles.map((sf) => (
            <div
              key={sf.id}
              className="relative shrink-0 flex items-center gap-2 p-1.5 pr-7 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700"
            >
              {sf.previewUrl ? (
                <img
                  src={sf.previewUrl}
                  alt={sf.file.name}
                  className="h-10 w-10 rounded-lg object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-neutral-500" />
                </div>
              )}
              <div className="max-w-[130px]">
                <div className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 truncate">
                  {sf.file.name}
                </div>
                <div className="text-[10px] text-neutral-400 tabular-nums">
                  {formatFileSize(sf.file.size)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeStagedFile(sf.id)}
                aria-label={`${sf.file.name} 첨부 취소`}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-red-100 text-neutral-500 hover:text-red-600 flex items-center justify-center cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Reply Banner */}
      {replyTo && (
        <div className="px-4 py-2 bg-neutral-50 dark:bg-neutral-800/70 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <span className="font-semibold text-[#008069] dark:text-[#07C160]">
              {usersById[replyTo.senderId]?.name ?? '사원'}님에게 답장
            </span>
            <p className="text-neutral-500 truncate">{replyTo.content}</p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            aria-label="답장 취소"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Emoticon Picker Popover */}
      {showEmoticons && (
        <div className="absolute bottom-full left-3 mb-2 z-30 w-80 max-w-[calc(100vw-24px)] p-3 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
              사내 이모티콘 · 퀵 스티커
            </span>
            <button
              type="button"
              onClick={() => setShowEmoticons(false)}
              aria-label="이모티콘 닫기"
              className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {WORK_EMOTICONS.map((emo) => (
              <button
                key={emo.id}
                type="button"
                onClick={() => handleSendEmoticon(emo.id, emo.caption)}
                className="p-2 rounded-xl border border-black/5 hover:scale-105 transition-transform flex flex-col items-center gap-1 cursor-pointer"
                style={{ backgroundColor: emo.bg }}
              >
                <span className="text-2xl leading-none">{emo.emoji}</span>
                <span className="text-[10px] font-bold text-neutral-800 truncate w-full text-center">
                  {emo.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Plus Attachment Menu */}
      {showPlusMenu && (
        <div className="absolute bottom-full left-3 mb-2 z-30 w-72 p-2 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl space-y-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <Paperclip className="h-4 w-4 text-sky-600" />
            <span>파일 보내기 (최대 500MB 분할 업로드)</span>
          </button>
          {(onShareNasFile || onShareLargeLink) && (
            <button
              type="button"
              onClick={() => {
                setShowPlusMenu(false);
                setLargeError(null);
                setLargeShareMode(onShareNasFile ? 'nas' : 'cloud');
                setShowLargeLinkPanel(true);
              }}
              className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
            >
              <HardDrive className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
              <span>100GB+ NAS 폴더 복사 · 외부 링크 공유</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <ImageIcon className="h-4 w-4 text-emerald-600" />
            <span>사진 보내기 (붙여넣기 지원)</span>
          </button>
          <button
            type="button"
            onClick={openScheduleCardCreator}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <Calendar className="h-4 w-4 text-[#008069]" />
            <span>일정 공유 · 참석 확인 (/일정)</span>
          </button>
          {onRunRandomDraw && (
            <button
              type="button"
              onClick={openDrawCreator}
              className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
            >
              <Dices className="h-4 w-4 text-amber-600" />
              <span>랜덤 추첨 · 당번 정하기 (/추첨)</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowPlusMenu(false);
              onOpenNoticeModal();
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <Megaphone className="h-4 w-4 text-amber-600" />
            <span>채팅방 공지 등록</span>
          </button>
          <button
            type="button"
            onClick={() => {
              closeInlinePanels();
              onOpenNoticeModal(undefined, undefined, { urgent: true });
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2.5 text-xs font-semibold text-red-700 dark:text-red-300 cursor-pointer"
          >
            <Siren className="h-4 w-4 text-red-600" />
            <span>긴급 재난문자 공지 발송 (/긴급공지)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              closeInlinePanels();
              onOpenPollModal();
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <BarChart3 className="h-4 w-4 text-violet-600" />
            <span>투표 올리기 (/투표)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              closeInlinePanels('mail');
              setInChatMailTab('inbox');
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <Mail className="h-4 w-4 text-sky-600" />
            <span>bmail · 빅메일 확인 · 보내기 (/메일)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void openInChatRoomSummary();
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <Sparkles className="h-4 w-4 text-[#008069]" />
            <span>현재 대화 AI 핵심 요약 (/요약)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              closeInlinePanels('alerts');
              setShowInChatAlerts(true);
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <BellRing className="h-4 w-4 text-amber-600" />
            <span>통합 알림 브리핑 보기 (/알림)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              closeInlinePanels('leave_draft');
              openInlineLeaveDraft();
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <CalendarPlus className="h-4 w-4 text-rose-600" />
            <span>대화로 자기 연차 등록 (/연차)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowPlusMenu(false);
              onGoToLeaveTab();
            }}
            className="w-full px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 cursor-pointer"
          >
            <FolderOpen className="h-4 w-4 text-neutral-500" />
            <span>연차·메일 전체 탭으로 이동</span>
          </button>
        </div>
      )}

      {/* In-Chat All-In-One Panels (Mail Hub, Alerts Briefing, Room Summary) */}
      {inChatMailTab && (
        <InChatMailPanel
          initialTab={inChatMailTab}
          roomId={roomId}
          roomFiles={roomFiles}
          initialDraft={mailDraftState.draft}
          draftNonce={mailDraftState.nonce}
          bmailBridgeStatus={bmailBridgeStatus}
          onSyncRemoteBmail={onSyncRemoteBmail}
          onLaunchBmailSso={onLaunchBmailSso}
          currentUser={currentUser}
          colleagues={colleagues}
          usersById={usersById}
          mails={mails}
          apiFetch={apiFetch}
          onOpenMail={onOpenMail}
          onMailSent={onMailSent}
          onShareMailToChat={async (text) => {
            await onSendMessage({
              type: 'text',
              content: text,
              replyToId: replyTo?.id ?? null,
            });
            onClearReply();
            setInChatMailTab(null);
          }}
          onClose={() => setInChatMailTab(null)}
        />
      )}

      {showInChatAlerts && (
        <InChatAlertsPanel
          currentUserId={currentUser?.id}
          notices={notices}
          notifications={notifications}
          onAcknowledgeNotice={onAcknowledgeNotice}
          onMarkNotificationRead={onMarkNotificationRead}
          onMarkAllNotificationsRead={onMarkAllNotificationsRead}
          onOpenMail={onOpenMail}
          onOpenRoom={onOpenRoom}
          onClose={() => setShowInChatAlerts(false)}
        />
      )}

      {roomSummaryPanel?.open && (
        <InChatSummaryPanel
          loading={roomSummaryPanel.loading}
          summaryText={roomSummaryPanel.summaryText}
          bullets={roomSummaryPanel.bullets}
          messageCount={roomSummaryPanel.messageCount}
          onPostToChat={async () => {
            await onSendMessage({
              type: 'text',
              content: roomSummaryPanel.summaryText,
            });
            setRoomSummaryPanel(null);
          }}
          onSaveToMeetingMemo={
            onTriggerIntegration
              ? () => {
                  onTriggerIntegration({
                    system: 'SGW',
                    menuKey: 'meeting-memo',
                    title: `${roomName} 대화 요약 미팅메모 저장`,
                    description: roomSummaryPanel.bullets.join(' / '),
                    actionLabel: 'SGW 미팅메모 열기',
                    payload: { action: 'create', content: roomSummaryPanel.summaryText },
                  });
                  setRoomSummaryPanel(null);
                }
              : undefined
          }
          onClose={() => setRoomSummaryPanel(null)}
        />
      )}

      {/* Chunked Upload Progress Bar (20MB ~ 500MB) */}
      {chunkUploadProgress && (
        <div className="px-4 py-2 bg-emerald-50/80 dark:bg-emerald-950/30 border-b border-emerald-200/80 dark:border-emerald-900 space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-[#075E54] dark:text-[#07C160]">
            <span className="truncate">분할 업로드 중 · {chunkUploadProgress.filename}</span>
            <span className="tabular-nums shrink-0">
              {chunkUploadProgress.chunkIndex}/{chunkUploadProgress.totalChunks} 청크 ({chunkUploadProgress.percent}%)
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-emerald-200/70 dark:bg-emerald-900 overflow-hidden">
            <div
              className="h-full bg-[#008069] dark:bg-[#07C160] transition-all"
              style={{ width: `${chunkUploadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* 100GB-Scale Internal NAS Folder Copy + External Download Link Panel */}
      {showLargeLinkPanel && (onShareNasFile || onShareLargeLink) && (
        <form
          onSubmit={handleConfirmLargeLink}
          className="p-3.5 bg-neutral-50 dark:bg-neutral-800/70 border-b border-neutral-200 dark:border-neutral-800 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#075E54] dark:text-[#07C160]">
                <HardDrive className="h-4 w-4" />
                <span>대용량 NAS 폴더 복사 · 외부 다운로드 공유</span>
              </span>
              <div className="inline-flex items-center p-0.5 rounded-lg bg-neutral-200/70 dark:bg-neutral-900">
                {onShareNasFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setLargeShareMode('nas');
                      setLargeError(null);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer ${
                      largeShareMode === 'nas'
                        ? 'bg-white dark:bg-neutral-800 text-[#075E54] dark:text-[#07C160] shadow-2xs'
                        : 'text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    사내 NAS 복사 + 외부링크
                  </button>
                )}
                {onShareLargeLink && (
                  <button
                    type="button"
                    onClick={() => {
                      setLargeShareMode('cloud');
                      setLargeError(null);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer ${
                      largeShareMode === 'cloud'
                        ? 'bg-white dark:bg-neutral-800 text-[#075E54] dark:text-[#07C160] shadow-2xs'
                        : 'text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    외부 클라우드 URL
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {largeShareMode === 'nas' && (
                <button
                  type="button"
                  onClick={() => nasFileInputRef.current?.click()}
                  className="h-7 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
                >
                  {nasLocalFile ? `선택됨: ${nasLocalFile.name}` : 'PC 파일 NAS 복사 (≤500MB)'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowLargeLinkPanel(false)}
                aria-label="대용량 링크 공유 닫기"
                className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {largeShareMode === 'nas' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5 text-[#008069] shrink-0" />
                <select
                  value={selectedNasFolder}
                  onChange={(e) => {
                    setSelectedNasFolder(e.target.value);
                    setSelectedSourceNasPath('');
                  }}
                  aria-label="대상 NAS 폴더"
                  className="flex-1 h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
                >
                  {nasFolders.map((nf) => (
                    <option key={nf.folder} value={nf.folder}>
                      \\nas.sgw.internal\{nf.folder} ({nf.files.length}개)
                    </option>
                  ))}
                </select>
              </div>
              <select
                value={selectedSourceNasPath}
                onChange={(e) => {
                  const rel = e.target.value;
                  setSelectedSourceNasPath(rel);
                  setNasLocalFile(null);
                  const folderObj = nasFolders.find((nf) => nf.folder === selectedNasFolder);
                  const found = folderObj?.files.find((f) => f.relativePath === rel);
                  if (found) {
                    setLargeFilename(found.filename);
                  }
                }}
                aria-label="기존 NAS 폴더 파일 선택"
                className="h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
              >
                <option value="">
                  {loadingNasFolders
                    ? 'NAS 폴더 불러오는 중...'
                    : '기존 NAS 파일 선택 또는 아래 직접 입력'}
                </option>
                {(nasFolders.find((nf) => nf.folder === selectedNasFolder)?.files ?? []).map((f) => (
                  <option key={f.relativePath} value={f.relativePath}>
                    {f.filename} ({formatFileSize(f.size)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { label: '10GB', value: '10', unit: 'GB' as const },
              { label: '100GB', value: '100', unit: 'GB' as const },
              { label: '500GB', value: '500', unit: 'GB' as const },
              { label: '1TB', value: '1', unit: 'TB' as const },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setLargeSizeValue(preset.value);
                  setLargeSizeUnit(preset.unit);
                }}
                className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold cursor-pointer ${
                  largeSizeValue === preset.value && largeSizeUnit === preset.unit
                    ? 'bg-[#008069] border-[#008069] text-white'
                    : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {largeError && (
            <p className="text-xs text-red-600 dark:text-red-400">{largeError}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <input
              type="text"
              required
              value={largeFilename}
              onChange={(e) => setLargeFilename(e.target.value)}
              placeholder="파일명 (예: 모델학습_데이터셋_120GB.tar.zst)"
              aria-label="대용량 파일명"
              className="sm:col-span-2 h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
            />
            <input
              type="url"
              required={largeShareMode === 'cloud'}
              value={largeUrl}
              onChange={(e) => setLargeUrl(e.target.value)}
              placeholder={
                largeShareMode === 'nas'
                  ? '외부 NAS 게이트웨이 URL (선택 · 미입력 시 SGW 보안 링크 자동 발급)'
                  : 'https://s3.ap-northeast-2.amazonaws.com/...'
              }
              aria-label="외부 대용량 다운로드 URL"
              className="sm:col-span-2 h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="10240"
                step="any"
                value={largeSizeValue}
                onChange={(e) => setLargeSizeValue(e.target.value)}
                aria-label="용량 수치"
                className="w-1/2 h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs tabular-nums text-neutral-900 dark:text-white"
              />
              <select
                value={largeSizeUnit}
                onChange={(e) => setLargeSizeUnit(e.target.value as 'MB' | 'GB' | 'TB')}
                aria-label="용량 단위"
                className="w-1/2 h-8 px-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
              >
                <option value="MB">MB</option>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
            {largeShareMode === 'cloud' ? (
              <select
                value={largeShareProvider}
                onChange={(e) => setLargeShareProvider(e.target.value as ShareProvider)}
                aria-label="외부 스토리지 제공자"
                className="h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
              >
                {(Object.entries(SHARE_PROVIDER_LABELS) as [ShareProvider, string][]).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            ) : (
              <div className="h-8 px-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-[11px] font-bold text-[#075E54] dark:text-[#07C160] flex items-center justify-center truncate">
                사내 NAS 저장
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <select
              value={largeExpiresDays}
              onChange={(e) => setLargeExpiresDays(e.target.value)}
              aria-label="만료 기간"
              className="h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
            >
              <option value="1">1일 만료</option>
              <option value="7">7일 만료</option>
              <option value="30">30일 만료</option>
              <option value="90">90일 만료</option>
            </select>
            <div className="relative flex items-center">
              <Lock className="h-3 w-3 text-neutral-400 absolute left-2 pointer-events-none" />
              <input
                type="password"
                value={largePasscode}
                onChange={(e) => setLargePasscode(e.target.value)}
                placeholder="PIN 보호(4~24자, 선택)"
                aria-label="공유 비밀번호 PIN"
                className="w-full h-8 pl-6 pr-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
              />
            </div>
            <input
              type="number"
              min="1"
              max="1000"
              value={largeMaxDownloads}
              onChange={(e) => setLargeMaxDownloads(e.target.value)}
              placeholder="다운로드 횟수 제한(선택)"
              aria-label="최대 다운로드 횟수"
              className="h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs tabular-nums text-neutral-900 dark:text-white"
            />
            <input
              type="text"
              value={largeCaption}
              onChange={(e) => setLargeCaption(e.target.value)}
              placeholder="전달 메모 (선택 사항)"
              aria-label="대용량 링크 설명"
              className="sm:col-span-2 h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={
                sharingLargeLink ||
                !largeFilename.trim() ||
                (largeShareMode === 'cloud' && !largeUrl.trim())
              }
              className="h-8 px-3.5 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              {sharingLargeLink
                ? '처리 중...'
                : largeShareMode === 'nas'
                  ? 'NAS 복사 · 링크 발급'
                  : '보안 링크 전송'}
            </button>
          </div>
        </form>
      )}

      {/* KakaoTalk Schedule Card Creator Panel */}
      {showScheduleCardPanel && (
        <form
          onSubmit={handleConfirmScheduleCard}
          className="p-3.5 bg-emerald-50/75 dark:bg-emerald-950/25 border-b border-emerald-200 dark:border-emerald-900 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#075E54] dark:text-[#07C160] flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              <span>일정 공유 카드 만들기 (참석 · 미정 · 불참 투표)</span>
            </span>
            <button
              type="button"
              onClick={() => setShowScheduleCardPanel(false)}
              aria-label="일정 공유 닫기"
              className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {scError && <p className="text-xs text-red-600 dark:text-red-400">{scError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={scTitle}
              onChange={(e) => setScTitle(e.target.value)}
              placeholder="일정 제목 (예: 주간 스프린트 회고)"
              aria-label="일정 제목"
              className="h-8 px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-neutral-900 text-xs"
            />
            <input
              type="text"
              required
              value={scDateTime}
              onChange={(e) => setScDateTime(e.target.value)}
              placeholder="일시 (예: 2026-11-25 14:00)"
              aria-label="일정 일시"
              className="h-8 px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-neutral-900 text-xs"
            />
            <input
              type="text"
              value={scLocation}
              onChange={(e) => setScLocation(e.target.value)}
              placeholder="장소 또는 회의실 링크 (선택)"
              aria-label="일정 장소"
              className="h-8 px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-neutral-900 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={scMemo}
              onChange={(e) => setScMemo(e.target.value)}
              placeholder="참고 메모 (선택)"
              aria-label="일정 메모"
              className="flex-1 h-8 px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-neutral-900 text-xs"
            />
            <button
              type="submit"
              disabled={submittingScheduleCard || !scTitle.trim() || !scDateTime.trim()}
              className="h-8 px-3.5 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              {submittingScheduleCard ? '공유 중...' : '일정 카드 보내기'}
            </button>
          </div>
        </form>
      )}

      {/* KakaoTalk Random Draw Panel */}
      {showDrawPanel && onRunRandomDraw && (
        <form
          onSubmit={handleConfirmRandomDraw}
          className="p-3.5 bg-amber-50/85 dark:bg-amber-950/25 border-b border-amber-200 dark:border-amber-900 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <Dices className="h-4 w-4" />
              <span>랜덤 추첨 · 당번 정하기</span>
            </span>
            <button
              type="button"
              onClick={() => setShowDrawPanel(false)}
              aria-label="랜덤 추첨 닫기"
              className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {drawError && <p className="text-xs text-red-600 dark:text-red-400">{drawError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={drawTopic}
              onChange={(e) => setDrawTopic(e.target.value)}
              placeholder="추첨 주제 (예: 오늘 커피 쏘기)"
              aria-label="추첨 주제"
              className="h-8 px-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs"
            />
            <input
              type="text"
              required
              value={drawCandidatesText}
              onChange={(e) => setDrawCandidatesText(e.target.value)}
              placeholder="후보 (쉼표로 구분: 민준, 서연, 지훈)"
              aria-label="추첨 후보 목록"
              className="sm:col-span-2 h-8 px-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={submittingDraw || !drawCandidatesText.trim()}
              className="h-8 px-3.5 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              {submittingDraw ? '추첨 중...' : '추첨 실행 및 공유'}
            </button>
          </div>
        </form>
      )}

      {/* Pending Scheduled Messages Strip */}
      {pendingScheduled.length > 0 && (
        <div className="px-4 py-2 bg-amber-50/80 dark:bg-amber-950/25 border-b border-amber-200/70 dark:border-amber-900/50 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 dark:text-amber-300">
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              <span>예약 전송 대기 ({pendingScheduled.length}건)</span>
            </span>
          </div>
          <div className="space-y-1 max-h-20 overflow-y-auto chat-scroll">
            {pendingScheduled.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 text-xs text-neutral-800 dark:text-neutral-200"
              >
                <span className="truncate flex-1">{s.content}</span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums whitespace-nowrap shrink-0">
                  {formatKoreanTime(s.scheduledAt)}
                </span>
                {onCancelScheduledMessage && (
                  <button
                    type="button"
                    onClick={() => onCancelScheduledMessage(s.id)}
                    aria-label={`예약 전송 취소: ${s.content}`}
                    className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    취소
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled Message Popover */}
      {showSchedulePopover && onScheduleMessage && (
        <form
          onSubmit={handleConfirmSchedule}
          className="absolute bottom-full right-3 mb-2 z-30 w-80 max-w-[calc(100vw-24px)] p-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
              <span>메시지 예약 전송</span>
            </span>
            <button
              type="button"
              onClick={() => setShowSchedulePopover(false)}
              aria-label="예약 전송 닫기"
              className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <input
            type="text"
            value={scheduleContent}
            onChange={(e) => setScheduleContent(e.target.value)}
            placeholder="예약 전송할 메시지 내용"
            aria-label="예약 전송 메시지"
            className="w-full h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-xs text-neutral-900 dark:text-white"
          />

          <div className="flex items-center gap-1.5">
            {[
              { label: '+5분', mins: 5 },
              { label: '+30분', mins: 30 },
              { label: '+1시간', mins: 60 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() =>
                  setScheduleAtInput(
                    toLocalDatetimeInputValue(new Date(Date.now() + preset.mins * 60_000)),
                  )
                }
                className="flex-1 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-[#07C160]/15 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 whitespace-nowrap cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <input
            type="datetime-local"
            value={scheduleAtInput}
            onChange={(e) => setScheduleAtInput(e.target.value)}
            aria-label="예약 발송 시각"
            className="w-full h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-xs tabular-nums text-neutral-900 dark:text-white"
          />

          {scheduleError && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{scheduleError}</p>
          )}

          <button
            type="submit"
            disabled={schedulingSubmitting}
            className="w-full h-8 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
          >
            {schedulingSubmitting ? '예약 등록 중...' : '예약 전송 등록'}
          </button>
        </form>
      )}

      {/* AI Voice / Conversational Command Bar (SEDMS · Calendar · Meeting Memo · Leave) */}
      {showVoiceCmdBar && !recordingVoice && (
        <div className="p-3 bg-emerald-50/90 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#075E54] dark:text-[#07C160]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI 음성 · 명령어 실행 (연차 · SEDMS · 달력 · 미팅메모 · 회의)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                stopVoiceCommandListening();
                setShowVoiceCmdBar(false);
              }}
              aria-label="음성 명령창 닫기"
              className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {AI_VOICE_QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => executeVoiceOrNaturalCommand(chip)}
                className="px-2 py-1 rounded-lg bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startVoiceCommandListening}
              className={`h-8 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer ${
                voiceCmdListening
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-white dark:bg-neutral-900 border border-emerald-300 dark:border-emerald-700 text-[#075E54] dark:text-[#07C160]'
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              <span>{voiceCmdListening ? '중지' : '음성 인식'}</span>
            </button>
            <input
              type="text"
              value={voiceCmdText}
              onChange={(e) => setVoiceCmdText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  executeVoiceOrNaturalCommand(voiceCmdText);
                }
              }}
              placeholder="예: 내일 연차 등록, 프로젝트 달력 열어줘, 미팅메모 작성"
              aria-label="AI 음성 명령 입력"
              className="flex-1 h-8 px-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800 text-xs focus:outline-none focus:ring-1 focus:ring-[#07C160]"
            />
            <button
              type="button"
              disabled={!voiceCmdText.trim() || sending}
              onClick={() => executeVoiceOrNaturalCommand(voiceCmdText)}
              className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              실행
            </button>
          </div>

          {voiceCmdStatus && (
            <p className="text-[11px] text-emerald-800 dark:text-emerald-300">{voiceCmdStatus}</p>
          )}
        </div>
      )}

      {/* Voice Recording Bar OR Recorded Preview OR Standard Text Composer */}
      {recordingVoice ? (
        <div className="p-3 bg-[#075E54]/8 dark:bg-[#075E54]/20 space-y-2.5">
          <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  micStatus === 'error'
                    ? 'bg-amber-500'
                    : micStatus === 'acquiring'
                      ? 'bg-sky-500 animate-pulse'
                      : 'bg-red-500 animate-pulse'
                }`}
              />
              <span className="text-xs font-bold text-neutral-900 dark:text-white tabular-nums">
                {micStatus === 'acquiring'
                  ? '마이크 연결 중...'
                  : micStatus === 'error'
                    ? '마이크 대기'
                    : '음성 녹음 중'}{' '}
                · {Math.floor(recordSeconds / 60)}:
                {String(recordSeconds % 60).padStart(2, '0')}
              </span>
            </div>
            <div className="flex-1 flex items-center gap-0.5 h-6 min-w-[80px] max-w-xs">
              {recordWaveform.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full bg-[#07C160]"
                  style={{ height: `${Math.max(20, Math.min(100, h))}%` }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={cancelVoiceRecording}
                aria-label="음성 녹음 취소"
                className="h-8 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 text-xs font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>취소</span>
              </button>
              <button
                type="button"
                onClick={finishVoiceToPreview}
                aria-label="녹음 정지 및 미리듣기"
                className="h-8 px-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1 cursor-pointer"
              >
                <Square className="h-3 w-3" />
                <span>완료</span>
              </button>
              <button
                type="button"
                onClick={sendVoiceMessage}
                disabled={sending}
                aria-label="음성 메시지 전송"
                className="h-8 px-3 rounded-lg bg-[#07C160] hover:bg-[#06ad56] text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                <span>음성 전송</span>
              </button>
            </div>
          </div>

          {micError && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
              <span>{micError}</span>
              <button
                type="button"
                onClick={() => {
                  void cancelVoiceRecording().then(() => startVoiceRecording());
                }}
                className="px-2 py-0.5 rounded-md bg-white dark:bg-neutral-900 border border-amber-300 dark:border-amber-700 font-bold shrink-0 cursor-pointer"
              >
                다시 연결
              </button>
            </div>
          )}

          <input
            type="text"
            value={recordTranscript}
            onChange={(e) => setRecordTranscript(e.target.value)}
            placeholder="녹음 메모 또는 직접 텍스트 추가 (미입력 시 AI가 음성을 자동 텍스트 변환)"
            aria-label="음성 메모 텍스트"
            className="w-full h-8 px-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs focus:outline-none focus:ring-1 focus:ring-[#07C160]"
          />
        </div>
      ) : recordedPreview ? (
        <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/25 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePreviewVoice}
                aria-label={previewPlaying ? '녹음 미리듣기 일시정지' : '녹음 미리듣기 재생'}
                className="h-8 w-8 rounded-full bg-[#008069] hover:bg-[#006B58] text-white flex items-center justify-center shrink-0 cursor-pointer"
              >
                {previewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <div className="text-xs">
                <div className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <span>녹음 클립 확인</span>
                  <span className="tabular-nums text-[#008069] dark:text-[#07C160]">
                    {formatVoiceDuration(recordedPreview.durationSec)}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {recordedPreview.audioDataUrl
                    ? '실제 녹음 오디오 준비 완료 · 미리듣기로 소리를 확인하세요'
                    : '음성 메모 오디오 클립 준비 완료'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  stopPreviewPlayback();
                  setRecordedPreview(null);
                  void startVoiceRecording();
                }}
                aria-label="다시 녹음하기"
                className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-medium text-neutral-700 dark:text-neutral-200 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>다시 녹음</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopPreviewPlayback();
                  setRecordedPreview(null);
                }}
                aria-label="녹음 클립 삭제"
                className="h-8 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 text-xs font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>삭제</span>
              </button>
              <button
                type="button"
                onClick={sendVoicePreview}
                disabled={sending}
                aria-label="녹음된 음성 클립 전송"
                className="h-8 px-3.5 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                <span>음성 전송</span>
              </button>
            </div>
          </div>

          <input
            type="text"
            value={recordedPreview.transcript}
            onChange={(e) =>
              setRecordedPreview((prev) => (prev ? { ...prev, transcript: e.target.value } : null))
            }
            placeholder="전달할 텍스트 메모 (비워두면 전송 시 AI가 음성을 자동 변환합니다)"
            aria-label="녹음 클립 텍스트 메모"
            className="w-full h-8 px-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs focus:outline-none focus:ring-1 focus:ring-[#07C160]"
          />
        </div>
      ) : (
        <form onSubmit={handleSend} className="px-3 pt-2 pb-3 space-y-2">
          {/* Compact All-In-One Talk Action Bar */}
          <div
            role="toolbar"
            aria-label="톡 내 바로실행 기능"
            className="flex items-center gap-1 overflow-x-auto chat-scroll pb-1 border-b border-neutral-100 dark:border-neutral-800"
          >
            <button
              type="button"
              onClick={() => {
                closeInlinePanels();
                onOpenNoticeModal();
              }}
              className="h-6 px-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-amber-100 dark:hover:bg-amber-950/50 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Megaphone className="h-3 w-3 text-amber-600" />
              <span>공지</span>
            </button>
            <button
              type="button"
              onClick={() => {
                closeInlinePanels();
                onOpenNoticeModal(undefined, undefined, { urgent: true });
              }}
              className="h-6 px-2 rounded-md bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-[11px] font-bold text-red-700 dark:text-red-300 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Siren className="h-3 w-3 text-red-600" />
              <span>긴급공지</span>
            </button>
            {(onShareNasFile || onShareLargeLink) && (
              <button
                type="button"
                onClick={() => {
                  const next = !showLargeLinkPanel;
                  closeInlinePanels(next ? 'nas' : undefined);
                  setLargeError(null);
                  setLargeShareMode(onShareNasFile ? 'nas' : 'cloud');
                  setShowLargeLinkPanel(next);
                }}
                className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  showLargeLinkPanel
                    ? 'bg-[#008069] text-white'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-[#075E54] dark:text-[#07C160]'
                }`}
              >
                <HardDrive className="h-3 w-3" />
                <span>100GB NAS</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const opening = !inChatMailTab;
                closeInlinePanels(opening ? 'mail' : undefined);
                setInChatMailTab(opening ? 'inbox' : null);
              }}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                inChatMailTab
                  ? 'bg-sky-700 text-white'
                  : 'bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 text-sky-800 dark:text-sky-200'
              }`}
            >
              <Mail className="h-3 w-3" />
              <span>bmail·빅메일</span>
            </button>
            <button
              type="button"
              onClick={() => {
                closeInlinePanels();
                onOpenPollModal();
              }}
              className="h-6 px-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-violet-100 dark:hover:bg-violet-950/40 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BarChart3 className="h-3 w-3 text-violet-600" />
              <span>투표</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !showScheduleCardPanel;
                closeInlinePanels(next ? 'schedule_card' : undefined);
                if (next) openScheduleCardCreator();
                else setShowScheduleCardPanel(false);
              }}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                showScheduleCardPanel
                  ? 'bg-[#008069] text-white'
                  : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              <Calendar className="h-3 w-3 text-[#008069]" />
              <span>일정</span>
            </button>
            {onRunRandomDraw && (
              <button
                type="button"
                onClick={() => {
                  const next = !showDrawPanel;
                  closeInlinePanels(next ? 'draw' : undefined);
                  if (next) openDrawCreator();
                  else setShowDrawPanel(false);
                }}
                className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  showDrawPanel
                    ? 'bg-amber-600 text-white'
                    : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
                }`}
              >
                <Dices className="h-3 w-3 text-amber-600" />
                <span>추첨</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (roomSummaryPanel?.open) setRoomSummaryPanel(null);
                else void openInChatRoomSummary();
              }}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                roomSummaryPanel?.open
                  ? 'bg-[#008069] text-white'
                  : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              <Sparkles className="h-3 w-3 text-[#008069]" />
              <span>대화요약</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !showInChatAlerts;
                closeInlinePanels(next ? 'alerts' : undefined);
                setShowInChatAlerts(next);
              }}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                showInChatAlerts
                  ? 'bg-amber-600 text-white'
                  : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              <BellRing className="h-3 w-3 text-amber-600" />
              <span>
                통합알림
                {notifications.filter((n) => !n.read).length > 0
                  ? ` (${notifications.filter((n) => !n.read).length})`
                  : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !chatLeaveDraft?.open;
                closeInlinePanels(next ? 'leave_draft' : undefined);
                if (next) openInlineLeaveDraft();
                else setChatLeaveDraft(null);
              }}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                chatLeaveDraft?.open
                  ? 'bg-amber-600 text-white'
                  : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              <CalendarPlus className="h-3 w-3 text-rose-600" />
              <span>연차</span>
            </button>
            <button
              type="button"
              onClick={() => setViewOnceMode((v) => !v)}
              aria-pressed={viewOnceMode}
              title="수신자가 한 번만 열람할 수 있는 비밀 메시지 모드 전환 (/1회열람)"
              className={`h-6 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                viewOnceMode
                  ? 'bg-[#075E54] text-white font-bold'
                  : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-neutral-700 dark:text-neutral-200'
              }`}
            >
              <EyeOff className="h-3 w-3" />
              <span>1회 열람</span>
            </button>
            {onExportTranscript && (
              <button
                type="button"
                onClick={onExportTranscript}
                className="h-6 px-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-3 w-3 text-neutral-500" />
                <span>대화저장</span>
              </button>
            )}
          </div>

          {viewOnceMode && (
            <div className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#075E54] dark:text-[#07C160]">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3 shrink-0" />
                <span>1회 열람 비밀 메시지 모드 (수신자 열람 즉시 잠금)</span>
              </span>
              <button
                type="button"
                onClick={() => setViewOnceMode(false)}
                className="text-[10px] underline cursor-pointer shrink-0"
              >
                해제
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={2}
            value={draftText}
            onChange={(e) => handleTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onClick={(e) => setCursorPos(e.currentTarget.selectionStart ?? draftText.length)}
            onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart ?? draftText.length)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              viewOnceMode
                ? '1회 열람 비밀 메시지를 입력하세요 (전송 후 수신자 열람 1회만 허용)...'
                : '메시지 입력 · @이름 멘션 · / 명령어(/공지 · /긴급공지 · /1회열람 · /나스 · /메일 · /요약) · Ctrl+V 이미지'
            }
            aria-label="메시지 입력"
            className="w-full resize-none bg-transparent text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setShowPlusMenu((v) => !v);
                  setShowEmoticons(false);
                }}
                aria-label="첨부 및 기능 메뉴 열기"
                title="파일·공지·투표·연차"
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
              >
                <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmoticons((v) => !v);
                  setShowPlusMenu(false);
                }}
                aria-label="이모티콘 선택"
                title="이모티콘"
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
              >
                <Smile className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = `${draftText}${draftText && !draftText.endsWith(' ') ? ' ' : ''}@`;
                  onDraftChange(next);
                  setCursorPos(next.length);
                  textareaRef.current?.focus();
                }}
                aria-label="동료 멘션하기"
                title="@멘션"
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
              >
                <AtSign className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="파일 첨부"
                title="파일 첨부 (분할 업로드 지원)"
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={startVoiceRecording}
                aria-label="음성 메시지 녹음"
                title="음성 클립 녹음 및 전송"
                className="h-8 w-8 sm:h-9 sm:w-auto sm:px-2.5 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-[#07C160]/12 hover:text-[#075E54] dark:hover:text-[#07C160] cursor-pointer shrink-0"
              >
                <Mic className="h-4 w-4" />
                <span className="hidden md:inline whitespace-nowrap">음성 녹음</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (showVoiceCmdBar) {
                    stopVoiceCommandListening();
                    setShowVoiceCmdBar(false);
                  } else {
                    startVoiceCommandListening();
                  }
                }}
                aria-label="AI 음성 명령 실행"
                title="AI 음성 명령 (연차·SEDMS·달력·미팅메모·회의)"
                className={`h-8 w-8 sm:h-9 sm:w-auto sm:px-2 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold cursor-pointer shrink-0 ${
                  showVoiceCmdBar
                    ? 'bg-[#07C160]/15 text-[#075E54] dark:text-[#07C160]'
                    : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline whitespace-nowrap">음성 명령</span>
              </button>
              <button
                type="button"
                onClick={() => openInlineLeaveDraft()}
                aria-label="대화로 연차 등록 열기"
                title="대화로 연차 등록"
                className="sm:hidden h-8 w-8 rounded-xl flex items-center justify-center text-amber-700 dark:text-amber-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
              >
                <CalendarPlus className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {draftText.trim() && draftSavedAt && (
                <span
                  aria-live="polite"
                  className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 tabular-nums whitespace-nowrap"
                >
                  <Check className="h-3 w-3 text-[#07C160]" />
                  <span>임시저장됨 · {formatKoreanTime(new Date(draftSavedAt).toISOString())}</span>
                </span>
              )}
              {onScheduleMessage && (
                <button
                  type="button"
                  onClick={() => {
                    setScheduleContent((prev) => prev || draftText.trim());
                    setScheduleAtInput(
                      toLocalDatetimeInputValue(new Date(Date.now() + 5 * 60_000)),
                    );
                    setScheduleError(null);
                    setShowSchedulePopover((v) => !v);
                    setShowPlusMenu(false);
                    setShowEmoticons(false);
                  }}
                  aria-label="메시지 예약 전송"
                  title="메시지 예약 전송"
                  className={`h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                    showSchedulePopover
                      ? 'bg-[#07C160]/15 border-[#008069] text-[#075E54] dark:text-[#07C160]'
                      : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">예약</span>
                </button>
              )}
              <button
                type="submit"
                disabled={(!draftText.trim() && stagedFiles.length === 0) || sending}
                aria-label="메시지 전송"
                className="h-8 sm:h-9 px-3 sm:px-4 rounded-xl bg-[#008069] hover:bg-[#006B58] disabled:bg-neutral-200 dark:disabled:bg-neutral-800 text-white disabled:text-neutral-400 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{stagedFiles.length > 0 ? `전송 (${stagedFiles.length})` : '전송'}</span>
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
