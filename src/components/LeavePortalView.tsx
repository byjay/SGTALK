import { useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CalendarCheck2,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  History,
  MessageSquareText,
  Mic,
  RotateCcw,
  Search,
  Send,
  UserCheck,
} from 'lucide-react';
import {
  buildMonthlyLeaveCalendar,
  calculateLeaveDays,
  executeLeaveHistoryQuery,
  formatKoreanTime,
  getUserLeaveSummary,
  isUserOnLeaveOnDate,
  type LeaveHistoryQueryResult,
} from '../shared/logic';
import {
  mapSpeechRecognitionError,
  pickSupportedAudioMimeType,
  playVoiceCueTone,
} from '../utils/voiceAudio';
import type { LeaveRequest, LeaveType, NotificationItem, User } from '../types/client';
import { Avatar } from './Avatar';
import { LeaveHistoryChartPanel } from './LeaveHistoryChartPanel';

interface LeavePortalViewProps {
  currentUser: User;
  users: User[];
  usersById: Record<string, User>;
  leaves: LeaveRequest[];
  notifications: NotificationItem[];
  todayDate: string;
  apiFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenMail?: (mailId: string) => void;
  onRegisterLeave: (input: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId: string | null;
    reason: string;
  }) => Promise<{ ok: boolean; error?: string; notificationsCount?: number }>;
  onMarkNotificationRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenRoom: (roomId: string) => void;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const LEAVE_TYPES: LeaveType[] = ['연차', '오전반차', '오후반차', '병가', '공가'];
const WEEKDAY_HEADERS = ['일', '월', '화', '수', '목', '금', '토'];
const QUICK_CONVO_PROMPTS = [
  '내 연차 정보',
  '지난달 내 기록',
  '올해 과거 전체',
  '최근 3개월 내 연차',
  '과거 반차 내역',
  '전사 지난달 일정',
];

