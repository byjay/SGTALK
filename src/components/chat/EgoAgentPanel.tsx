import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  MessageSquareText,
  Mic,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { sanitizeSafeHttpUrl } from '../../shared/egoPlanner';
import {
  mapSpeechRecognitionError,
  pickSupportedAudioMimeType,
  playVoiceCueTone,
} from '../../utils/voiceAudio';
import type {
  EgoRunResult,
  EgoToolExecution,
  IntegrationActionSummary,
  KakaoFreeApiStatus,
  Message,
} from '../../types/client';

interface EgoAgentPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onTriggerIntegration?: (
    summary: IntegrationActionSummary,
    options?: { recordInChat?: boolean },
  ) => Promise<void> | void;
  onEgoSelfMessage?: (message: Message) => void;
  onClose?: () => void;
}

const EGO_QUICK_GOALS = [
  '판교 회식 장소 찾아서 미팅메모 작성하고 내 카톡으로 보내줘',
  '프로젝트 달력 확인하고 회의 바로 시작해줘',
  '최신 TypeScript 보안 동향 검색해서 문서관리 열어줘',
  '오늘 접속 중인 팀원 확인하고 내일 연차 신청 준비해줘',
];

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

function getProviderBadgeLabel(provider: EgoToolExecution['provider']): string {
  switch (provider) {
    case 'KAKAO_LOCAL':
      return '카카오 로컬';
    case 'KAKAO_SEARCH':
      return '다음 검색';
    case 'KAKAO_TALK':
      return '카톡 나에게';
    case 'KAKAO_CALENDAR':
      return '톡캘린더';
    case 'SEDMS':
      return 'SEDMS';
    default:
      return 'SGW';
  }
}

