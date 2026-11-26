import { useEffect, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  Lock,
  Mail,
  NotebookPen,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  Share2,
  Siren,
  Sparkles,
  X,
} from 'lucide-react';
import { buildMailReplyDraftPure, type InChatMailDraft } from '../../shared/chatLogic';
import { buildConciseMailDigest, summarizeMailBodyPure } from '../../shared/controlTower';
import { formatFileSize, formatKoreanTime } from '../../shared/logic';
import { NAS_DEFAULT_FOLDERS } from '../../shared/nasShare';
import type {
  MailMessage,
  Notice,
  NotificationItem,
  SharedFileItem,
  User,
} from '../../types/client';

/* 1. In-Chat bmail & BigMail Inbox / Quick Compose Panel */
interface InChatMailPanelProps {
  initialTab: 'inbox' | 'compose';
  roomId?: string;
  roomFiles?: SharedFileItem[];
  initialDraft?: InChatMailDraft | null;
  draftNonce?: number;
  bmailBridgeStatus?: { bmailBaseUrlConfigured: boolean; embedSupported: boolean } | null;
  onSyncRemoteBmail?: () => Promise<{ ok: boolean; importedCount?: number; error?: string }>;
  onLaunchBmailSso?: () => Promise<{ ok: boolean; launchUrl?: string; error?: string }>;
  currentUser?: User;
  colleagues: User[];
  usersById: Record<string, User>;
  mails: MailMessage[];
  apiFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenMail?: (mailId: string) => void;
  onMailSent?: (mail: MailMessage, uploadedFile?: SharedFileItem) => void;
  onShareMailToChat: (text: string) => Promise<void>;
  onClose: () => void;
}

