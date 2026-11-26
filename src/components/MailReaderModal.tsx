import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Forward,
  Link2,
  Loader2,
  Lock,
  Mail,
  MessageSquareShare,
  Reply,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { buildMailReplyDraftPure } from '../shared/chatLogic';
import { buildConciseMailDigest, summarizeMailBodyPure } from '../shared/controlTower';
import { formatFileSize, formatKoreanTime } from '../shared/logic';
import { NAS_DEFAULT_FOLDERS } from '../shared/nasShare';
import { speakKoreanVoiceText, stopAllSpeechSynthesis } from '../utils/voiceAudio';
import type { MailMessage, SharedFileItem, User } from '../types/client';

interface MailReaderModalProps {
  mail: MailMessage;
  usersById: Record<string, User>;
  colleagues?: User[];
  currentUser: User;
  activeRoomId?: string | null;
  fileToken?: string | null;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onMarkRead?: (mailId: string) => void;
  onMailSent?: (mail: MailMessage, uploadedFile?: SharedFileItem) => void;
  onShareSummaryToChat?: (summaryText: string) => Promise<void> | void;
  onLaunchExternalMailApp?: (mailId: string, provider: 'bmail' | 'bigmail') => void;
  onFileCopiedToNas?: (file: SharedFileItem, nasFolder: string) => void;
}