export function EgoAgentPanel({
  apiFetch,
  onTriggerIntegration,
  onEgoSelfMessage,
  onClose,
}: EgoAgentPanelProps) {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [listening, setListening] = useState(false);
  const [linkingKakao, setLinkingKakao] = useState(false);
  const [kakaoPopupFallbackUrl, setKakaoPopupFallbackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<KakaoFreeApiStatus | null>(null);
  const [result, setResult] = useState<EgoRunResult | null>(null);

  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const loadStatus = async () => {
    try {
      const res = await apiFetch('/api/ego/status');
      if (res.ok) {
        const data = (await res.json()) as KakaoFreeApiStatus;
        setStatus(data);
      }
    } catch {
      // Ignore transient network errors
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    const handleMessage = (evt: MessageEvent) => {
      if (evt.origin !== window.location.origin) return;
      const data = evt.data as {
        type?: string;
        scopes?: string[];
        error?: string;
      } | null;
      if (!data) return;
      if (data.type === 'KAKAO_LINK_SUCCESS') {
        setLinkingKakao(false);
        setKakaoPopupFallbackUrl(null);
        setError(null);
        loadStatus();
      } else if (data.type === 'KAKAO_AUTH_ERROR') {
        setLinkingKakao(false);
        if (data.error) setError(data.error);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      try {
        speechRef.current?.stop();
      } catch {
        // ignore
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleLinkKakaoApis = async () => {
    setError(null);
    setLinkingKakao(true);
    try {
      const res = await apiFetch('/api/auth/kakao/link-url');
      const data = (await res.json()) as {
        configured?: boolean;
        url?: string;
        error?: string;
      };
      if (data.configured && data.url) {
        setKakaoPopupFallbackUrl(null);
        const popup = window.open(
          data.url,
          'kakao_ego_scope_link',
          'width=480,height=680,menubar=no,toolbar=no',
        );
        if (!popup) {
          setKakaoPopupFallbackUrl(data.url);
          setError('팝업이 차단되었습니다. 아래 새 탭 버튼으로 카카오 동의를 완료해 주세요.');
          setLinkingKakao(false);
        }
        return;
      }
      setError(
        data.error ||
          'KAKAO_CLIENT_ID가 설정되어 있지 않아 카카오톡 나에게 보내기·톡캘린더 OAuth 연동을 열 수 없습니다.',
      );
      setLinkingKakao(false);
    } catch {
      setError('카카오 연동 URL 요청 중 오류가 발생했습니다.');
      setLinkingKakao(false);
    }
  };

  const stopAudioFallbackCapture = async () => {
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (!mr || mr.state === 'inactive') {
      audioChunksRef.current = [];
      return;
    }
    const audioDataUrl = await new Promise<string | undefined>((resolve) => {
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        if (blob.size > 0) {
          const reader = new FileReader();
          reader.onloadend = () =>
            resolve(typeof reader.result === 'string' ? reader.result : undefined);
          reader.onerror = () => resolve(undefined);
          reader.readAsDataURL(blob);
        } else {
          resolve(undefined);
        }
      };
      try {
        mr.stop();
      } catch {
        resolve(undefined);
      }
    });

    if (audioDataUrl) {
      const res = await apiFetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioDataUrl, mimeType: mr.mimeType || 'audio/webm' }),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as { transcript?: string };
        if (data.transcript?.trim()) {
          setGoal(data.transcript.trim());
        }
      }
    }
  };

  const handleToggleVoice = async () => {
    if (listening) {
      playVoiceCueTone('stop');
      try {
        speechRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
      await stopAudioFallbackCapture();
      return;
    }

    const startAudioFallback = async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setError('현재 환경에서는 마이크 음성 입력을 사용할 수 없습니다. 텍스트로 목표를 입력해 주세요.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const mimeType = pickSupportedAudioMimeType();
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        audioChunksRef.current = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setListening(true);
        playVoiceCueTone('start');
      } catch {
        setError('마이크 권한을 확인할 수 없습니다. 텍스트로 목표를 입력해 주세요.');
      }
    };

    const SpeechCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;

    if (!SpeechCtor) {
      setError(null);
      await startAudioFallback();
      return;
    }

    setError(null);
    try {
      const rec = new SpeechCtor();
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = 0; i < ev.results.length; i += 1) {
          transcript += ev.results[i][0]?.transcript ?? '';
        }
        if (transcript.trim()) {
          setGoal(transcript.trim());
        }
      };
      rec.onerror = (ev) => {
        setListening(false);
        setError(mapSpeechRecognitionError(ev?.error ?? ''));
      };
      rec.onend = () => setListening(false);
      speechRef.current = rec;
      setListening(true);
      playVoiceCueTone('start');
      rec.start();
    } catch {
      await startAudioFallback();
    }
  };

  const handleRunGoal = async (overrideGoal?: string) => {
    const targetGoal = (overrideGoal ?? goal).trim();
    if (!targetGoal || running) return;
    setError(null);
    setRunning(true);
    try {
      const res = await apiFetch('/api/ego/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: targetGoal, recordInSelfChat: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'EGO 에이전트 실행에 실패했습니다.');
        return;
      }
      const typed = data as EgoRunResult;
      setResult(typed);
      setStatus(typed.statusSnapshot);
      if (typed.selfRoomMessage) {
        onEgoSelfMessage?.(typed.selfRoomMessage);
      }
      for (const action of typed.integrationActions ?? []) {
        await onTriggerIntegration?.(action, { recordInChat: false });
      }
    } catch {
      setError('EGO 에이전트 서버와 통신할 수 없습니다.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section
      aria-label="SGW EGO 자율 AI 에이전트"
      className="shrink-0 mx-3 mt-2 rounded-2xl bg-white/95 dark:bg-neutral-900/95 border border-[#008069]/25 dark:border-[#07C160]/30 shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-[#075E54] text-white flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-[#FEE500] text-[#1C2924] flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold flex items-center gap-1.5">
              <span>SGW EGO 자율 에이전트</span>
              <span className="px-1.5 py-0.5 rounded bg-white/15 text-[10px] font-medium">
                {status?.geminiConfigured ? 'Gemini 4 자율 추론' : 'SGW 자율 워크플로 엔진'}
              </span>
            </div>
            <p className="text-[10px] text-emerald-100/85 truncate">
              Kakao 무료 API(로컬·다음검색·톡메모·캘린더) + SEDMS·SGW 자동 연쇄 실행
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
              status?.restApiConfigured
                ? 'bg-[#07C160] text-white'
                : 'bg-white/15 text-emerald-100'
            }`}
          >
            {status?.restApiConfigured ? 'Kakao 검색 API 활성' : 'Kakao REST 키 대기'}
          </span>
          <button
            type="button"
            disabled={linkingKakao}
            onClick={handleLinkKakaoApis}
            className={`h-7 px-2 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
              status?.kakaoTalkLinked
                ? 'bg-[#FEE500] text-[#1C2924]'
                : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
          >
            <Link2 className="h-3 w-3" />
            <span>{status?.kakaoTalkLinked ? '카톡·캘린더 연결됨' : '카톡·캘린더 연동'}</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="EGO 패널 닫기"
              className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-white/15 text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Goal Composer */}
      <div className="p-3 space-y-2 max-h-[250px] overflow-y-auto chat-scroll">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRunGoal();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Sparkles className="h-4 w-4 text-[#008069] dark:text-[#07C160] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="예: 판교 회식 장소 찾아서 미팅메모 작성하고 내 카톡으로 보내줘"
              aria-label="EGO 자율 실행 목표 입력"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#07C160]"
            />
          </div>

          <button
            type="button"
            onClick={handleToggleVoice}
            aria-label={listening ? '음성 입력 중지' : '음성으로 EGO 명령'}
            title="음성으로 EGO에게 지시하기"
            className={`h-9 w-9 rounded-xl flex items-center justify-center border cursor-pointer shrink-0 ${
              listening
                ? 'bg-red-500 border-red-500 text-white'
                : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
            }`}
          >
            <Mic className="h-4 w-4" />
          </button>

          <button
            type="submit"
            disabled={running || !goal.trim()}
            className="h-9 px-3.5 rounded-xl bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            <span>{running ? '자율 실행 중...' : 'EGO 실행'}</span>
          </button>
        </form>

        {/* Quick Multi-Step Goal Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 chat-scroll">
          {EGO_QUICK_GOALS.map((sample) => (
            <button
              key={sample}
              type="button"
              disabled={running}
              onClick={() => {
                setGoal(sample);
                handleRunGoal(sample);
              }}
              className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-[#07C160]/15 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap cursor-pointer shrink-0 transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2 flex-wrap"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            {kakaoPopupFallbackUrl && (
              <a
                href={kakaoPopupFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setLinkingKakao(true)}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FEE500] text-[#1C2924] text-[11px] font-bold hover:bg-[#f5dc00] shrink-0"
              >
                <ExternalLink className="h-3 w-3" />
                <span>새 탭에서 카카오 동의 열기</span>
              </a>
            )}
          </div>
        )}

        {/* Execution Trace & Synthesized Results */}
        {result && (
          <div className="space-y-2.5 pt-1 border-t border-neutral-200/80 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-[#075E54] dark:text-[#07C160]">
                실행 엔진: {result.engine === 'gemini-4-hydrogen' ? 'Gemini 4 자율 에이전트' : 'SGW 자율 워크플로 엔진'}
              </span>
              <span className="text-neutral-500 dark:text-neutral-400">
                단계 {result.toolExecutions.length}건 수행
              </span>
            </div>

            {result.toolExecutions.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.toolExecutions.map((exec) => (
                  <div
                    key={exec.id}
                    className="p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[11px] font-bold text-neutral-900 dark:text-white truncate">
                        {exec.label}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[10px] font-semibold text-[#008069] dark:text-[#07C160] shrink-0">
                        {getProviderBadgeLabel(exec.provider)}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-300 flex items-start gap-1">
                      {exec.status === 'executed' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#07C160] shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <span>{exec.summary}</span>
                    </p>
                    {exec.items && exec.items.length > 0 && (
                      <ul className="space-y-1 pt-1 border-t border-neutral-200/70 dark:border-neutral-700/60">
                        {exec.items.slice(0, 3).map((item, idx) => {
                          const safeUrl = sanitizeSafeHttpUrl(item.url);
                          return (
                            <li key={`${exec.id}-${idx}`} className="text-[11px] flex items-start justify-between gap-1">
                              <div className="min-w-0">
                                <div className="font-semibold text-neutral-800 dark:text-neutral-100 truncate flex items-center gap-1">
                                  {exec.provider === 'KAKAO_LOCAL' ? (
                                    <MapPin className="h-3 w-3 text-[#008069] shrink-0" />
                                  ) : exec.provider === 'KAKAO_CALENDAR' ? (
                                    <Calendar className="h-3 w-3 text-[#008069] shrink-0" />
                                  ) : exec.provider === 'KAKAO_SEARCH' ? (
                                    <Search className="h-3 w-3 text-[#008069] shrink-0" />
                                  ) : (
                                    <MessageSquareText className="h-3 w-3 text-[#008069] shrink-0" />
                                  )}
                                  <span className="truncate">{item.title}</span>
                                </div>
                                {item.subtitle && (
                                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                                    {item.subtitle}
                                  </div>
                                )}
                              </div>
                              {safeUrl && (
                                <a
                                  href={safeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-semibold text-[#008069] dark:text-[#07C160] hover:underline flex items-center gap-0.5 shrink-0"
                                >
                                  <span>열기</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="p-2.5 rounded-xl bg-[#07C160]/10 border border-[#008069]/20 text-xs text-neutral-800 dark:text-neutral-100 whitespace-pre-wrap leading-relaxed">
              {result.finalAnswer}
            </div>

            {result.nextSuggestions.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold text-neutral-500">다음 자율 제안:</span>
                {result.nextSuggestions.map((nextGoal) => (
                  <button
                    key={nextGoal}
                    type="button"
                    disabled={running}
                    onClick={() => {
                      setGoal(nextGoal);
                      handleRunGoal(nextGoal);
                    }}
                    className="px-2 py-1 rounded-lg bg-[#FEE500]/70 hover:bg-[#FEE500] text-[#1C2924] text-[10px] font-bold cursor-pointer transition-colors"
                  >
                    + {nextGoal}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