export function InChatMailPanel({
  initialTab,
  roomId,
  roomFiles = [],
  initialDraft = null,
  draftNonce = 0,
  bmailBridgeStatus = null,
  onSyncRemoteBmail,
  onLaunchBmailSso,
  currentUser,
  colleagues,
  usersById,
  mails,
  apiFetch,
  onOpenMail,
  onMailSent,
  onShareMailToChat,
  onClose,
}: InChatMailPanelProps) {
  const [tab, setTab] = useState<'inbox' | 'compose'>(initialTab);
  const [filter, setFilter] = useState<'all' | 'unread' | 'attached'>('all');
  const [summaryByMailId, setSummaryByMailId] = useState<Record<string, string[]>>({});
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  // Compose state
  const [provider, setProvider] = useState<'bigmail' | 'bmail'>(initialDraft?.provider ?? 'bigmail');
  const [recipientIds, setRecipientIds] = useState<string[]>(() =>
    initialDraft?.recipientIds.length
      ? initialDraft.recipientIds
      : colleagues[0]
        ? [colleagues[0].id]
        : [],
  );
  const [subject, setSubject] = useState(initialDraft?.subject ?? '');
  const [body, setBody] = useState(initialDraft?.body ?? '');
  const [existingAttachmentIds, setExistingAttachmentIds] = useState<string[]>(
    initialDraft?.existingAttachmentIds ?? [],
  );
  const [inReplyToMailId, setInReplyToMailId] = useState<string | null>(
    initialDraft?.inReplyToMailId ?? null,
  );
  const [syncToRoom, setSyncToRoom] = useState(true);
  const [attachNas, setAttachNas] = useState(false);
  const [nasFolder, setNasFolder] = useState<string>(NAS_DEFAULT_FOLDERS[0]);
  const [nasFilename, setNasFilename] = useState('SGW_대용량_공유패키지.tar.zst');
  const [nasSizeValue, setNasSizeValue] = useState('100');
  const [nasSizeUnit, setNasSizeUnit] = useState<'MB' | 'GB' | 'TB'>('GB');
  const [nasPasscode, setNasPasscode] = useState('');
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeSuccess, setComposeSuccess] = useState<string | null>(null);
  const [syncingBridge, setSyncingBridge] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  const [bridgeLaunchUrl, setBridgeLaunchUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!draftNonce || !initialDraft) return;
    setTab('compose');
    setProvider(initialDraft.provider);
    setRecipientIds(
      initialDraft.recipientIds.length > 0
        ? initialDraft.recipientIds
        : colleagues[0]
          ? [colleagues[0].id]
          : [],
    );
    setSubject(initialDraft.subject);
    setBody(initialDraft.body);
    setExistingAttachmentIds(initialDraft.existingAttachmentIds);
    setInReplyToMailId(initialDraft.inReplyToMailId ?? null);
    setComposeError(null);
    setComposeSuccess(null);
  }, [draftNonce, initialDraft]);

  const applyDraft = (draft: InChatMailDraft) => {
    setProvider(draft.provider);
    setRecipientIds(
      draft.recipientIds.length > 0
        ? draft.recipientIds
        : colleagues[0]
          ? [colleagues[0].id]
          : [],
    );
    setSubject(draft.subject);
    setBody(draft.body);
    setExistingAttachmentIds(draft.existingAttachmentIds);
    setInReplyToMailId(draft.inReplyToMailId ?? null);
    setComposeError(null);
    setComposeSuccess(null);
    setTab('compose');
  };

  const visibleMails = mails.filter((m) => {
    if (filter === 'unread') {
      return currentUser ? !m.readByUserIds.includes(currentUser.id) : !m.readByUserIds.length;
    }
    if (filter === 'attached') {
      return (m.attachments?.length ?? 0) > 0;
    }
    return true;
  });

  const handleSummarizeMail = async (mail: MailMessage) => {
    const senderName = usersById[mail.senderId]?.name ?? '발신자';
    if (summaryByMailId[mail.id]) {
      setSummaryByMailId((prev) => {
        const next = { ...prev };
        delete next[mail.id];
        return next;
      });
      return;
    }
    setSummarizingId(mail.id);
    try {
      if (apiFetch) {
        const res = await apiFetch(`/api/mail/${mail.id}/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch(() => null);
        if (res && res.ok) {
          const data = (await res.json()) as { bullets?: string[] };
          if (Array.isArray(data.bullets) && data.bullets.length > 0) {
            setSummaryByMailId((prev) => ({ ...prev, [mail.id]: data.bullets! }));
            return;
          }
        }
      }
      const bullets = summarizeMailBodyPure(mail, senderName);
      setSummaryByMailId((prev) => ({ ...prev, [mail.id]: bullets }));
    } finally {
      setSummarizingId(null);
    }
  };

  const handleShareMail = async (mail: MailMessage) => {
    setSharingId(mail.id);
    try {
      const senderName = usersById[mail.senderId]?.name ?? '발신자';
      const digest = buildConciseMailDigest(mail, senderName);
      const bullets = summaryByMailId[mail.id] ?? summarizeMailBodyPure(mail, senderName);
      const lines = [
        `[${mail.provider === 'bigmail' ? '빅메일' : 'bmail'} 공유] ${mail.subject}`,
        `발신: ${senderName} · ${digest.attachmentLabel || '첨부 없음'}`,
        ...bullets.slice(0, 3).map((b) => `• ${b}`),
      ];
      await onShareMailToChat(lines.join('\n'));
    } finally {
      setSharingId(null);
    }
  };

  const toggleRecipient = (uid: string) => {
    setRecipientIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  };

  const toggleExistingAttachment = (fileId: string) => {
    setExistingAttachmentIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId],
    );
  };

  const handleSendMail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiFetch || sending) return;
    if (recipientIds.length === 0) {
      setComposeError('수신자를 최소 1명 선택해 주세요.');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      setComposeError('메일 제목과 본문을 모두 입력해 주세요.');
      return;
    }

    setComposeError(null);
    setComposeSuccess(null);
    setSending(true);
    try {
      const res = await apiFetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          recipientIds,
          subject: subject.trim(),
          body: body.trim(),
          category: '일반',
          ...(existingAttachmentIds.length > 0 ? { existingAttachmentIds } : {}),
          ...(inReplyToMailId ? { inReplyToMailId } : {}),
          ...(syncToRoom && roomId ? { syncToRoomId: roomId } : {}),
          ...(attachNas && nasFilename.trim()
            ? {
                nasShare: {
                  nasFolder,
                  filename: nasFilename.trim(),
                  sizeValue: Number(nasSizeValue) || 100,
                  sizeUnit: nasSizeUnit,
                  expiresDays: 7,
                  ...(nasPasscode.trim() ? { passcode: nasPasscode.trim() } : {}),
                },
              }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        mail?: MailMessage;
        uploadedFile?: SharedFileItem;
        error?: string;
      };
      if (!res.ok || !data.mail) {
        setComposeError(data.error || '메일 발송에 실패했습니다.');
        return;
      }
      onMailSent?.(data.mail, data.uploadedFile);
      setComposeSuccess(
        `${provider === 'bigmail' ? '빅메일' : 'bmail'} 발송 완료 (${recipientIds.length}명)`,
      );
      setSubject('');
      setBody('');
      setExistingAttachmentIds([]);
      setInReplyToMailId(null);
      setNasPasscode('');
      setTab('inbox');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      aria-label="톡 내 메일 허브"
      className="p-3.5 bg-sky-50/85 dark:bg-sky-950/25 border-b border-sky-200 dark:border-sky-900 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-sky-900 dark:text-sky-200">
            <Mail className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            <span>톡 내 bmail · 빅메일 바로처리</span>
          </span>
          <div className="inline-flex p-0.5 rounded-lg bg-sky-200/60 dark:bg-sky-900/50">
            <button
              type="button"
              onClick={() => setTab('inbox')}
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer ${
                tab === 'inbox'
                  ? 'bg-white dark:bg-neutral-900 text-sky-900 dark:text-white shadow-2xs'
                  : 'text-sky-800 dark:text-sky-300'
              }`}
            >
              수신함 ({mails.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('compose');
                setComposeError(null);
              }}
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer ${
                tab === 'compose'
                  ? 'bg-white dark:bg-neutral-900 text-sky-900 dark:text-white shadow-2xs'
                  : 'text-sky-800 dark:text-sky-300'
              }`}
            >
              메일 보내기
            </button>
          </div>
          {bmailBridgeStatus?.bmailBaseUrlConfigured && (
            <div className="flex items-center gap-1">
              {onSyncRemoteBmail && (
                <button
                  type="button"
                  disabled={syncingBridge}
                  onClick={async () => {
                    if (syncingBridge) return;
                    setSyncingBridge(true);
                    setBridgeMessage(null);
                    try {
                      const res = await onSyncRemoteBmail();
                      setBridgeMessage(
                        res.ok
                          ? `원격 bmail 동기화 완료 (${res.importedCount ?? 0}건)`
                          : res.error || '동기화 실패',
                      );
                    } finally {
                      setSyncingBridge(false);
                    }
                  }}
                  className="h-6 px-2 rounded-md border border-sky-300 dark:border-sky-700 bg-white dark:bg-neutral-900 text-[10px] font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${syncingBridge ? 'animate-spin' : ''}`} />
                  <span>원격 동기화</span>
                </button>
              )}
              {onLaunchBmailSso && (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await onLaunchBmailSso();
                    if (res.ok && res.launchUrl) {
                      setBridgeLaunchUrl(res.launchUrl);
                    } else if (res.error) {
                      setBridgeMessage(res.error);
                    }
                  }}
                  className="h-6 px-2 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>외부 bmail(SSO)</span>
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="메일 패널 닫기"
          className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {bridgeMessage && (
        <div className="px-2.5 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/50 text-sky-900 dark:text-sky-100 text-[11px] font-medium flex items-center justify-between gap-2">
          <span>{bridgeMessage}</span>
          <button
            type="button"
            onClick={() => setBridgeMessage(null)}
            className="text-[10px] opacity-75 hover:opacity-100 cursor-pointer"
          >
            닫기
          </button>
        </div>
      )}

      {bridgeLaunchUrl && (
        <div className="px-2.5 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 text-[11px] font-semibold flex items-center justify-between gap-2">
          <span>SSO 인증 연결 링크가 준비되었습니다:</span>
          <a
            href={bridgeLaunchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold inline-flex items-center gap-1"
          >
            <span>bmail 바로 열기</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {composeSuccess && (
        <div className="px-2.5 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 text-xs font-semibold flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{composeSuccess}</span>
        </div>
      )}

      {tab === 'inbox' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: '전체' },
                { id: 'attached', label: '첨부 포함' },
                { id: 'unread', label: '미확인' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer ${
                  filter === f.id
                    ? 'bg-sky-700 text-white'
                    : 'bg-white dark:bg-neutral-900 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="max-h-52 overflow-y-auto chat-scroll space-y-1.5 pr-0.5">
            {visibleMails.length === 0 ? (
              <p className="py-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                표시할 bmail·빅메일이 없습니다.
              </p>
            ) : (
              visibleMails.slice(0, 8).map((mail) => {
                const senderName = usersById[mail.senderId]?.name ?? '발신자';
                const digest = buildConciseMailDigest(mail, senderName);
                const bullets = summaryByMailId[mail.id];
                const attachments = mail.attachments ?? [];
                return (
                  <div
                    key={mail.id}
                    className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-sky-200/80 dark:border-sky-800 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold ${
                              mail.provider === 'bigmail'
                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                                : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                            }`}
                          >
                            {mail.provider === 'bigmail' ? '빅메일' : 'bmail'}
                          </span>
                          <span className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                            {mail.subject}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-600 dark:text-neutral-300 truncate mt-0.5">
                          {senderName} · {digest.shortSummary}
                        </p>
                      </div>
                      <span className="text-[10px] text-neutral-400 tabular-nums whitespace-nowrap shrink-0">
                        {formatKoreanTime(mail.createdAt)}
                      </span>
                    </div>

                    {bullets && (
                      <ul className="px-2.5 py-1.5 rounded-lg bg-sky-50/80 dark:bg-sky-950/40 text-[11px] text-neutral-700 dark:text-neutral-200 space-y-0.5">
                        {bullets.map((b, idx) => (
                          <li key={idx}>• {b}</li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <span className="text-[10px] text-neutral-500 flex items-center gap-1">
                        {attachments.length > 0 && (
                          <>
                            <Paperclip className="h-3 w-3" />
                            <span>
                              첨부 {attachments.length}건 (
                              {formatFileSize(
                                attachments.reduce((acc, a) => acc + (a.size || 0), 0),
                              )}
                              )
                            </span>
                          </>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            applyDraft(
                              buildMailReplyDraftPure(mail, senderName, 'reply', currentUser?.id ?? ''),
                            )
                          }
                          className="h-6 px-2 rounded-md border border-sky-200 dark:border-sky-800 text-[10px] font-semibold text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-950/40 flex items-center gap-1 cursor-pointer"
                        >
                          <Reply className="h-3 w-3" />
                          <span>답장</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSummarizeMail(mail)}
                          disabled={summarizingId === mail.id}
                          className="h-6 px-2 rounded-md border border-sky-200 dark:border-sky-800 text-[10px] font-semibold text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer"
                        >
                          {summarizingId === mail.id
                            ? '요약 중...'
                            : bullets
                              ? '요약 접기'
                              : '3줄 요약'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleShareMail(mail)}
                          disabled={sharingId === mail.id}
                          className="h-6 px-2 rounded-md border border-emerald-300 dark:border-emerald-800 text-[10px] font-semibold text-[#075E54] dark:text-[#07C160] hover:bg-emerald-50 flex items-center gap-1 cursor-pointer"
                        >
                          <Share2 className="h-3 w-3" />
                          <span>톡방 공유</span>
                        </button>
                        {onOpenMail && (
                          <button
                            type="button"
                            onClick={() => onOpenMail(mail.id)}
                            className="h-6 px-2 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>상세 보기</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSendMail} className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex p-0.5 rounded-lg bg-white dark:bg-neutral-900 border border-sky-200 dark:border-sky-800">
              {(['bigmail', 'bmail'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer ${
                    provider === p
                      ? 'bg-sky-700 text-white'
                      : 'text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  {p === 'bigmail' ? '빅메일 (대용량)' : 'bmail'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {colleagues.map((u) => {
                const picked = recipientIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleRecipient(u.id)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border cursor-pointer ${
                      picked
                        ? 'bg-[#008069] border-[#008069] text-white'
                        : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>
          </div>

          {inReplyToMailId && (
            <div className="px-2.5 py-1 rounded-lg bg-sky-100/80 dark:bg-sky-900/40 text-[11px] font-semibold text-sky-900 dark:text-sky-200 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1">
                <Reply className="h-3 w-3" />
                <span>원본 메일 답장 작성 중</span>
              </span>
              <button
                type="button"
                onClick={() => setInReplyToMailId(null)}
                className="text-[10px] underline cursor-pointer"
              >
                답장 연결 해제
              </button>
            </div>
          )}

          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="메일 제목 입력"
            aria-label="톡 내 메일 제목"
            className="w-full h-8 px-2.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-900 text-xs"
          />

          <textarea
            rows={3}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="메일 본문을 입력하세요..."
            aria-label="톡 내 메일 본문"
            className="w-full p-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-900 text-xs resize-none"
          />

          {roomFiles.length > 0 && (
            <div className="p-2 rounded-xl bg-white/90 dark:bg-neutral-900 border border-sky-200/80 dark:border-sky-800 space-y-1.5">
              <div className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5 text-sky-700" />
                  <span>대화방 공유 파일·NAS 패키지 첨부 ({existingAttachmentIds.length}개 선택됨)</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto chat-scroll">
                {roomFiles.slice(0, 10).map((rf) => {
                  const selected = existingAttachmentIds.includes(rf.id);
                  return (
                    <button
                      key={rf.id}
                      type="button"
                      onClick={() => toggleExistingAttachment(rf.id)}
                      className={`px-2 py-1 rounded-md text-[11px] border flex items-center gap-1 max-w-full cursor-pointer ${
                        selected
                          ? 'bg-sky-700 border-sky-700 text-white font-semibold'
                          : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200'
                      }`}
                    >
                      <span className="truncate max-w-[160px]">{rf.filename}</span>
                      <span className="opacity-75 tabular-nums shrink-0">
                        ({formatFileSize(rf.size)})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-2 rounded-xl bg-white/90 dark:bg-neutral-900 border border-sky-200/80 dark:border-sky-800 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 cursor-pointer">
              <input
                type="checkbox"
                checked={attachNas}
                onChange={(e) => setAttachNas(e.target.checked)}
                className="accent-[#008069]"
              />
              <HardDrive className="h-3.5 w-3.5 text-[#008069]" />
              <span>100GB+ 사내 NAS 폴더 복사 · 외부 링크 함께 첨부</span>
            </label>

            {attachNas && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-1.5">
                <div className="flex items-center gap-1">
                  <FolderOpen className="h-3.5 w-3.5 text-[#008069] shrink-0" />
                  <select
                    value={nasFolder}
                    onChange={(e) => setNasFolder(e.target.value)}
                    aria-label="메일 NAS 폴더"
                    className="w-full h-7 px-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-[11px]"
                  >
                    {NAS_DEFAULT_FOLDERS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={nasFilename}
                  onChange={(e) => setNasFilename(e.target.value)}
                  placeholder="패키지 파일명"
                  aria-label="메일 NAS 파일명"
                  className="h-7 px-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-[11px]"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="10240"
                    value={nasSizeValue}
                    onChange={(e) => setNasSizeValue(e.target.value)}
                    aria-label="메일 첨부 용량"
                    className="w-1/2 h-7 px-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-[11px] tabular-nums"
                  />
                  <select
                    value={nasSizeUnit}
                    onChange={(e) => setNasSizeUnit(e.target.value as 'MB' | 'GB' | 'TB')}
                    aria-label="메일 첨부 단위"
                    className="w-1/2 h-7 px-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-[11px]"
                  >
                    <option value="MB">MB</option>
                    <option value="GB">GB</option>
                    <option value="TB">TB</option>
                  </select>
                </div>
                <div className="relative flex items-center">
                  <Lock className="h-3 w-3 text-neutral-400 absolute left-1.5 pointer-events-none" />
                  <input
                    type="password"
                    value={nasPasscode}
                    onChange={(e) => setNasPasscode(e.target.value)}
                    placeholder="PIN(선택)"
                    aria-label="메일 첨부 PIN"
                    className="w-full h-7 pl-5 pr-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-[11px]"
                  />
                </div>
              </div>
            )}
          </div>

          {composeError && <p className="text-xs text-red-600 dark:text-red-400">{composeError}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {roomId ? (
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncToRoom}
                  onChange={(e) => setSyncToRoom(e.target.checked)}
                  className="accent-[#008069]"
                />
                <span>현재 채팅방에도 메일 카드 공유</span>
              </label>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={sending || !subject.trim() || !body.trim()}
              className="h-8 px-3.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span>{sending ? '발송 중...' : '톡에서 바로 메일 보내기'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* 2. In-Chat Unified Alerts & Urgent Notices Briefing Panel */
interface InChatAlertsPanelProps {
  currentUserId?: string;
  notices: Notice[];
  notifications: NotificationItem[];
  onAcknowledgeNotice?: (noticeId: string) => Promise<void> | void;
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onOpenMail?: (mailId: string) => void;
  onOpenRoom?: (roomId: string) => void;
  onClose: () => void;
}

export function InChatAlertsPanel({
  currentUserId,
  notices,
  notifications,
  onAcknowledgeNotice,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenMail,
  onOpenRoom,
  onClose,
}: InChatAlertsPanelProps) {
  const unreadNotifs = notifications.filter((n) => !n.read);
  const urgentNotices = notices.filter(
    (n) => (n.isUrgent || n.priority === 'urgent') && (!currentUserId || !n.acknowledgedBy?.includes(currentUserId)),
  );

  return (
    <div
      aria-label="톡 내 통합 알림 브리핑"
      className="p-3.5 bg-amber-50/90 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
          <BellRing className="h-4 w-4 text-amber-600" />
          <span>
            톡 내 통합 알림 ({unreadNotifs.length}건 미확인 · 미확인 긴급공지 {urgentNotices.length}건)
          </span>
        </span>
        <div className="flex items-center gap-2">
          {unreadNotifs.length > 0 && onMarkAllNotificationsRead && (
            <button
              type="button"
              onClick={onMarkAllNotificationsRead}
              className="h-6 px-2 rounded-md bg-white dark:bg-neutral-900 border border-amber-300 dark:border-amber-800 text-[10px] font-bold text-amber-900 dark:text-amber-200 cursor-pointer"
            >
              모두 읽음
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="통합 알림 닫기"
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto chat-scroll space-y-1.5 pr-0.5">
        {urgentNotices.map((notice) => (
          <div
            key={notice.id}
            className="p-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-[11px] font-extrabold text-red-700 dark:text-red-300">
                <Siren className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">[미확인 긴급공지] {notice.title}</span>
              </div>
              <p className="text-[11px] text-red-900/90 dark:text-red-100 truncate">
                {notice.content}
              </p>
            </div>
            {onAcknowledgeNotice && (
              <button
                type="button"
                onClick={() => onAcknowledgeNotice(notice.id)}
                className="h-7 px-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold shrink-0 cursor-pointer"
              >
                확인 완료
              </button>
            )}
          </div>
        ))}

        {notifications.length === 0 ? (
          <p className="py-3 text-center text-xs text-neutral-500">새로운 알림이 없습니다.</p>
        ) : (
          notifications.slice(0, 8).map((n) => (
            <div
              key={n.id}
              className={`p-2 rounded-xl border flex items-center justify-between gap-2 ${
                n.read
                  ? 'bg-white/70 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 opacity-75'
                  : 'bg-white dark:bg-neutral-900 border-amber-200 dark:border-amber-800'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                  {n.title}
                </div>
                <div className="text-[11px] text-neutral-600 dark:text-neutral-300 truncate">
                  {n.body}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {n.mailId && onOpenMail && (
                  <button
                    type="button"
                    onClick={() => {
                      onMarkNotificationRead?.(n.id);
                      onOpenMail(n.mailId!);
                    }}
                    className="h-6 px-2 rounded-md bg-sky-700 text-white text-[10px] font-bold cursor-pointer"
                  >
                    메일 열기
                  </button>
                )}
                {n.roomId && onOpenRoom && (
                  <button
                    type="button"
                    onClick={() => {
                      onMarkNotificationRead?.(n.id);
                      onOpenRoom(n.roomId!);
                    }}
                    className="h-6 px-2 rounded-md bg-[#008069] text-white text-[10px] font-bold cursor-pointer"
                  >
                    이동
                  </button>
                )}
                {!n.read && onMarkNotificationRead && (
                  <button
                    type="button"
                    onClick={() => onMarkNotificationRead(n.id)}
                    className="h-6 px-2 rounded-md border border-neutral-200 dark:border-neutral-700 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer"
                  >
                    읽음
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* 3. In-Chat Room Conversation Summary Panel (/요약) */
interface InChatSummaryPanelProps {
  loading: boolean;
  summaryText: string;
  bullets: string[];
  messageCount: number;
  onPostToChat: () => Promise<void>;
  onSaveToMeetingMemo?: () => void;
  onClose: () => void;
}

export function InChatSummaryPanel({
  loading,
  bullets,
  messageCount,
  onPostToChat,
  onSaveToMeetingMemo,
  onClose,
}: InChatSummaryPanelProps) {
  const [posting, setPosting] = useState(false);

  return (
    <div
      aria-label="대화방 핵심 요약"
      className="p-3.5 bg-emerald-50/90 dark:bg-emerald-950/35 border-b border-emerald-200 dark:border-emerald-900 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-[#075E54] dark:text-[#07C160]">
          <Sparkles className="h-4 w-4" />
          <span>대화 핵심 요약 (최근 {messageCount}건 분석)</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="대화 요약 닫기"
          className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="py-3 flex items-center gap-2 text-xs text-[#075E54] dark:text-[#07C160]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>현재 채팅방 대화를 요약하는 중입니다...</span>
        </div>
      ) : (
        <>
          <ul className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-emerald-200/80 dark:border-emerald-800 space-y-1 text-xs text-neutral-800 dark:text-neutral-200">
            {bullets.map((b, i) => (
              <li key={i} className="leading-snug">
                • {b}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onSaveToMeetingMemo && (
              <button
                type="button"
                onClick={onSaveToMeetingMemo}
                className="h-7 px-2.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-neutral-900 text-[11px] font-semibold text-[#075E54] dark:text-[#07C160] flex items-center gap-1 cursor-pointer"
              >
                <NotebookPen className="h-3.5 w-3.5" />
                <span>미팅메모로 연동</span>
              </button>
            )}
            <button
              type="button"
              disabled={posting || bullets.length === 0}
              onClick={async () => {
                setPosting(true);
                try {
                  await onPostToChat();
                } finally {
                  setPosting(false);
                }
              }}
              className="h-7 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <Send className="h-3 w-3" />
              <span>{posting ? '공유 중...' : '톡방에 요약 올리기'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
