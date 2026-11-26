import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  Loader2,
  Lock,
  Mail,
  Megaphone,
  Mic,
  Paperclip,
  Plus,
  Radio,
  Send,
  Siren,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { buildConciseMailDigest, filterNoticesByScope } from '../shared/controlTower';
import { formatFileSize, formatKoreanTime } from '../shared/logic';
import { NAS_DEFAULT_FOLDERS } from '../shared/nasShare';
import { getNoticePriorityMeta, normalizeNoticePriority } from '../shared/noticeAlert';
import {
  createMicAnalyser,
  mapSpeechRecognitionError,
  pickSupportedAudioMimeType,
  playVoiceCueTone,
  speakKoreanVoiceText,
  stopAllSpeechSynthesis,
  unlockAudioPlayback,
  type MicAnalyserHandle,
} from '../utils/voiceAudio';
import type {
  MailMessage,
  NasFolderInfo,
  Notice,
  NotificationItem,
  SedmsMenuKey,
  SharedFileItem,
  User,
} from '../types/client';

export type ControlTowerTab = 'brain' | 'mail' | 'notices' | 'alerts';

interface ControlTowerCard {
  kind: 'mail' | 'notice' | 'alert' | 'chat' | 'leave' | 'sedms';
  id: string;
  title: string;
  subtitle: string;
  bullets?: string[];
  actionLabel?: string;
  mailId?: string;
  roomId?: string;
  menuKey?: SedmsMenuKey;
}

interface ControlTowerResponse {
  intent: string;
  spokenReply: string;
  openedMailId?: string;
  uiAction?: 'open_large_link' | 'open_leave';
  createdNotice?: Notice;
  cards?: ControlTowerCard[];
  suggestedActions?: string[];
}

interface SpeechRecognitionAlt {
  transcript: string;
}

interface SpeechRecognitionResult {
  readonly length: number;
  [idx: number]: SpeechRecognitionAlt;
}

interface SpeechRecognitionEvt {
  readonly results: {
    readonly length: number;
    [idx: number]: SpeechRecognitionResult;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionEvt) => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface ControlTowerDrawerProps {
  initialTab?: ControlTowerTab;
  currentUser: User;
  usersById: Record<string, User>;
  mails: MailMessage[];
  notices: Notice[];
  notifications: NotificationItem[];
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onOpenMail: (mailId: string) => void;
  onOpenRoom: (roomId: string) => void;
  onOpenLeavePortal: () => void;
  onTriggerSedmsAction?: (menuKey: SedmsMenuKey, title: string, description: string) => void;
  onMailSimulated?: (mail: MailMessage, notifs: NotificationItem[]) => void;
  onMailSent?: (mail: MailMessage, uploadedFile?: SharedFileItem) => void;
  onScopedNoticeCreated?: (notice: Notice) => void;
  onAcknowledgeNotice?: (noticeId: string) => Promise<void> | void;
  onDeleteNotice?: (noticeId: string) => Promise<void> | void;
  onPushNoticeUrgent?: (noticeId: string) => Promise<void> | void;
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
}

const BRAIN_QUICK_COMMANDS = [
  '최근 빅메일 요약해줘',
  '비메일 상세히 열어줘',
  '전체 업무 공지 보여줘',
  '개인 공지 등록: 오늘 5시 코드리뷰',
  '전체 알람 브리핑',
  '미확인 채팅 알려줘',
];

export function ControlTowerDrawer({
  initialTab = 'brain',
  currentUser,
  usersById,
  mails,
  notices,
  notifications,
  apiFetch,
  onClose,
  onOpenMail,
  onOpenRoom,
  onOpenLeavePortal,
  onTriggerSedmsAction,
  onMailSimulated,
  onMailSent,
  onScopedNoticeCreated,
  onAcknowledgeNotice,
  onDeleteNotice,
  onPushNoticeUrgent,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}: ControlTowerDrawerProps) {
  const [tab, setTab] = useState<ControlTowerTab>(initialTab);
  const [commandInput, setCommandInput] = useState('');
  const [running, setRunning] = useState(false);
  const [listening, setListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0.2);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [ttsAutoSpeak, setTtsAutoSpeak] = useState(true);
  const [speaking, setSpeaking] = useState(false);

  const [history, setHistory] = useState<
    { id: string; query: string; response: ControlTowerResponse }[]
  >([]);

  // Scoped Notice Creator state
  const [noticeScope, setNoticeScope] = useState<'global' | 'personal'>('global');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeContent, setNoticeContent] = useState('');
  const [noticeIsUrgent, setNoticeIsUrgent] = useState(false);
  const [creatingNotice, setCreatingNotice] = useState(false);
  const [noticeFeedback, setNoticeFeedback] = useState<string | null>(null);

