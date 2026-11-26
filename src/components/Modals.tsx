import { useState } from 'react';
import {
  AlertTriangle,
  Download,
  Mail,
  Megaphone,
  MessageSquare,
  Phone,
  Plus,
  Siren,
  Trash2,
  X,
} from 'lucide-react';
import { formatFileSize } from '../shared/logic';
import type { NoticePriority, PollData, SharedFileItem, User } from '../types/client';
import { Avatar } from './Avatar';

/* 1. New Chat Modal */
interface NewChatModalProps {
  currentUser: User;
  users: User[];
  onClose: () => void;
  onCreateRoom: (memberIds: string[], name: string) => Promise<void>;
}

export function NewChatModal({ currentUser, users, onClose, onCreateRoom }: NewChatModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [roomName, setRoomName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const colleagues = users.filter((u) => u.id !== currentUser.id && u.role !== 'bot');

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      await onCreateRoom(selectedIds, roomName);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="새 채팅방 만들기"
        className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-900 dark:text-white">새 대화 시작</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {selectedIds.length > 1 && (
            <div>
              <label
                htmlFor="new-room-name"
                className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
              >
                그룹 채팅방 이름 (선택)
              </label>
              <input
                id="new-room-name"
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="예: 4분기 프로젝트 TF"
                className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
              />
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">
              대화 상대 선택 ({selectedIds.length}명)
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {colleagues.map((u) => {
                const checked = selectedIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                      checked
                        ? 'bg-[#07C160]/12 dark:bg-[#07C160]/20'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar user={u} size="sm" showOnline />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                          {u.name} {u.position}
                        </div>
                        <div className="text-xs text-neutral-500 truncate">{u.department}</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(u.id)}
                      className="h-4 w-4 accent-[#008069]"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm font-medium cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={selectedIds.length === 0 || submitting}
              className="h-10 px-5 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-sm font-bold disabled:opacity-50 cursor-pointer"
            >
              {submitting ? '생성 중...' : '대화방 열기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* 2. Profile Modal */
interface ProfileModalProps {
  user: User;
  isMe: boolean;
  onClose: () => void;
  onStartDirectChat: (userId: string) => void;
  onSaveStatusMessage: (statusMessage: string) => Promise<void>;
}

export function ProfileModal({
  user,
  isMe,
  onClose,
  onStartDirectChat,
  onSaveStatusMessage,
}: ProfileModalProps) {
  const [statusInput, setStatusInput] = useState(user.statusMessage);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveStatusMessage(statusInput);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${user.name} 프로필`}
        className="w-full max-w-sm bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="h-24 bg-[#075E54] relative px-4 pt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="프로필 닫기"
            className="h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6 -mt-10 text-center">
          <div className="inline-block ring-4 ring-white dark:ring-neutral-900 rounded-[24px]">
            <Avatar user={user} size="xl" showOnline />
          </div>

          <h3 className="mt-3 text-lg font-bold text-neutral-900 dark:text-white">
            {user.name} {user.position}
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {user.department} · 잔여 연차 {user.totalLeaveDays - user.usedLeaveDays}일
          </p>

          <div className="mt-4 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/70 text-left space-y-2 text-xs text-neutral-600 dark:text-neutral-300">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-neutral-400" />
              <span>{user.email}</span>
            </div>
            {user.phone && (
              <div className="flex items-center gap-2 tabular-nums">
                <Phone className="h-3.5 w-3.5 text-neutral-400" />
                <span>{user.phone}</span>
              </div>
            )}
          </div>

          {isMe ? (
            <form onSubmit={handleSave} className="mt-4 space-y-2.5 text-left">
              <label
                htmlFor="my-status-input"
                className="block text-xs font-medium text-neutral-600 dark:text-neutral-400"
              >
                내 상태 메시지 수정
              </label>
              <input
                id="my-status-input"
                type="text"
                value={statusInput}
                onChange={(e) => setStatusInput(e.target.value)}
                maxLength={80}
                placeholder="상태 메시지를 입력하세요"
                className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="w-full h-10 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-sm font-semibold cursor-pointer"
              >
                {saving ? '저장 중...' : '프로필 저장'}
              </button>
            </form>
          ) : (
            <div className="mt-4 space-y-3">
              {user.statusMessage && (
                <p className="text-xs text-neutral-600 dark:text-neutral-300 italic">
                  "{user.statusMessage}"
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  onStartDirectChat(user.id);
                  onClose();
                }}
                className="w-full h-10 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageSquare className="h-4 w-4" />
                <span>1:1 채팅하기</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* 3. Notice Creation Modal */
interface NoticeModalProps {
  initialTitle?: string;
  initialContent?: string;
  initialUrgent?: boolean;
  onClose: () => void;
  onSubmit: (
    title: string,
    content: string,
    options?: {
      priority: NoticePriority;
      isUrgent: boolean;
      pushAllMembers: boolean;
    },
  ) => Promise<void>;
}

export function NoticeModal({
  initialTitle = '',
  initialContent = '',
  initialUrgent = false,
  onClose,
  onSubmit,
}: NoticeModalProps) {
  const [title, setTitle] = useState(
    initialTitle || (initialUrgent ? '긴급 공지사항' : '채팅방 공지사항'),
  );
  const [content, setContent] = useState(initialContent);
  const [priority, setPriority] = useState<NoticePriority>(initialUrgent ? 'urgent' : 'normal');
  const [isUrgent, setIsUrgent] = useState(Boolean(initialUrgent));
  const [pushAllMembers, setPushAllMembers] = useState(Boolean(initialUrgent));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleToggleUrgent = (checked: boolean) => {
    setIsUrgent(checked);
    if (checked) {
      setPriority('urgent');
      setPushAllMembers(true);
    } else if (priority === 'urgent') {
      setPriority('normal');
    }
  };

  const handleSelectPriority = (next: NoticePriority) => {
    setPriority(next);
    if (next === 'urgent') {
      setIsUrgent(true);
      setPushAllMembers(true);
    } else {
      setIsUrgent(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(title, content, {
        priority: isUrgent ? 'urgent' : priority,
        isUrgent,
        pushAllMembers: isUrgent || pushAllMembers,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '공지 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="공지 등록"
        className={`w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border shadow-xl overflow-hidden ${
          isUrgent
            ? 'border-red-400 dark:border-red-700 ring-2 ring-red-500/30'
            : 'border-neutral-200 dark:border-neutral-800'
        }`}
      >
        <div
          className={`px-5 py-4 border-b flex items-center justify-between ${
            isUrgent
              ? 'bg-red-600 text-white border-red-500'
              : 'border-neutral-100 dark:border-neutral-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {isUrgent ? (
              <Siren className="h-4 w-4 text-amber-200 animate-pulse" />
            ) : (
              <Megaphone className="h-4 w-4 text-amber-600" />
            )}
            <h3
              className={`text-base font-bold ${
                isUrgent ? 'text-white' : 'text-neutral-900 dark:text-white'
              }`}
            >
              {isUrgent ? '긴급 재난문자 공지 등록' : '채팅방 공지 등록'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className={`h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer ${
              isUrgent
                ? 'text-white/90 hover:bg-white/15'
                : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Priority selector */}
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              공지 등급
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800">
              {(
                [
                  { id: 'normal', label: '일반 공지' },
                  { id: 'important', label: '중요 공지' },
                  { id: 'urgent', label: '긴급 재난문자' },
                ] as const
              ).map((opt) => {
                const active = (isUrgent ? 'urgent' : priority) === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectPriority(opt.id)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? opt.id === 'urgent'
                          ? 'bg-red-600 text-white shadow-xs'
                          : opt.id === 'important'
                            ? 'bg-amber-500 text-white shadow-xs'
                            : 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="notice-title"
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              공지 제목
            </label>
            <input
              id="notice-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="notice-content"
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              공지 내용
            </label>
            <textarea
              id="notice-content"
              rows={4}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="방 상단에 고정될 공지 내용을 입력하세요..."
              className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm resize-none"
            />
          </div>

          {/* Urgent Alert & Push All Members */}
          <div
            className={`p-3 rounded-xl border space-y-2 transition-colors ${
              isUrgent
                ? 'bg-red-50 dark:bg-red-950/35 border-red-300 dark:border-red-800'
                : 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700'
            }`}
          >
            <label
              htmlFor="notice-urgent-alert"
              className="flex items-start gap-2.5 cursor-pointer select-none"
            >
              <input
                id="notice-urgent-alert"
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => handleToggleUrgent(e.target.checked)}
                aria-label="긴급 알림 (Urgent Alert)"
                className="mt-0.5 h-4 w-4 accent-red-600 cursor-pointer"
              />
              <div className="min-w-0">
                <div className="text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>긴급 알림 (Urgent Alert) · 재난문자처럼 전 회원에게 즉시 푸시</span>
                </div>
                <p className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-0.5">
                  접속 중인 모든 SG Talk 회원 화면에 긴급재난문자 배너와 경보음·푸시 알림을 즉시 전파합니다.
                </p>
              </div>
            </label>

            <label
              htmlFor="notice-push-all"
              className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer select-none pt-1 border-t border-neutral-200/70 dark:border-neutral-700/60"
            >
              <input
                id="notice-push-all"
                type="checkbox"
                checked={isUrgent || pushAllMembers}
                disabled={isUrgent}
                onChange={(e) => setPushAllMembers(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#008069]"
              />
              <span>전체 회원 알림함에도 공지 푸시 발송</span>
            </label>
          </div>

          {error && (
            <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm font-medium cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className={`h-10 px-5 rounded-xl text-white text-sm font-bold disabled:opacity-50 cursor-pointer ${
                isUrgent
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-[#008069] hover:bg-[#006B58]'
              }`}
            >
              {submitting
                ? '발송 중...'
                : isUrgent
                  ? '긴급 재난문자 공지 등록'
                  : '공지 고정하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* 4. Poll Creation Modal */
interface PollModalProps {
  onClose: () => void;
  onSubmit: (poll: PollData) => Promise<void>;
}

export function PollModal({ onClose, onSubmit }: PollModalProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleaned.length < 2) return;
    setSubmitting(true);
    try {
      await onSubmit({
        question: question.trim(),
        options: cleaned.map((text, idx) => ({ id: `opt-${Date.now()}-${idx}`, text, voterIds: [] })),
        allowMultiple,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="투표 만들기"
        className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-900 dark:text-white">채팅방 투표 만들기</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="poll-question"
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              투표 제목
            </label>
            <input
              id="poll-question"
              type="text"
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="예: 다음 주 회의 시간 선택"
              className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
            />
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              선택 항목
            </span>
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  value={opt}
                  onChange={(e) =>
                    setOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                  }
                  placeholder={`항목 ${idx + 1}`}
                  className="flex-1 h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label={`항목 ${idx + 1} 삭제`}
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-neutral-400 hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 5 && (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="text-xs font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                항목 추가
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowMultiple}
              onChange={(e) => setAllowMultiple(e.target.checked)}
            />
            복수 선택 허용
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm font-medium cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 px-5 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-sm font-bold cursor-pointer"
            >
              투표 올리기
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* 5. Image Lightbox Modal */
interface ImageLightboxModalProps {
  file: SharedFileItem;
  fileToken?: string | null;
  onClose: () => void;
}

export function ImageLightboxModal({ file, fileToken, onClose }: ImageLightboxModalProps) {
  const ftParam = fileToken ? `ft=${encodeURIComponent(fileToken)}` : '';
  const downloadUrl = ftParam ? `${file.url}?${ftParam}` : file.url;
  const inlineUrl = ftParam ? `${file.url}?inline=1&${ftParam}` : `${file.url}?inline=1`;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl flex items-center justify-between text-white mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{file.filename}</p>
          <p className="text-xs text-neutral-300 tabular-nums">{formatFileSize(file.size)}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            download={file.filename}
            className="h-9 px-3 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-medium flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" />
            <span>다운로드</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="이미지 미리보기 닫기"
            className="h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <img
        src={inlineUrl}
        alt={file.filename}
        referrerPolicy="no-referrer"
        className="max-h-[80vh] max-w-full rounded-xl object-contain"
      />
    </div>
  );
}