export function MailReaderModal({
  mail,
  usersById,
  colleagues = [],
  currentUser,
  activeRoomId = null,
  fileToken,
  apiFetch,
  onClose,
  onMarkRead,
  onMailSent,
  onShareSummaryToChat,
  onLaunchExternalMailApp,
  onFileCopiedToNas,
}: MailReaderModalProps) {
  const sender = usersById[mail.senderId];
  const senderName = sender ? `${sender.name} ${sender.position}` : '사내 임직원';
  const digest = buildConciseMailDigest(mail, senderName);
  const provider = mail.provider === 'bigmail' ? 'bigmail' : 'bmail';

  const [bullets, setBullets] = useState<string[]>(() => summarizeMailBodyPure(mail, senderName));
  const [summaryEngine, setSummaryEngine] = useState<'gemini-4-hydrogen' | 'local-digest'>(
    'local-digest',
  );
  const [summarizing, setSummarizing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sharedDone, setSharedDone] = useState(false);
  const [copiedAttId, setCopiedAttId] = useState<string | null>(null);
  const [nasTargetByAtt, setNasTargetByAtt] = useState<Record<string, string>>({});
  const [copyingAttId, setCopyingAttId] = useState<string | null>(null);
  const [copiedNasMsgByAtt, setCopiedNasMsgByAtt] = useState<Record<string, string>>({});
  const [composeMode, setComposeMode] = useState<'reply' | 'replyAll' | 'forward' | null>(null);
  const [composeProvider, setComposeProvider] = useState<'bmail' | 'bigmail'>(provider);
  const [composeRecipients, setComposeRecipients] = useState<string[]>([]);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeAttachmentIds, setComposeAttachmentIds] = useState<string[]>([]);
  const [syncReplyToRoom, setSyncReplyToRoom] = useState(true);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState<string | null>(null);

  useEffect(() => {
    setComposeMode(null);
    setReplyError(null);
    setReplySuccess(null);
    if (!mail.readByUserIds.includes(currentUser.id)) {
      onMarkRead?.(mail.id);
    }
    return () => {
      stopAllSpeechSynthesis();
    };
  }, [mail.id]);

  const openInlineCompose = (mode: 'reply' | 'replyAll' | 'forward') => {
    const draft = buildMailReplyDraftPure(mail, senderName, mode, currentUser.id);
    const selectableColleagues =
      colleagues.length > 0
        ? colleagues
        : Object.values(usersById).filter((u) => u.id !== currentUser.id && u.role !== 'bot');
    setComposeMode(mode);
    setComposeProvider(draft.provider);
    setComposeRecipients(
      draft.recipientIds.length > 0
        ? draft.recipientIds
        : selectableColleagues[0]
          ? [selectableColleagues[0].id]
          : [],
    );
    setComposeSubject(draft.subject);
    setComposeBody(draft.body);
    setComposeAttachmentIds(draft.existingAttachmentIds);
    setReplyError(null);
    setReplySuccess(null);
  };

  const handleSendInlineCompose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingReply) return;
    if (composeRecipients.length === 0) {
      setReplyError('수신자를 최소 1명 선택해 주세요.');
      return;
    }
    if (!composeSubject.trim() || !composeBody.trim()) {
      setReplyError('메일 제목과 본문을 입력해 주세요.');
      return;
    }
    setSendingReply(true);
    setReplyError(null);
    try {
      const res = await apiFetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: composeProvider,
          recipientIds: composeRecipients,
          subject: composeSubject.trim(),
          body: composeBody.trim(),
          category: mail.category || '일반',
          ...(composeAttachmentIds.length > 0 ? { existingAttachmentIds: composeAttachmentIds } : {}),
          ...(composeMode !== 'forward' ? { inReplyToMailId: mail.id } : {}),
          ...(syncReplyToRoom && activeRoomId ? { syncToRoomId: activeRoomId } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        mail?: MailMessage;
        uploadedFile?: SharedFileItem;
        error?: string;
      };
      if (!res.ok || !data.mail) {
        setReplyError(data.error || '메일 전송에 실패했습니다.');
        return;
      }
      onMailSent?.(data.mail, data.uploadedFile);
      setReplySuccess(
        composeMode === 'forward' ? '메일을 전달했습니다.' : '답장 메일을 발송했습니다.',
      );
      setComposeMode(null);
    } finally {
      setSendingReply(false);
    }
  };

  const handleSummarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      const res = await apiFetch(`/api/mail/${mail.id}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          bullets?: string[];
          engine?: 'gemini-4-hydrogen' | 'local-digest';
        };
        if (Array.isArray(data.bullets) && data.bullets.length > 0) {
          setBullets(data.bullets);
          if (data.engine) setSummaryEngine(data.engine);
        }
      }
    } finally {
      setSummarizing(false);
    }
  };

  const handleSpeakSummary = () => {
    if (speaking) {
      stopAllSpeechSynthesis();
      setSpeaking(false);
      return;
    }
    const text = `${digest.providerLabel} 메일 요약. 발신자 ${senderName}. 제목 ${mail.subject}. ${bullets.join(' ')}`;
    const started = speakKoreanVoiceText(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
    if (!started) setSpeaking(false);
  };

  const handleShare = async () => {
    if (!onShareSummaryToChat) return;
    const msgText = `[${digest.providerLabel} 요약 공유] ${mail.subject}\n발신: ${senderName} · ${digest.attachmentLabel}\n${bullets
      .map((b) => `- ${b}`)
      .join('\n')}`;
    await onShareSummaryToChat(msgText);
    setSharedDone(true);
    window.setTimeout(() => setSharedDone(false), 2000);
  };

  const recipientNames = mail.recipientIds
    .map((id) => usersById[id])
    .filter(Boolean)
    .map((u) => `${u.name} ${u.position}`)
    .join(', ');

  const ftParam = fileToken ? `ft=${encodeURIComponent(fileToken)}` : '';
  const attachments = mail.attachments ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="빅메일·비메일 상세 보기"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-[#008069]/12 dark:bg-[#07C160]/15 text-[#008069] dark:text-[#07C160] flex items-center justify-center shrink-0">
              <Mail className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <span className="text-[#008069] dark:text-[#07C160] font-bold">
                  {digest.providerLabel}
                </span>
                <span aria-hidden="true">·</span>
                <span>{mail.category}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatKoreanTime(mail.createdAt)}</span>
              </div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white truncate">
                {mail.subject}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="메일 상세 창 닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto chat-scroll p-5 space-y-5">
          {/* Sender / Recipients Metadata */}
          <div className="text-xs text-neutral-600 dark:text-neutral-300 space-y-1 pb-4 border-b border-neutral-200/80 dark:border-neutral-800">
            <div>
              <span className="text-neutral-400 mr-2">보낸사람</span>
              <span className="font-semibold text-neutral-900 dark:text-white">
                {senderName} ({sender?.email ?? 'staff@sgw.co.kr'})
              </span>
            </div>
            <div>
              <span className="text-neutral-400 mr-2">받는사람</span>
              <span>{recipientNames || '사내 수신자'}</span>
            </div>
          </div>

          {/* AI 3-Line Summary Panel */}
          <section
            aria-label="메일 AI 핵심 요약"
            className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/80 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#075E54] dark:text-[#07C160]">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>핵심 내용 요약</span>
                <span className="font-normal text-neutral-500 dark:text-neutral-400">
                  · {summaryEngine === 'gemini-4-hydrogen' ? 'Gemini AI 요약' : 'SGW 핵심 정리'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleSpeakSummary}
                  className="h-8 px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5 text-[#008069] dark:text-[#07C160]" />
                  <span>{speaking ? '읽기 중지' : '음성으로 듣기'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="h-8 px-3 rounded-lg bg-[#008069] hover:bg-[#006B58] disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {summarizing ? 'AI 요약 중...' : 'AI 3줄 요약 새로고침'}
                </button>
              </div>
            </div>

            <ul className="space-y-1.5 text-xs text-neutral-800 dark:text-neutral-200 leading-relaxed">
              {bullets.map((line, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="font-mono text-[11px] font-bold text-[#008069] dark:text-[#07C160] tabular-nums mt-0.5">
                    0{idx + 1}.
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Full Email Content */}
          <section aria-label="메일 원문" className="space-y-2">
            <h3 className="text-xs font-bold text-neutral-500 dark:text-neutral-400">
              본문 내용
            </h3>
            <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-sm text-neutral-800 dark:text-neutral-100 leading-relaxed whitespace-pre-wrap break-words">
              {mail.body}
            </div>
          </section>

          {/* Attachments */}
          <section aria-label="첨부 파일 목록" className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <h3 className="font-bold text-neutral-500 dark:text-neutral-400">
                첨부 파일 ({attachments.length}건)
              </h3>
              <span className="text-neutral-400">{digest.attachmentLabel}</span>
            </div>
            {attachments.length === 0 ? (
              <p className="text-xs text-neutral-400 py-2">첨부된 파일이 없습니다.</p>
            ) : (
              <div className="space-y-2.5">
                {attachments.map((att) => {
                  const isRevoked = Boolean(att.revoked);
                  const downloadHref = att.shareUrl
                    ? att.shareUrl
                    : att.downloadUrl
                      ? `${att.downloadUrl}${att.downloadUrl.includes('?') ? '&' : '?'}${ftParam}`
                      : '#';
                  const rawExtUrl =
                    att.nasExternalAccessUrl || att.shareUrl || att.downloadUrl || '';
                  const absShareUrl = rawExtUrl.startsWith('http')
                    ? rawExtUrl
                    : typeof window !== 'undefined' && rawExtUrl
                      ? `${window.location.origin}${rawExtUrl}${!att.shareUrl && !att.nasExternalAccessUrl && ftParam ? `?${ftParam}` : ''}`
                      : rawExtUrl;
                  const chosenNasFolder =
                    nasTargetByAtt[att.id] ?? att.nasFolder ?? NAS_DEFAULT_FOLDERS[0];
                  const copiedNotice = copiedNasMsgByAtt[att.id];

                  return (
                    <div
                      key={att.id}
                      className={`p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-2.5 ${
                        isRevoked ? 'opacity-70' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="h-9 w-9 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0">
                            <FileText className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-neutral-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                              {att.hasPasscode && <Lock className="h-3 w-3 text-amber-600 shrink-0" />}
                              <span className={`truncate ${isRevoked ? 'line-through' : ''}`}>
                                {att.filename}
                              </span>
                              {att.nasFolder && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-[#075E54] dark:text-[#07C160] text-[10px] font-bold shrink-0">
                                  NAS: {att.nasFolder}
                                </span>
                              )}
                              {att.hasPasscode && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-semibold shrink-0">
                                  비밀번호 보호
                                </span>
                              )}
                              {isRevoked && (
                                <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[10px] font-bold shrink-0">
                                  회수됨
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums mt-0.5">
                              {formatFileSize(att.size)} · {att.mimeType}
                              {typeof att.downloadCount === 'number' || att.maxDownloads
                                ? ` · 다운로드 ${att.downloadCount ?? 0}${att.maxDownloads ? `/${att.maxDownloads}` : ''}회`
                                : ''}
                            </div>
                            {att.nasRelativePath && (
                              <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono truncate mt-0.5">
                                사내 NAS 경로: {att.nasRelativePath}
                              </div>
                            )}
                          </div>
                        </div>

                        {!isRevoked && (att.shareUrl || att.downloadUrl) && (
                          <a
                            href={downloadHref}
                            target={att.shareUrl || att.isExternalLink ? '_blank' : undefined}
                            rel={att.shareUrl || att.isExternalLink ? 'noopener noreferrer' : undefined}
                            download={att.shareUrl || att.isExternalLink ? undefined : att.filename}
                            className="h-8 px-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 hover:border-[#008069] text-xs font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>{att.shareUrl ? '외부 링크 열기' : '다운로드'}</span>
                          </a>
                        )}
                      </div>

                      {/* External Link Copy + Internal Copy-to-NAS */}
                      <div className="pt-2 border-t border-neutral-200/70 dark:border-neutral-700/60 flex flex-wrap items-center justify-between gap-2">
                        {!isRevoked && absShareUrl ? (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(absShareUrl).catch(() => {});
                              setCopiedAttId(att.id);
                              window.setTimeout(
                                () => setCopiedAttId((cur) => (cur === att.id ? null : cur)),
                                1800,
                              );
                            }}
                            className="h-7 px-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 hover:border-[#008069] text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            {copiedAttId === att.id ? (
                              <Check className="h-3 w-3 text-[#008069]" />
                            ) : (
                              <Link2 className="h-3 w-3" />
                            )}
                            <span>{copiedAttId === att.id ? '외부 링크 복사됨' : '외부 링크 복사'}</span>
                          </button>
                        ) : (
                          <span />
                        )}

                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            value={chosenNasFolder}
                            onChange={(e) =>
                              setNasTargetByAtt((prev) => ({ ...prev, [att.id]: e.target.value }))
                            }
                            aria-label={`${att.filename} 복사할 NAS 폴더`}
                            className="h-7 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-[11px]"
                          >
                            {NAS_DEFAULT_FOLDERS.map((folder) => (
                              <option key={folder} value={folder}>
                                {folder}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={copyingAttId === att.id}
                            onClick={async () => {
                              setCopyingAttId(att.id);
                              try {
                                const res = await apiFetch(
                                  `/api/mail/${mail.id}/attachments/${att.id}/copy-to-nas`,
                                  {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ nasFolder: chosenNasFolder }),
                                  },
                                );
                                const data = (await res.json().catch(() => ({}))) as {
                                  ok?: boolean;
                                  nasFolder?: string;
                                  nasRelativePath?: string;
                                  file?: SharedFileItem;
                                  error?: string;
                                };
                                if (res.ok && data.ok) {
                                  const destFolder = data.nasFolder || chosenNasFolder;
                                  setCopiedNasMsgByAtt((prev) => ({
                                    ...prev,
                                    [att.id]: `NAS 복사 완료 (${data.nasRelativePath || destFolder})`,
                                  }));
                                  if (data.file) {
                                    onFileCopiedToNas?.(data.file, destFolder);
                                  }
                                } else {
                                  setCopiedNasMsgByAtt((prev) => ({
                                    ...prev,
                                    [att.id]: data.error || 'NAS 복사 실패',
                                  }));
                                }
                              } finally {
                                setCopyingAttId((cur) => (cur === att.id ? null : cur));
                              }
                            }}
                            className="h-7 px-2.5 rounded-lg bg-[#075E54] hover:bg-[#054a42] disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <FolderOpen className="h-3 w-3" />
                            <span>
                              {copyingAttId === att.id ? '복사 중...' : '내 NAS 폴더로 복사'}
                            </span>
                          </button>
                        </div>
                      </div>
                      {copiedNotice && (
                        <div className="text-[11px] font-semibold text-[#008069] dark:text-[#07C160]">
                          {copiedNotice}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          {replySuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{replySuccess}</span>
            </div>
          )}

          {composeMode && (
            <form
              onSubmit={handleSendInlineCompose}
              aria-label="bmail 빠른 답장 및 전달"
              className="p-4 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-sky-900 dark:text-sky-100">
                  {composeMode === 'reply'
                    ? '답장 작성'
                    : composeMode === 'replyAll'
                      ? '전체 답장 작성'
                      : '메일 전달 작성'}
                </span>
                <button
                  type="button"
                  onClick={() => setComposeMode(null)}
                  className="text-xs text-neutral-500 hover:text-neutral-900 cursor-pointer"
                >
                  취소
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {(colleagues.length > 0
                  ? colleagues
                  : Object.values(usersById).filter((u) => u.id !== currentUser.id && u.role !== 'bot')
                ).map((u) => {
                  const picked = composeRecipients.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setComposeRecipients((prev) =>
                          prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id],
                        )
                      }
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border cursor-pointer ${
                        picked
                          ? 'bg-[#008069] border-[#008069] text-white'
                          : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200'
                      }`}
                    >
                      {u.name}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                required
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                aria-label="답장 메일 제목"
                className="w-full h-8 px-2.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-900 text-xs"
              />
              <textarea
                rows={4}
                required
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                aria-label="답장 메일 본문"
                className="w-full p-2.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-900 text-xs resize-y"
              />
              {replyError && <p className="text-xs text-red-600 dark:text-red-400">{replyError}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {activeRoomId ? (
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-700 dark:text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncReplyToRoom}
                      onChange={(e) => setSyncReplyToRoom(e.target.checked)}
                      className="accent-[#008069]"
                    />
                    <span>현재 채팅방에 메일 카드 공유</span>
                  </label>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={sendingReply}
                  className="h-8 px-3.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {sendingReply ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>{sendingReply ? '발송 중...' : '메일 발송'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 px-5 py-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => openInlineCompose('reply')}
              className="h-9 px-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-800 hover:bg-sky-50 text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Reply className="h-3.5 w-3.5" />
              <span>답장</span>
            </button>
            <button
              type="button"
              onClick={() => openInlineCompose('replyAll')}
              className="h-9 px-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-800 hover:bg-sky-50 text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Reply className="h-3.5 w-3.5" />
              <span>전체답장</span>
            </button>
            <button
              type="button"
              onClick={() => openInlineCompose('forward')}
              className="h-9 px-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-neutral-800 hover:bg-sky-50 text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Forward className="h-3.5 w-3.5" />
              <span>전달</span>
            </button>
            {onShareSummaryToChat && (
              <button
                type="button"
                onClick={handleShare}
                className="h-9 px-3.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-xs font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {sharedDone ? (
                  <Check className="h-3.5 w-3.5 text-[#07C160]" />
                ) : (
                  <MessageSquareShare className="h-3.5 w-3.5 text-[#008069] dark:text-[#07C160]" />
                )}
                <span>{sharedDone ? '대화방에 공유됨' : '현재 채팅방에 요약 공유'}</span>
              </button>
            )}
            {onLaunchExternalMailApp && (
              <button
                type="button"
                onClick={() => onLaunchExternalMailApp(mail.id, provider)}
                className="h-9 px-3.5 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>외부 {digest.providerLabel} 앱 연동</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