  // Incoming Mail Simulator & Compose Mail with NAS state
  const [simulatingProvider, setSimulatingProvider] = useState<'bigmail' | 'bmail' | null>(null);
  const [showComposeMail, setShowComposeMail] = useState(false);
  const [composeProvider, setComposeProvider] = useState<'bmail' | 'bigmail'>('bigmail');
  const [composeRecipientIds, setComposeRecipientIds] = useState<string[]>([]);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeAttachMode, setComposeAttachMode] = useState<'none' | 'nas_package' | 'nas_upload'>('nas_package');
  const [composeNasFolder, setComposeNasFolder] = useState<string>(NAS_DEFAULT_FOLDERS[0]);
  const [composeSourceNasPath, setComposeSourceNasPath] = useState('');
  const [composeNasFilename, setComposeNasFilename] = useState('SGW_대용량_납품패키지.tar.zst');
  const [composeNasSizeValue, setComposeNasSizeValue] = useState('100');
  const [composeNasSizeUnit, setComposeNasSizeUnit] = useState<'MB' | 'GB' | 'TB'>('GB');
  const [composeNasPasscode, setComposeNasPasscode] = useState('');
  const [composeNasMaxDownloads, setComposeNasMaxDownloads] = useState('10');
  const [composeNasExternalUrl, setComposeNasExternalUrl] = useState('');
  const [composeLocalFile, setComposeLocalFile] = useState<File | null>(null);
  const [composeNasFolders, setComposeNasFolders] = useState<NasFolderInfo[]>([]);
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeFeedback, setComposeFeedback] = useState<string | null>(null);

  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<MicAnalyserHandle | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mailFileInputRef = useRef<HTMLInputElement | null>(null);

  const mailRecipients = useMemo(
    () =>
      Object.values(usersById).filter(
        (u) => u.id !== currentUser.id && u.role !== 'bot',
      ),
    [usersById, currentUser.id],
  );

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (tab !== 'mail' || !showComposeMail) return;
    let active = true;
    apiFetch('/api/nas/folders')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { folders?: NasFolderInfo[] } | null) => {
        if (!active || !data?.folders) return;
        setComposeNasFolders(data.folders);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tab, showComposeMail, apiFetch]);

  useEffect(() => {
    return () => {
      stopAllSpeechSynthesis();
      stopAllVoiceRecording();
    };
  }, []);

  const globalNotices = useMemo(
    () => filterNoticesByScope(notices, currentUser.id, 'global'),
    [notices, currentUser.id],
  );
  const personalNotices = useMemo(
    () => filterNoticesByScope(notices, currentUser.id, 'personal'),
    [notices, currentUser.id],
  );
  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const stopAllVoiceRecording = () => {
    if (levelTimerRef.current) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    analyserRef.current?.stop();
    analyserRef.current = null;
    try {
      speechRef.current?.stop();
    } catch {
      // ignore
    }
    speechRef.current = null;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      try {
        if (typeof mr.requestData === 'function') {
          mr.requestData();
        }
        mr.stop();
      } catch {
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    } else {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setListening(false);
  };

  const runBrainCommand = async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd || running) return;
    setRunning(true);
    setVoiceStatus(null);
    try {
      const res = await apiFetch('/api/control-tower/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = (await res.json()) as ControlTowerResponse & { error?: string };
      if (!res.ok) {
        setVoiceStatus(data.error || '명령 처리 중 오류가 발생했습니다.');
        return;
      }

      setHistory((prev) => [
        ...prev.slice(-6),
        { id: `ct-${Date.now()}`, query: cmd, response: data },
      ]);
      setCommandInput('');

      if (data.createdNotice) {
        onScopedNoticeCreated?.(data.createdNotice);
      }
      if (data.openedMailId) {
        onOpenMail(data.openedMailId);
      }
      if (ttsAutoSpeak && data.spokenReply) {
        speakKoreanVoiceText(data.spokenReply, {
          onStart: () => setSpeaking(true),
          onEnd: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
      }
    } catch {
      setVoiceStatus('SG Talk AI 어시스턴트 서버와 통신할 수 없습니다.');
    } finally {
      setRunning(false);
    }
  };

  const startFallbackAudioRecorder = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceStatus('마이크 장치를 사용할 수 없어 아래 텍스트 입력으로 명령해 주세요.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      analyserRef.current = createMicAnalyser(stream);
      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 48000 });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        const activeStream = mediaStreamRef.current;
        mediaStreamRef.current = null;
        activeStream?.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size === 0) {
          setVoiceStatus('녹음된 음성 데이터가 비어 있습니다. 다시 말씀해 주세요.');
          return;
        }
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : undefined;
          if (!dataUrl) return;
          setVoiceStatus('녹음된 음성을 AI 서버로 분석 중입니다...');
          const res = await apiFetch('/api/voice/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioDataUrl: dataUrl,
              mimeType: recorder.mimeType || 'audio/webm',
              transcript: commandInput.trim() || undefined,
            }),
          }).catch(() => null);
          if (res && res.ok) {
            const analyzed = (await res.json()) as { transcript?: string };
            if (analyzed.transcript) {
              setCommandInput(analyzed.transcript);
              await runBrainCommand(analyzed.transcript);
            } else {
              setVoiceStatus('음성 텍스트를 인식하지 못했습니다. 다시 녹음하거나 입력해 주세요.');
            }
          } else {
            setVoiceStatus('음성 분석 요청 중 오류가 발생했습니다.');
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start(200);
      mediaRecorderRef.current = recorder;
      setListening(true);
      playVoiceCueTone('start');
      setVoiceStatus('음성 녹음 모드 활성화 · 말씀하신 뒤 다시 버튼을 누르면 AI가 분석해 실행합니다.');
      levelTimerRef.current = window.setInterval(() => {
        if (analyserRef.current) {
          setMicLevel(analyserRef.current.readNormalizedLevel());
        }
      }, 150);
    } catch {
      setListening(false);
      setVoiceStatus('마이크 권한을 허용해 주세요. 텍스트로도 동일한 명령이 실행됩니다.');
    }
  };

  const handleToggleVoice = async () => {
    void unlockAudioPlayback();
    if (listening) {
      playVoiceCueTone('stop');
      stopAllVoiceRecording();
      return;
    }

    setVoiceStatus(null);
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      await startFallbackAudioRecorder();
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
          setCommandInput(transcript.trim());
        }
      };
      rec.onerror = async (ev) => {
        const code = ev?.error ?? '';
        setListening(false);
        if (code === 'network' || code === 'service-not-allowed') {
          await startFallbackAudioRecorder();
        } else {
          setVoiceStatus(mapSpeechRecognitionError(code));
        }
      };
      rec.onend = () => {
        setListening(false);
      };
      speechRef.current = rec;
      playVoiceCueTone('start');
      rec.start();
      setListening(true);
      setVoiceStatus('듣고 있습니다... 예: "최근 빅메일 요약해줘", "전체 업무 공지 보여줘"');
    } catch {
      await startFallbackAudioRecorder();
    }
  };

  const handleSimulateMail = async (provider: 'bigmail' | 'bmail') => {
    if (simulatingProvider) return;
    setSimulatingProvider(provider);
    try {
      const res = await apiFetch('/api/mail/simulate-incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          mail?: MailMessage;
          notifications?: NotificationItem[];
        };
        if (data.mail) {
          onMailSimulated?.(data.mail, data.notifications ?? []);
          playVoiceCueTone('notify');
        }
      }
    } finally {
      setSimulatingProvider(null);
    }
  };

  const handleSendComposeMail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (composeSending) return;
    setComposeError(null);
    setComposeFeedback(null);

    const targetRecipients =
      composeRecipientIds.length > 0
        ? composeRecipientIds
        : mailRecipients[0]
          ? [mailRecipients[0].id]
          : [];
    if (targetRecipients.length === 0) {
      setComposeError('수신자를 최소 1명 이상 선택해 주세요.');
      return;
    }
    if (!composeSubject.trim()) {
      setComposeError('메일 제목을 입력해 주세요.');
      return;
    }

    setComposeSending(true);
    try {
      let existingAttachmentIds: string[] = [];
      let uploadedFileRecord: SharedFileItem | undefined;

      if (composeAttachMode === 'nas_upload') {
        if (!composeLocalFile) {
          setComposeError('내 PC에서 NAS로 복사할 파일을 선택해 주세요.');
          return;
        }
        const fd = new FormData();
        fd.append('file', composeLocalFile);
        fd.append('nasFolder', composeNasFolder);
        if (composeNasPasscode.trim()) fd.append('passcode', composeNasPasscode.trim());
        const maxNum = Number(composeNasMaxDownloads);
        if (composeNasMaxDownloads.trim() && Number.isFinite(maxNum) && maxNum > 0) {
          fd.append('maxDownloads', String(Math.floor(maxNum)));
        }
        const uploadRes = await apiFetch('/api/nas/upload', {
          method: 'POST',
          body: fd,
        });
        const uploadData = (await uploadRes.json().catch(() => ({}))) as {
          file?: SharedFileItem;
          error?: string;
        };
        if (!uploadRes.ok || !uploadData.file) {
          setComposeError(uploadData.error || 'NAS 폴더 업로드에 실패했습니다.');
          return;
        }
        existingAttachmentIds = [uploadData.file.id];
        uploadedFileRecord = uploadData.file;
      }

      const payload: Record<string, unknown> = {
        provider: composeProvider,
        recipientIds: targetRecipients,
        subject: composeSubject.trim(),
        body: composeBody.trim() || `${composeSubject.trim()} 관련 파일 및 안내 전달드립니다.`,
        category: '일반',
        ...(existingAttachmentIds.length > 0 ? { existingAttachmentIds } : {}),
      };

      if (composeAttachMode === 'nas_package') {
        const cleanFilename = composeNasFilename.trim();
        if (!cleanFilename) {
          setComposeError('NAS 폴더에 복사할 파일명을 입력해 주세요.');
          return;
        }
        payload.nasShare = {
          nasFolder: composeNasFolder,
          filename: cleanFilename,
          ...(composeSourceNasPath ? { sourceNasRelativePath: composeSourceNasPath } : {}),
          ...(composeNasExternalUrl.trim()
            ? { externalNasUrl: composeNasExternalUrl.trim() }
            : {}),
          sizeValue: Math.max(1, Number(composeNasSizeValue) || 100),
          sizeUnit: composeNasSizeUnit,
          expiresDays: 7,
          ...(composeNasPasscode.trim() ? { passcode: composeNasPasscode.trim() } : {}),
          ...(composeNasMaxDownloads.trim() && Number(composeNasMaxDownloads) > 0
            ? { maxDownloads: Math.floor(Number(composeNasMaxDownloads)) }
            : {}),
        };
      }

      const res = await apiFetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        mail?: MailMessage;
        error?: string;
      };
      if (!res.ok || !data.mail) {
        setComposeError(data.error || '메일 발송에 실패했습니다.');
        return;
      }

      onMailSent?.(data.mail, uploadedFileRecord);
      setComposeSubject('');
      setComposeBody('');
      setComposeLocalFile(null);
      setComposeSourceNasPath('');
      setComposeFeedback(
        `${composeProvider === 'bigmail' ? '빅메일' : '비메일(bmail)'} 발송 및 NAS 외부 링크 첨부가 완료되었습니다.`,
      );
      setShowComposeMail(false);
    } finally {
      setComposeSending(false);
    }
  };

  const handleCreateScopedNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeTitle.trim() || !noticeContent.trim() || creatingNotice) return;
    setCreatingNotice(true);
    setNoticeFeedback(null);
    const urgentFlag = noticeScope === 'global' && noticeIsUrgent;
    try {
      const res = await apiFetch('/api/notices/scoped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: noticeScope,
          title: noticeTitle.trim(),
          content: noticeContent.trim(),
          pinned: true,
          priority: urgentFlag ? 'urgent' : 'normal',
          isUrgent: urgentFlag,
          pushAllMembers: urgentFlag,
        }),
      });
      const data = (await res.json()) as { notice?: Notice; error?: string };
      if (!res.ok) {
        setNoticeFeedback(data.error || '공지 등록에 실패했습니다.');
        return;
      }
      if (data.notice) {
        onScopedNoticeCreated?.(data.notice);
        setNoticeTitle('');
        setNoticeContent('');
        setNoticeIsUrgent(false);
        setNoticeFeedback(
          urgentFlag
            ? '전 회원 긴급재난문자 공지가 즉시 발송되었습니다.'
            : noticeScope === 'global'
              ? '전체 업무 공지사항이 전사 채널과 알람으로 등록되었습니다.'
              : '개인 공지사항이 내 보관함에 안전하게 등록되었습니다.',
        );
      }
    } finally {
      setCreatingNotice(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="SG Talk AI 음성 어시스턴트"
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex justify-end"
    >
      <div className="w-full max-w-2xl h-full bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col">
        {/* Top Bar */}
        <header className="shrink-0 px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-[#075E54] text-[#FEE500] flex items-center justify-center shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-neutral-900 dark:text-white truncate">
                SG Talk AI 통합 어시스턴트
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                빅메일 · 비메일 · 전체 업무·개인 공지 · 채팅 · 음성 제어 통합 비서
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (speaking) {
                  stopAllSpeechSynthesis();
                  setSpeaking(false);
                }
                setTtsAutoSpeak((v) => !v);
              }}
              aria-label={ttsAutoSpeak ? '음성 브리핑 자동 읽기 끄기' : '음성 브리핑 자동 읽기 켜기'}
              className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {ttsAutoSpeak ? (
                <Volume2 className="h-3.5 w-3.5 text-[#008069] dark:text-[#07C160]" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-neutral-400" />
              )}
              <span>{ttsAutoSpeak ? '음성 응답 켜짐' : '음성 응답 꺼짐'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="어시스턴트 창 닫기"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Segmented Control Tabs */}
        <div className="shrink-0 px-5 py-2.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-950/60">
          <div
            role="tablist"
            aria-label="SG Talk 어시스턴트 섹션"
            className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-neutral-200/70 dark:bg-neutral-800"
          >
            {(
              [
                { id: 'brain', label: 'AI 비서' },
                { id: 'mail', label: `빅메일·비메일 (${mails.length})` },
                { id: 'notices', label: `전체·개인 공지 (${globalNotices.length + personalNotices.length})` },
                { id: 'alerts', label: `전체 알람 (${unreadNotifCount})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium whitespace-nowrap truncate transition-colors cursor-pointer ${
                  tab === t.id
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-semibold shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto chat-scroll p-5 space-y-5">
          {tab === 'brain' && (
            <>
              {/* Voice + Text Command Bar */}
              <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
                    <span>말로 제어하는 SG Talk 통합 비서</span>
                  </span>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    음성 인식 · AI 요약 · 즉시 이동
                  </span>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runBrainCommand(commandInput);
                  }}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={handleToggleVoice}
                    aria-label={listening ? '음성 명령 중지' : '음성 명령 시작'}
                    className={`h-10 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      listening
                        ? 'bg-red-500 border-red-500 text-white'
                        : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-[#075E54] dark:text-[#07C160] hover:bg-neutral-100'
                    }`}
                  >
                    {listening && (
                      <span
                        className="h-2 w-2 rounded-full bg-white animate-pulse"
                        style={{ opacity: Math.max(0.5, micLevel) }}
                      />
                    )}
                    <Mic className="h-4 w-4" />
                    <span>{listening ? '중지' : '말하기'}</span>
                  </button>

                  <input
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    placeholder='예: "최근 빅메일 요약해줘", "개인 공지 등록: 내일 배포 점검"'
                    aria-label="음성 또는 텍스트 업무 명령"
                    className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-sm text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                  />

                  <button
                    type="submit"
                    disabled={running || !commandInput.trim()}
                    className="h-10 px-4 rounded-xl bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {running ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    <span>실행</span>
                  </button>
                </form>

                {voiceStatus && (
                  <p className="text-xs text-neutral-600 dark:text-neutral-300">{voiceStatus}</p>
                )}

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {BRAIN_QUICK_COMMANDS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={running}
                      onClick={() => {
                        setCommandInput(q);
                        runBrainCommand(q);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 hover:border-[#008069] text-[11px] font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversation & Execution Feed */}
              {history.length === 0 ? (
                <div className="p-8 rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 text-center space-y-2">
                  <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                    무엇이든 말씀하시거나 위 명령 버튼을 선택하세요
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    수신된 빅메일·비메일 요약, 상세 메일 열기, 전체·개인 공지 등록 및 조회, 채팅 브리핑까지 한 곳에서 제어합니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((turn) => (
                    <div
                      key={turn.id}
                      className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-neutral-900 dark:text-white">
                          질의 · {turn.query}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            speakKoreanVoiceText(turn.response.spokenReply, {
                              onStart: () => setSpeaking(true),
                              onEnd: () => setSpeaking(false),
                              onError: () => setSpeaking(false),
                            })
                          }
                          className="text-xs font-semibold text-[#008069] dark:text-[#07C160] hover:underline flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          <span>다시 듣기</span>
                        </button>
                      </div>

                      <p className="text-sm text-neutral-800 dark:text-neutral-100 leading-relaxed whitespace-pre-wrap">
                        {turn.response.spokenReply}
                      </p>

                      {turn.response.cards && turn.response.cards.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                          {turn.response.cards.map((card) => (
                            <div
                              key={card.id}
                              className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/80 dark:border-neutral-700/70 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="text-xs font-bold text-neutral-900 dark:text-white">
                                  {card.title}
                                </div>
                                <div className="text-xs text-neutral-600 dark:text-neutral-300 leading-snug">
                                  {card.subtitle}
                                </div>
                                {card.bullets && card.bullets.length > 0 && (
                                  <ul className="pt-1 space-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                                    {card.bullets.map((b, bi) => (
                                      <li key={bi}>• {b}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              <div className="shrink-0">
                                {card.mailId ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenMail(card.mailId!)}
                                    className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {card.actionLabel || '상세히 보기 (이메일 앱)'}
                                  </button>
                                ) : card.roomId ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onOpenRoom(card.roomId!);
                                      onClose();
                                    }}
                                    className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {card.actionLabel || '대화방 이동'}
                                  </button>
                                ) : card.kind === 'leave' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onOpenLeavePortal();
                                      onClose();
                                    }}
                                    className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {card.actionLabel || '내 연차 화면'}
                                  </button>
                                ) : card.menuKey && onTriggerSedmsAction ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onTriggerSedmsAction(card.menuKey!, card.title, card.subtitle);
                                      onClose();
                                    }}
                                    className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {card.actionLabel || '열기'}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'mail' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <div>
                  <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                    빅메일 · 비메일 수신 요약 및 NAS 발송
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    내부에서는 NAS 폴더에 복사하고 외부에는 보안 링크를 첨부해 bmail·빅메일로 발송합니다.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowComposeMail((v) => !v);
                      setComposeError(null);
                      setComposeFeedback(null);
                    }}
                    className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                      showComposeMail
                        ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                        : 'bg-[#075E54] hover:bg-[#054a42] text-white'
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>bmail · 빅메일 쓰기 (NAS 첨부)</span>
                  </button>
                  <button
                    type="button"
                    disabled={simulatingProvider !== null}
                    onClick={() => handleSimulateMail('bigmail')}
                    className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-100 text-xs font-semibold text-neutral-800 dark:text-neutral-100 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {simulatingProvider === 'bigmail' ? '수신 중...' : '+ 빅메일 수신'}
                  </button>
                  <button
                    type="button"
                    disabled={simulatingProvider !== null}
                    onClick={() => handleSimulateMail('bmail')}
                    className="h-8 px-2.5 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {simulatingProvider === 'bmail' ? '수신 중...' : '+ 비메일 수신'}
                  </button>
                </div>
              </div>

              {composeFeedback && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  {composeFeedback}
                </div>
              )}

              {showComposeMail && (
                <form
                  onSubmit={handleSendComposeMail}
                  className="p-4 rounded-2xl border border-[#008069]/30 bg-emerald-50/40 dark:bg-neutral-800/60 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#075E54] dark:text-[#07C160] flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4" />
                      <span>bmail · 빅메일 새 메일 작성 (사내 NAS 복사 + 외부 링크 첨부)</span>
                    </span>
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-neutral-200/80 dark:bg-neutral-900">
                      {(
                        [
                          { id: 'bigmail', label: '빅메일 (초대용량)' },
                          { id: 'bmail', label: '비메일 (bmail)' },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setComposeProvider(p.id)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                            composeProvider === p.id
                              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-2xs'
                              : 'text-neutral-600 dark:text-neutral-400'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 mb-1">
                      수신자 선택 (미선택 시 첫 번째 동료에게 발송)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {mailRecipients.map((u) => {
                        const picked = composeRecipientIds.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              setComposeRecipientIds((prev) =>
                                picked ? prev.filter((id) => id !== u.id) : [...prev, u.id],
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                              picked
                                ? 'bg-[#008069] border-[#008069] text-white'
                                : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {u.name} {u.position}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <input
                    type="text"
                    required
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="메일 제목 입력..."
                    aria-label="메일 제목"
                    className="w-full h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                  />

                  <textarea
                    rows={2}
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="메일 본문을 입력하세요..."
                    aria-label="메일 본문"
                    className="w-full p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                  />

                  <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/90 dark:bg-neutral-900 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-1">
                        <FolderOpen className="h-3.5 w-3.5 text-[#008069]" />
                        <span>첨부 방식</span>
                      </span>
                      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                        {(
                          [
                            { id: 'nas_package', label: 'NAS 대용량 복사·링크 (100GB+)' },
                            { id: 'nas_upload', label: 'PC 파일 → NAS 업로드' },
                            { id: 'none', label: '첨부 없음' },
                          ] as const
                        ).map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setComposeAttachMode(mode.id)}
                            className={`px-2 py-1 rounded-md text-[10px] font-semibold cursor-pointer ${
                              composeAttachMode === mode.id
                                ? 'bg-[#008069] text-white'
                                : 'text-neutral-600 dark:text-neutral-300'
                            }`}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {composeAttachMode !== 'none' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300 space-y-1">
                            <span>사내 NAS 대상 폴더</span>
                            <select
                              value={composeNasFolder}
                              onChange={(e) => setComposeNasFolder(e.target.value)}
                              aria-label="메일 첨부 NAS 폴더"
                              className="w-full h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs"
                            >
                              {(composeNasFolders.length > 0
                                ? composeNasFolders.map((f) => f.folder)
                                : [...NAS_DEFAULT_FOLDERS]
                              ).map((folder) => (
                                <option key={folder} value={folder}>
                                  {folder}
                                </option>
                              ))}
                            </select>
                          </label>

                          {composeAttachMode === 'nas_upload' ? (
                            <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300 space-y-1">
                              <span>PC 파일 선택 (20MB 이하)</span>
                              <div className="flex items-center gap-2">
                                <input
                                  ref={mailFileInputRef}
                                  type="file"
                                  className="hidden"
                                  onChange={(ev) => {
                                    const picked = ev.target.files?.[0] ?? null;
                                    setComposeLocalFile(picked);
                                    ev.target.value = '';
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => mailFileInputRef.current?.click()}
                                  className="h-8 px-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-semibold flex items-center gap-1 cursor-pointer truncate max-w-full"
                                >
                                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">
                                    {composeLocalFile ? composeLocalFile.name : '파일 선택'}
                                  </span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300 space-y-1">
                              <span>기존 NAS 파일에서 가져오기 (선택)</span>
                              <select
                                value={composeSourceNasPath}
                                onChange={(e) => {
                                  const rel = e.target.value;
                                  setComposeSourceNasPath(rel);
                                  if (rel) {
                                    const leaf = rel.split('/').pop() || '';
                                    if (leaf) setComposeNasFilename(leaf);
                                  }
                                }}
                                aria-label="기존 NAS 파일 선택"
                                className="w-full h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs"
                              >
                                <option value="">새 대용량 NAS 패키지 생성</option>
                                {composeNasFolders.flatMap((folderInfo) =>
                                  folderInfo.files.map((item) => (
                                    <option key={item.relativePath} value={item.relativePath}>
                                      {item.relativePath} ({formatFileSize(item.size)})
                                    </option>
                                  )),
                                )}
                              </select>
                            </label>
                          )}
                        </div>

                        {composeAttachMode === 'nas_package' && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={composeNasFilename}
                              onChange={(e) => setComposeNasFilename(e.target.value)}
                              placeholder="NAS 파일명"
                              aria-label="메일 NAS 파일명"
                              className="sm:col-span-2 h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs"
                            />
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                value={composeNasSizeValue}
                                onChange={(e) => setComposeNasSizeValue(e.target.value)}
                                aria-label="메일 NAS 용량"
                                className="w-full h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs tabular-nums"
                              />
                              <select
                                value={composeNasSizeUnit}
                                onChange={(e) =>
                                  setComposeNasSizeUnit(e.target.value as 'MB' | 'GB' | 'TB')
                                }
                                aria-label="메일 NAS 용량 단위"
                                className="h-8 px-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs"
                              >
                                <option value="MB">MB</option>
                                <option value="GB">GB</option>
                                <option value="TB">TB</option>
                              </select>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="text-[10px] text-neutral-500 flex items-center gap-1 h-8 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
                            <Lock className="h-3 w-3 shrink-0" />
                            <input
                              type="password"
                              value={composeNasPasscode}
                              onChange={(e) => setComposeNasPasscode(e.target.value)}
                              placeholder="비밀번호(선택 4~24자)"
                              aria-label="메일 NAS 비밀번호"
                              className="w-full bg-transparent text-xs focus:outline-none"
                            />
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={composeNasMaxDownloads}
                            onChange={(e) => setComposeNasMaxDownloads(e.target.value)}
                            placeholder="최대 다운로드 횟수"
                            aria-label="메일 NAS 최대 다운로드 횟수"
                            className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs tabular-nums"
                          />
                          {composeAttachMode === 'nas_package' && (
                            <input
                              type="url"
                              value={composeNasExternalUrl}
                              onChange={(e) => setComposeNasExternalUrl(e.target.value)}
                              placeholder="외부 NAS URL (선택)"
                              aria-label="메일 외부 NAS 게이트웨이 URL"
                              className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs"
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {composeError && (
                    <p className="text-xs font-medium text-red-600 dark:text-red-400">
                      {composeError}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowComposeMail(false)}
                      className="h-8 px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={composeSending}
                      className="h-8 px-3.5 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {composeSending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {composeSending
                          ? '발송 중...'
                          : `${composeProvider === 'bigmail' ? '빅메일' : '비메일'} 발송`}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {mails.length === 0 ? (
                <p className="py-10 text-center text-xs text-neutral-400">
                  도착한 메일이 없습니다.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {mails.map((m) => {
                    const sender = usersById[m.senderId];
                    const senderName = sender ? `${sender.name} ${sender.position}` : '임직원';
                    const digest = buildConciseMailDigest(m, senderName);
                    const unread = !m.readByUserIds.includes(currentUser.id);
                    const nasAtt = (m.attachments ?? []).find((a) => a.nasFolder);
                    return (
                      <div
                        key={m.id}
                        className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center flex-wrap gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                            <span className="font-bold text-[#008069] dark:text-[#07C160]">
                              {digest.providerLabel}
                            </span>
                            {nasAtt?.nasFolder && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-[#075E54] dark:text-[#07C160] text-[10px] font-bold">
                                NAS: {nasAtt.nasFolder}
                              </span>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>{senderName}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{formatKoreanTime(m.createdAt)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{unread ? '새 메일' : '읽음'}</span>
                          </div>
                          <div className="text-sm font-bold text-neutral-900 dark:text-white truncate">
                            {m.subject}
                          </div>
                          <p className="text-xs text-neutral-600 dark:text-neutral-300 truncate">
                            {digest.shortSummary}
                          </p>
                          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                            {digest.attachmentLabel}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onOpenMail(m.id)}
                          className="h-9 px-3.5 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          <span>상세히 보기 (이메일 앱)</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'notices' && (
            <div className="space-y-6">
              {/* Create Global or Personal Notice */}
              <form
                onSubmit={handleCreateScopedNotice}
                className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-3"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                    <Megaphone className="h-4 w-4 text-amber-600" />
                    <span>공지사항 등록 (전체 업무 · 개인 구분)</span>
                  </span>
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-neutral-200/80 dark:bg-neutral-800">
                    <button
                      type="button"
                      onClick={() => setNoticeScope('global')}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                        noticeScope === 'global'
                          ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                          : 'text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      전체 업무 공지
                    </button>
                    <button
                      type="button"
                      onClick={() => setNoticeScope('personal')}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                        noticeScope === 'personal'
                          ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                          : 'text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      개인 공지
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  required
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  placeholder={
                    noticeScope === 'global'
                      ? '전체 업무 공지 제목 (전 사원 알림 발송)'
                      : '개인 공지 제목 (나만 보는 개인 공지)'
                  }
                  aria-label="공지 제목"
                  className="w-full h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                />
                <textarea
                  rows={2}
                  required
                  value={noticeContent}
                  onChange={(e) => setNoticeContent(e.target.value)}
                  placeholder="공지 내용을 입력하세요..."
                  aria-label="공지 내용"
                  className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                />
                {noticeScope === 'global' && (
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/30 text-xs font-semibold text-red-700 dark:text-red-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noticeIsUrgent}
                      onChange={(e) => setNoticeIsUrgent(e.target.checked)}
                      className="h-4 w-4 accent-red-600 cursor-pointer"
                    />
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>긴급 알림 (Urgent Alert) · 재난문자처럼 전 회원에게 즉시 푸시</span>
                  </label>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {noticeFeedback ||
                      (noticeScope === 'global'
                        ? '전사 공지 채팅방과 전체 사원 알람으로 즉시 전파됩니다.'
                        : '본인 계정 및 나와의 채팅에만 표시됩니다.')}
                  </span>
                  <button
                    type="submit"
                    disabled={creatingNotice || !noticeTitle.trim() || !noticeContent.trim()}
                    className={`h-9 px-3.5 rounded-xl disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                      noticeScope === 'global' && noticeIsUrgent
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-[#008069] hover:bg-[#006B58]'
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      {creatingNotice
                        ? '등록 중...'
                        : noticeScope === 'global' && noticeIsUrgent
                          ? '긴급 재난문자 발송'
                          : '공지 등록'}
                    </span>
                  </button>
                </div>
              </form>

              {/* Global Work Notices Section */}
              <section aria-label="전체 업무 공지사항" className="space-y-2.5">
                <h3 className="text-xs font-bold text-neutral-700 dark:text-neutral-200">
                  전체 업무 공지사항 ({globalNotices.length}건)
                </h3>
                {globalNotices.length === 0 ? (
                  <p className="text-xs text-neutral-400">등록된 전체 업무 공지가 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {globalNotices.map((n) => {
                      const author = usersById[n.authorId];
                      const priority = normalizeNoticePriority({
                        priority: n.priority,
                        isUrgent: n.isUrgent,
                      });
                      const meta = getNoticePriorityMeta(priority);
                      const isUrgent = priority === 'urgent';
                      const ackList = n.acknowledgedBy ?? [];
                      const iAcked = ackList.includes(currentUser.id);
                      const canManage =
                        n.authorId === currentUser.id || currentUser.role === 'admin';
                      return (
                        <div
                          key={n.id}
                          className={`p-3.5 rounded-xl border space-y-2 ${
                            isUrgent
                              ? 'border-red-300 dark:border-red-800 bg-red-50/70 dark:bg-red-950/30'
                              : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                            <span className="flex items-center gap-1.5 min-w-0">
                              {isUrgent && <Siren className="h-3.5 w-3.5 text-red-600 shrink-0" />}
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                                  isUrgent
                                    ? 'bg-red-600 text-white'
                                    : 'bg-emerald-600/15 text-[#075E54] dark:text-[#07C160]'
                                }`}
                              >
                                {meta.badgeText}
                              </span>
                              <span className="truncate">
                                전체 업무 공지 · {author?.name ?? '관리자'}
                              </span>
                            </span>
                            <span className="tabular-nums shrink-0">
                              {formatKoreanTime(n.createdAt)} · 확인 {ackList.length}명
                            </span>
                          </div>
                          <div className="text-sm font-bold text-neutral-900 dark:text-white">
                            {n.title}
                          </div>
                          <p className="text-xs text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
                            {n.content}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {onAcknowledgeNotice && (
                              <button
                                type="button"
                                onClick={() => onAcknowledgeNotice(n.id)}
                                className={`h-7 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                                  iAcked
                                    ? 'bg-emerald-600/15 text-[#008069] dark:text-[#07C160]'
                                    : 'bg-[#008069] hover:bg-[#006B58] text-white'
                                }`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>{iAcked ? '확인 완료됨' : '공지 확인'}</span>
                              </button>
                            )}
                            {onPushNoticeUrgent && (
                              <button
                                type="button"
                                onClick={() => onPushNoticeUrgent(n.id)}
                                className="h-7 px-2.5 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-700 dark:text-red-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Radio className="h-3.5 w-3.5" />
                                <span>재난문자 전파</span>
                              </button>
                            )}
                            {canManage && onDeleteNotice && (
                              <button
                                type="button"
                                onClick={() => onDeleteNotice(n.id)}
                                className="h-7 px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer ml-auto"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>삭제</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Personal Notices Section */}
              <section aria-label="개인 공지사항" className="space-y-2.5">
                <h3 className="text-xs font-bold text-neutral-700 dark:text-neutral-200">
                  개인 공지사항 ({personalNotices.length}건)
                </h3>
                {personalNotices.length === 0 ? (
                  <p className="text-xs text-neutral-400">등록된 개인 공지가 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {personalNotices.map((n) => (
                      <div
                        key={n.id}
                        className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                          <span>
                            내 개인 공지 ·{' '}
                            <span className="tabular-nums">{formatKoreanTime(n.createdAt)}</span>
                          </span>
                          {onDeleteNotice && (
                            <button
                              type="button"
                              onClick={() => onDeleteNotice(n.id)}
                              className="text-[11px] text-red-600 hover:underline cursor-pointer"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                        <div className="text-sm font-bold text-neutral-900 dark:text-white">
                          {n.title}
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
                          {n.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'alerts' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-200 dark:border-neutral-800">
                <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                  SG Talk 전체 통합 알람 ({unreadNotifCount}건 미확인)
                </h3>
                {unreadNotifCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllNotificationsRead}
                    className="text-xs font-semibold text-[#008069] dark:text-[#07C160] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    모두 읽음 처리
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <p className="py-10 text-center text-xs text-neutral-400">수신된 알람이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        n.read
                          ? 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
                          : 'border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <BellRing
                          className={`h-4 w-4 mt-0.5 shrink-0 ${
                            n.read ? 'text-neutral-400' : 'text-amber-600 dark:text-amber-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-neutral-900 dark:text-white">
                            {n.title}
                          </div>
                          <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                            {n.body}
                          </p>
                          <div className="mt-1 text-[11px] text-neutral-400 tabular-nums">
                            {formatKoreanTime(n.createdAt)} · {n.read ? '읽음' : '새 알람'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {n.mailId && (
                          <button
                            type="button"
                            onClick={() => {
                              onMarkNotificationRead(n.id);
                              onOpenMail(n.mailId!);
                            }}
                            className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            상세히 보기 (이메일 앱)
                          </button>
                        )}
                        {n.roomId && (
                          <button
                            type="button"
                            onClick={() => {
                              onMarkNotificationRead(n.id);
                              onOpenRoom(n.roomId!);
                              onClose();
                            }}
                            className="h-8 px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            대화방 보기
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