export function LeavePortalView({
  currentUser,
  users,
  usersById,
  leaves,
  notifications,
  todayDate,
  apiFetch,
  onOpenMail,
  onRegisterLeave,
  onMarkNotificationRead,
  onMarkAllRead,
  onOpenRoom,
}: LeavePortalViewProps) {
  const [leaveType, setLeaveType] = useState<LeaveType>('연차');
  const [startDate, setStartDate] = useState(todayDate);
  const [endDate, setEndDate] = useState(todayDate);
  const [substituteId, setSubstituteId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<'schedule' | 'history' | 'notifications'>('schedule');

  // Schedule calendar & scope/period filters
  const baseYear = Number(todayDate.slice(0, 4)) || 2026;
  const baseMonth = Number(todayDate.slice(5, 7)) || 11;
  const [calYear, setCalYear] = useState(baseYear);
  const [calMonth, setCalMonth] = useState(baseMonth);
  const [scheduleScope, setScheduleScope] = useState<'mine' | 'all'>('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'past' | 'upcoming'>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showMyDetailPanel, setShowMyDetailPanel] = useState(true);

  // Conversational past-record query state inside schedule
  const [convoInput, setConvoInput] = useState('');
  const [convoHistory, setConvoHistory] = useState<
    { id: string; question: string; result: LeaveHistoryQueryResult }[]
  >([]);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const speechRecRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const colleagues = useMemo(
    () => users.filter((u) => u.id !== currentUser.id && u.role !== 'bot'),
    [users, currentUser.id],
  );

  const dayPreview = useMemo(
    () => calculateLeaveDays(leaveType, startDate, endDate),
    [leaveType, startDate, endDate],
  );

  const onLeaveTodayCount = useMemo(
    () =>
      users.filter((u) => u.role !== 'bot' && isUserOnLeaveOnDate(leaves, u.id, todayDate)).length,
    [users, leaves, todayDate],
  );

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const mySummary = useMemo(
    () => getUserLeaveSummary(currentUser, leaves, todayDate),
    [currentUser, leaves, todayDate],
  );

  const activeConvoEntry =
    convoHistory.length > 0 ? convoHistory[convoHistory.length - 1] : null;

  const calendar = useMemo(() => {
    const filterUserId =
      activeConvoEntry?.result.query.scope === 'mine'
        ? currentUser.id
        : activeConvoEntry?.result.query.scope === 'person'
          ? activeConvoEntry.result.query.targetUserId
          : scheduleScope === 'mine'
            ? currentUser.id
            : null;
    return buildMonthlyLeaveCalendar(calYear, calMonth, leaves, todayDate, filterUserId);
  }, [calYear, calMonth, leaves, todayDate, scheduleScope, activeConvoEntry, currentUser.id]);

  const displayedLeaves = useMemo(() => {
    if (selectedDate) {
      return [...leaves]
        .filter((l) => {
          if (scheduleScope === 'mine' && l.userId !== currentUser.id) return false;
          return l.startDate <= selectedDate && l.endDate >= selectedDate;
        })
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    }

    if (activeConvoEntry) {
      return activeConvoEntry.result.matchedLeaves;
    }

    return [...leaves]
      .filter((l) => {
        if (scheduleScope === 'mine' && l.userId !== currentUser.id) return false;
        if (periodFilter === 'past' && l.endDate >= todayDate) return false;
        if (periodFilter === 'upcoming' && l.endDate < todayDate) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [leaves, selectedDate, scheduleScope, currentUser.id, activeConvoEntry, periodFilter, todayDate]);

  const handleShiftMonth = (delta: number) => {
    const zeroBased = calYear * 12 + (calMonth - 1) + delta;
    setCalYear(Math.floor(zeroBased / 12));
    setCalMonth(((zeroBased % 12) + 12) % 12 + 1);
    setSelectedDate(null);
  };

  const handleResetToTodayMonth = () => {
    setCalYear(baseYear);
    setCalMonth(baseMonth);
    setSelectedDate(null);
  };

  const runConversationalQuery = (rawQuestion: string) => {
    const q = rawQuestion.trim();
    if (!q) return;
    const result = executeLeaveHistoryQuery(q, leaves, users, currentUser, todayDate, {
      forceConversationMode: true,
    });
    setConvoHistory((prev) => [
      ...prev.slice(-4),
      { id: `cq-${Date.now()}`, question: q, result },
    ]);
    setConvoInput('');
    setSelectedDate(null);
    setActiveRightTab('schedule');

    if (result.query.scope === 'mine') {
      setScheduleScope('mine');
    } else if (result.query.scope === 'all') {
      setScheduleScope('all');
    }

    if (result.query.focusYearMonth) {
      const [yStr, mStr] = result.query.focusYearMonth.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      if (y > 2000 && m >= 1 && m <= 12) {
        setCalYear(y);
        setCalMonth(m);
      }
    } else if (result.matchedLeaves.length > 0 && result.query.toDate && result.query.toDate < todayDate) {
      const latest = result.matchedLeaves[0].startDate;
      const y = Number(latest.slice(0, 4));
      const m = Number(latest.slice(5, 7));
      if (y > 2000 && m >= 1 && m <= 12) {
        setCalYear(y);
        setCalMonth(m);
      }
    }
  };

  const handleClearConvoQuery = () => {
    setConvoHistory([]);
    setSelectedDate(null);
    setVoiceHint(null);
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

    if (audioDataUrl && apiFetch) {
      const res = await apiFetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioDataUrl, mimeType: mr.mimeType || 'audio/webm' }),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as { transcript?: string };
        if (data.transcript?.trim()) {
          setConvoInput(data.transcript.trim());
          runConversationalQuery(data.transcript.trim());
        }
      }
    }
  };

  const toggleVoiceQuery = async () => {
    setVoiceHint(null);
    if (voiceListening) {
      playVoiceCueTone('stop');
      try {
        speechRecRef.current?.stop();
      } catch {
        // ignore
      }
      setVoiceListening(false);
      await stopAudioFallbackCapture();
      return;
    }

    const startAudioFallback = async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setVoiceHint('현재 브라우저는 마이크 음성 인식을 지원하지 않아 텍스트로 바로 조회할 수 있습니다.');
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
        setVoiceListening(true);
        playVoiceCueTone('start');
        setVoiceHint('음성 녹음 중입니다. 다시 누르면 서버 AI가 텍스트로 변환해 연차 기록을 조회합니다.');
      } catch {
        setVoiceHint('마이크 권한을 확인할 수 없어 질문 텍스트로 바로 조회해 주세요.');
      }
    };

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      await startAudioFallback();
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
          setConvoInput(transcript.trim());
        }
      };
      rec.onerror = (ev) => {
        setVoiceListening(false);
        setVoiceHint(mapSpeechRecognitionError(ev?.error ?? ''));
      };
      rec.onend = () => setVoiceListening(false);
      speechRecRef.current = rec;
      playVoiceCueTone('start');
      rec.start();
      setVoiceListening(true);
    } catch {
      await startAudioFallback();
    }
  };

  const handleTypeChange = (nextType: LeaveType) => {
    setLeaveType(nextType);
    if (nextType === '오전반차' || nextType === '오후반차') {
      setEndDate(startDate);
    }
  };

  const handleStartDateChange = (nextDate: string) => {
    setStartDate(nextDate);
    if (leaveType === '오전반차' || leaveType === '오후반차' || nextDate > endDate) {
      setEndDate(nextDate);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!dayPreview.valid) {
      setFeedback({ kind: 'error', text: dayPreview.error || '날짜를 확인해주세요.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await onRegisterLeave({
        type: leaveType,
        startDate,
        endDate,
        substituteId: substituteId || null,
        reason: reason.trim(),
      });
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error || '연차 등록에 실패했습니다.' });
      } else {
        setReason('');
        setFeedback({
          kind: 'success',
          text: `연차가 등록되었습니다. 가입된 임직원 ${res.notificationsCount ?? users.length - 1}명에게 실시간 알림 및 전사 알림봇 메시지가 발송되었습니다.`,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto chat-scroll bg-neutral-50 dark:bg-neutral-950 p-4 md:p-6 space-y-5">
      {/* Top KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setShowMyDetailPanel((v) => !v)}
          className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-[#008069]/50 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">내 잔여 연차</span>
            <span className="text-[11px] font-semibold text-[#008069] dark:text-[#07C160]">
              {showMyDetailPanel ? '상세 접기' : '내 정보 보기'}
            </span>
          </div>
          <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-white tabular-nums">
            {mySummary.remainingDays}일
          </div>
          <div className="mt-0.5 text-xs text-neutral-400 tabular-nums">
            총 {mySummary.totalDays}일 · 사용 {mySummary.usedDays}일 ({mySummary.usagePercent}%)
          </div>
        </button>

        <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">내 과거 사용 기록</div>
          <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-white tabular-nums">
            {mySummary.pastLeaves.length}건
          </div>
          <div className="mt-0.5 text-xs text-neutral-400 tabular-nums">
            예정 {mySummary.upcomingLeaves.length}건 · 오늘 {mySummary.activeTodayLeaves.length}건
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">오늘 연차 인원</div>
          <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
            {onLeaveTodayCount}명
          </div>
          <div className="mt-0.5 text-xs text-neutral-400 tabular-nums">{todayDate} 기준</div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">미확인 알림</div>
          <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-white tabular-nums">
            {unreadNotifCount}건
          </div>
          <div className="mt-0.5 text-xs text-neutral-400">전체 {notifications.length}건 수신</div>
        </div>
      </div>

      {/* My Leave Information Detailed Panel */}
      {showMyDetailPanel && (
        <section
          aria-label="내 연차 정보 상세"
          className="p-4 md:p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-[#008069]/25 dark:border-[#07C160]/25 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar user={currentUser} size="md" showOnline />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
                  <span>
                    내 연차 정보 · {currentUser.name} {currentUser.position}
                  </span>
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {currentUser.department} · 잔여 {mySummary.remainingDays}일 / 부여 {mySummary.totalDays}일 · 사용률 {mySummary.usagePercent}%
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setConvoHistory([]);
                  setSelectedDate(null);
                  setScheduleScope('mine');
                  setPeriodFilter('past');
                  setActiveRightTab('schedule');
                }}
                className="h-8 px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <History className="h-3.5 w-3.5 text-[#008069] dark:text-[#07C160]" />
                <span>내 과거 기록 보기 ({mySummary.pastLeaves.length})</span>
              </button>
              <button
                type="button"
                onClick={() => runConversationalQuery('내 연차 정보')}
                className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                <span>대화로 내 기록 조회</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-300 tabular-nums">
              <span>연차 소진율</span>
              <span className="font-bold text-neutral-900 dark:text-white">
                사용 {mySummary.usedDays}일 · 잔여 {mySummary.remainingDays}일 ({mySummary.usagePercent}%)
              </span>
            </div>
            <svg
              viewBox="0 0 100 3"
              preserveAspectRatio="none"
              aria-label={`연차 사용률 ${mySummary.usagePercent}%`}
              className="w-full h-2 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 block"
            >
              <rect
                x="0"
                y="0"
                width={Math.max(2, mySummary.usagePercent)}
                height="3"
                className="fill-[#008069] dark:fill-[#07C160]"
              />
            </svg>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {mySummary.byType.map((item) => (
              <div
                key={item.type}
                className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40"
              >
                <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                  {item.type}
                </div>
                <div className="mt-0.5 text-sm font-bold text-neutral-900 dark:text-white tabular-nums">
                  {item.days}일
                  <span className="ml-1 text-[11px] font-normal text-neutral-400">
                    ({item.count}건)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Leave Registration Form */}
        <section className="lg:col-span-5 p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-4">
          <div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-white flex items-center gap-2">
              <CalendarCheck2 className="h-4 w-4 text-amber-600" />
              <span>연차 등록 · 전사 알림 발송</span>
            </h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              연차를 등록하면 가입된 모든 사원에게 실시간 팝업 알림과 전사 공지·알림봇 메시지가 자동 발송됩니다.
            </p>
          </div>

          {feedback && (
            <div
              role="status"
              className={`p-3 rounded-xl text-xs leading-relaxed border ${
                feedback.kind === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                휴가 유형
              </span>
              <div className="grid grid-cols-5 gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
                {LEAVE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      leaveType === t
                        ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                        : 'text-neutral-500 dark:text-neutral-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="leave-start"
                  className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                >
                  시작일
                </label>
                <input
                  id="leave-start"
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm tabular-nums"
                />
              </div>
              <div>
                <label
                  htmlFor="leave-end"
                  className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                >
                  종료일
                </label>
                <input
                  id="leave-end"
                  type="date"
                  required
                  disabled={leaveType === '오전반차' || leaveType === '오후반차'}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm tabular-nums disabled:opacity-60"
                />
              </div>
            </div>

            <div className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800/70 flex items-center justify-between text-xs">
              <span className="text-neutral-600 dark:text-neutral-300">차감 및 신청 일수</span>
              <span className="font-bold text-neutral-900 dark:text-white tabular-nums">
                {dayPreview.valid ? `${dayPreview.days}일` : dayPreview.error}
              </span>
            </div>

            <div>
              <label
                htmlFor="leave-sub"
                className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
              >
                업무 대행자
              </label>
              <select
                id="leave-sub"
                value={substituteId}
                onChange={(e) => setSubstituteId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
              >
                <option value="">지정 안 함</option>
                {colleagues.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.position} ({u.department})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="leave-reason"
                className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
              >
                사유 및 인수인계 메모
              </label>
              <textarea
                id="leave-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 가족 일정으로 연차 사용합니다. 긴급 문의는 대행자에게 부탁드립니다."
                className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !dayPreview.valid}
              className="w-full h-11 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>{submitting ? '등록 및 알림 발송 중...' : '연차 등록 및 전체 알림 발송'}</span>
            </button>
          </form>
        </section>

        {/* Right Panel: Schedule Calendar + Conversational Past-Record Assistant + Notification Inbox */}
        <section className="lg:col-span-7 p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="연차 포털 우측 보기 전환"
              className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl overflow-x-auto no-scrollbar max-w-full"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeRightTab === 'schedule'}
                onClick={() => setActiveRightTab('schedule')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeRightTab === 'schedule'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                스케줄 · 과거 기록 ({leaves.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRightTab === 'history'}
                onClick={() => setActiveRightTab('history')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeRightTab === 'history'
                    ? 'bg-white dark:bg-neutral-900 text-[#008069] dark:text-[#07C160] font-semibold shadow-xs'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                Leave History
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRightTab === 'notifications'}
                onClick={() => setActiveRightTab('notifications')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeRightTab === 'notifications'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                수신 알림함 ({unreadNotifCount})
              </button>
            </div>

            {activeRightTab === 'notifications' && unreadNotifCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>모두 읽음 처리</span>
              </button>
            )}
          </div>

          {activeRightTab === 'schedule' ? (
            <div className="space-y-4">
              {/* 1. Conversational Past-Record Lookup Assistant */}
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/80 dark:border-emerald-900/70 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#075E54] dark:text-[#07C160]">
                    <MessageSquareText className="h-4 w-4" />
                    <span>스케줄에서 대화로 과거 기록 조회</span>
                  </div>
                  {(convoHistory.length > 0 || selectedDate) && (
                    <button
                      type="button"
                      onClick={handleClearConvoQuery}
                      className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>전체 보기</span>
                    </button>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runConversationalQuery(convoInput);
                  }}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={toggleVoiceQuery}
                    aria-label={voiceListening ? '음성 입력 중지' : '음성으로 과거 기록 질문'}
                    title="음성으로 과거 기록 질문"
                    className={`h-9 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
                      voiceListening
                        ? 'bg-red-500 border-red-500 text-white animate-pulse'
                        : 'bg-white dark:bg-neutral-900 border-emerald-200 dark:border-emerald-800 text-[#075E54] dark:text-[#07C160]'
                    }`}
                  >
                    <Mic className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{voiceListening ? '듣는중' : '음성'}</span>
                  </button>
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      value={convoInput}
                      onChange={(e) => setConvoInput(e.target.value)}
                      placeholder="예: 지난달 내 연차 기록, 내 연차 몇일 남았어?, 이서연 과거 연차"
                      aria-label="스케줄 대화형 과거 기록 질문"
                      className="w-full h-9 pl-3 pr-8 rounded-xl bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800 text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                    />
                    <Search className="h-3.5 w-3.5 text-neutral-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  <button
                    type="submit"
                    disabled={!convoInput.trim()}
                    className="h-9 px-3.5 rounded-xl bg-[#008069] hover:bg-[#006B58] disabled:opacity-45 text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    조회
                  </button>
                </form>

                {voiceHint && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">{voiceHint}</p>
                )}

                <div className="flex items-center gap-1.5 flex-wrap">
                  {QUICK_CONVO_PROMPTS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => runConversationalQuery(chip)}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-900 border border-emerald-200/80 dark:border-emerald-800/80 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 whitespace-nowrap cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {convoHistory.length > 0 && (
                  <div
                    aria-live="polite"
                    className="pt-1 space-y-2 max-h-56 overflow-y-auto chat-scroll"
                  >
                    {convoHistory.map((turn) => (
                      <div key={turn.id} className="space-y-1.5">
                        <div className="flex justify-end">
                          <div className="max-w-[85%] px-3 py-1.5 rounded-xl bg-[#FEE500] text-[#1C2924] text-xs font-semibold">
                            {turn.question}
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="max-w-[95%] px-3 py-2 rounded-xl bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800 text-xs text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed">
                            {turn.result.summaryText}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Monthly Leave Schedule Calendar */}
              <div className="p-3.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
                    <button
                      type="button"
                      onClick={() => handleShiftMonth(-1)}
                      aria-label="이전 달"
                      className="h-7 w-7 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-bold text-neutral-900 dark:text-white tabular-nums min-w-[92px] text-center">
                      {calendar.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleShiftMonth(1)}
                      aria-label="다음 달"
                      className="h-7 w-7 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleResetToTodayMonth}
                      className="h-7 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 cursor-pointer"
                    >
                      오늘
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-neutral-200/70 dark:bg-neutral-800">
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleScope('mine');
                          setConvoHistory([]);
                        }}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                          scheduleScope === 'mine'
                            ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        내 일정
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleScope('all');
                          setConvoHistory([]);
                        }}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                          scheduleScope === 'all'
                            ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        전사 전체
                      </button>
                    </div>

                    {!activeConvoEntry && !selectedDate && (
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-neutral-200/70 dark:bg-neutral-800">
                        {(
                          [
                            { id: 'all', label: '전체' },
                            { id: 'past', label: '과거' },
                            { id: 'upcoming', label: '오늘·예정' },
                          ] as const
                        ).map((pf) => (
                          <button
                            key={pf.id}
                            type="button"
                            onClick={() => setPeriodFilter(pf.id)}
                            className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                              periodFilter === pf.id
                                ? 'bg-white dark:bg-neutral-900 text-[#008069] dark:text-[#07C160] shadow-2xs'
                                : 'text-neutral-600 dark:text-neutral-400'
                            }`}
                          >
                            {pf.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAY_HEADERS.map((wd, idx) => (
                    <div
                      key={wd}
                      className={`py-1 text-[11px] font-bold ${
                        idx === 0
                          ? 'text-red-500'
                          : idx === 6
                            ? 'text-sky-600 dark:text-sky-400'
                            : 'text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      {wd}
                    </div>
                  ))}
                  {calendar.cells.map((cell) => {
                    const isSelected = selectedDate === cell.date;
                    const hasMine = cell.leaves.some((l) => l.userId === currentUser.id);
                    const hasOthers = cell.leaves.some((l) => l.userId !== currentUser.id);

                    return (
                      <button
                        key={cell.date}
                        type="button"
                        onClick={() =>
                          setSelectedDate((cur) => (cur === cell.date ? null : cell.date))
                        }
                        className={`min-h-[46px] p-1 rounded-xl border text-left flex flex-col justify-between transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-[#008069] bg-[#008069]/10 dark:bg-[#07C160]/15'
                            : cell.isToday
                              ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/30'
                              : cell.inCurrentMonth
                                ? 'border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300'
                                : 'border-transparent bg-neutral-100/50 dark:bg-neutral-900/30 opacity-45'
                        }`}
                      >
                        <span
                          className={`text-[11px] font-semibold tabular-nums leading-none ${
                            cell.isToday
                              ? 'text-amber-700 dark:text-amber-300 font-bold'
                              : cell.isWeekend
                                ? 'text-neutral-400'
                                : 'text-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          {cell.day}
                        </span>
                        {cell.leaves.length > 0 && (
                          <div className="space-y-0.5 w-full overflow-hidden">
                            {cell.leaves.slice(0, 1).map((lv) => {
                              const owner = usersById[lv.userId];
                              return (
                                <div
                                  key={lv.id}
                                  className={`px-1 py-0.5 rounded text-[9px] font-bold truncate ${
                                    lv.userId === currentUser.id
                                      ? 'bg-[#008069] text-white'
                                      : 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200'
                                  }`}
                                >
                                  {owner?.name ?? '사원'}
                                </div>
                              );
                            })}
                            {cell.leaves.length > 1 && (
                              <div className="text-[9px] font-bold text-neutral-500 tabular-nums leading-none">
                                +{cell.leaves.length - 1}명
                              </div>
                            )}
                          </div>
                        )}
                        {cell.leaves.length === 0 && (hasMine || hasOthers) ? null : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Active Result Header + Matching Schedule / Historical Records List */}
              <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  {selectedDate
                    ? `${selectedDate} 일정 (${displayedLeaves.length}건)`
                    : activeConvoEntry
                      ? `대화 조회 결과 · ${activeConvoEntry.result.query.periodLabel} (${displayedLeaves.length}건 / 총 ${activeConvoEntry.result.totalMatchedDays}일)`
                      : `${scheduleScope === 'mine' ? '내 연차 기록' : '전사 연차 일정'} (${displayedLeaves.length}건)`}
                </span>
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="text-xs font-semibold text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                  >
                    날짜 선택 해제
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                {displayedLeaves.length === 0 ? (
                  <p className="py-10 text-center text-xs text-neutral-400">
                    조건에 해당하는 연차·과거 일정이 없습니다.
                  </p>
                ) : (
                  displayedLeaves.map((l) => {
                    const applicant = usersById[l.userId];
                    const sub = l.substituteId ? usersById[l.substituteId] : null;
                    const isToday = l.startDate <= todayDate && l.endDate >= todayDate;
                    const isPast = l.endDate < todayDate;
                    return (
                      <div
                        key={l.id}
                        className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <Avatar user={applicant} size="md" onLeave={isToday} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-bold text-neutral-900 dark:text-white">
                                {applicant?.name ?? '사원'} {applicant?.position ?? ''}
                              </span>
                              <span className="text-xs text-neutral-500">
                                {applicant?.department} · {l.type} ({l.daysCount}일)
                              </span>
                              {isToday ? (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                                  오늘 휴무
                                </span>
                              ) : isPast ? (
                                <span className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                                  사용 완료
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                  예정
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 tabular-nums">
                              {l.startDate === l.endDate
                                ? l.startDate
                                : `${l.startDate} ~ ${l.endDate}`}{' '}
                              · 대행: {sub ? `${sub.name} ${sub.position}` : '지정 안 함'}
                            </div>
                            {l.reason && (
                              <p className="mt-0.5 text-xs text-neutral-400 truncate">{l.reason}</p>
                            )}
                          </div>
                        </div>

                        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                          {l.status}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : activeRightTab === 'history' ? (
            <LeaveHistoryChartPanel
              currentUser={currentUser}
              usersById={usersById}
              leaves={leaves}
              todayDate={todayDate}
            />
          ) : (
            <div className="space-y-2">
              {notifications.length === 0 ? (
                <p className="py-10 text-center text-xs text-neutral-400">
                  도착한 사내 알림이 없습니다.
                </p>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3.5 rounded-xl border transition-colors flex items-start justify-between gap-3 ${
                      n.read
                        ? 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
                        : 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20'
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
                          {formatKoreanTime(n.createdAt)} · {n.read ? '읽음' : '새 알림'}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => onMarkNotificationRead(n.id)}
                          className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap cursor-pointer"
                        >
                          읽음
                        </button>
                      )}
                      {n.mailId && onOpenMail && (
                        <button
                          type="button"
                          onClick={() => {
                            onMarkNotificationRead(n.id);
                            onOpenMail(n.mailId!);
                          }}
                          className="h-8 px-2.5 rounded-lg bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold whitespace-nowrap cursor-pointer"
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
                          }}
                          className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-semibold whitespace-nowrap cursor-pointer"
                        >
                          대화방 보기
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
