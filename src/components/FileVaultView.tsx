import { useMemo, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Lock,
  Search,
  Send,
} from 'lucide-react';
import { formatFileSize, formatKoreanTime, getRoomDisplayName } from '../shared/logic';
import { SHARE_PROVIDER_LABELS } from '../shared/voiceAnalysis';
import type { ChatRoom, SharedFileItem, User } from '../types/client';

interface FileVaultViewProps {
  currentUser: User;
  usersById: Record<string, User>;
  roomsById: Record<string, ChatRoom>;
  files: SharedFileItem[];
  fileToken?: string | null;
  onPreviewImage: (file: SharedFileItem) => void;
  onOpenRoom: (roomId: string) => void;
  onSendToSelf?: (messageId: string) => Promise<void> | void;
  onRevokeFile?: (fileId: string) => Promise<void> | void;
}

export function FileVaultView({
  currentUser,
  usersById,
  roomsById,
  files,
  fileToken,
  onPreviewImage,
  onOpenRoom,
  onSendToSelf,
  onRevokeFile,
}: FileVaultViewProps) {
  const [filter, setFilter] = useState<'all' | 'image' | 'doc' | 'large' | 'nas'>('all');
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sentSelfId, setSentSelfId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const ftParam = fileToken ? `ft=${encodeURIComponent(fileToken)}` : '';

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (filter === 'image' && !f.isImage) return false;
      if (filter === 'doc' && f.isImage) return false;
      if (filter === 'large' && !f.isLargeFile && !f.isExternalLink && !f.shareUrl) return false;
      if (filter === 'nas' && !f.nasFolder && f.storageLocation !== 'internal-nas') return false;
      if (!q) return true;
      return (
        f.filename.toLowerCase().includes(q) ||
        (f.nasFolder ?? '').toLowerCase().includes(q)
      );
    });
  }, [files, filter, query]);

  return (
    <div className="h-full overflow-y-auto chat-scroll bg-neutral-50 dark:bg-neutral-950 p-4 md:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-[#008069] dark:text-[#07C160]" />
            <span>전사 공유 파일함</span>
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            내부 사내 NAS 폴더 복사 파일과 최대 500MB 분할 업로드 및 100GB+ 외부 접속 보안 링크를 한눈에 관리합니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-neutral-200/70 dark:bg-neutral-800 rounded-xl overflow-x-auto">
            {(
              [
                { id: 'all', label: '전체' },
                { id: 'nas', label: '사내 NAS' },
                { id: 'image', label: '사진' },
                { id: 'doc', label: '문서' },
                { id: 'large', label: '초고용량 링크' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === opt.id
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="파일명 검색..."
          aria-label="공유 파일 검색"
          className="w-full h-10 pl-9 pr-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]"
        />
      </div>

      {filteredFiles.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-center text-sm text-neutral-400">
          조건에 해당하는 공유 파일이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredFiles.map((file) => {
            const uploader = usersById[file.uploaderId];
            const room = roomsById[file.roomId];
            const roomName = room ? getRoomDisplayName(room, currentUser.id, usersById) : '채팅방';
            const inlineUrl = ftParam
              ? `${file.url}?inline=1&${ftParam}`
              : `${file.url}?inline=1`;
            const downloadUrl = file.shareUrl
              ? file.shareUrl
              : file.isExternalLink
                ? file.url
                : ftParam
                  ? `${file.url}?${ftParam}`
                  : file.url;
            const rawShareUrl = file.nasExternalAccessUrl || file.shareUrl || file.url;
            const absShareUrl =
              rawShareUrl.startsWith('http')
                ? rawShareUrl
                : typeof window !== 'undefined'
                  ? `${window.location.origin}${rawShareUrl}${!file.shareUrl && !file.nasExternalAccessUrl && ftParam ? `?${ftParam}` : ''}`
                  : rawShareUrl;
            const isLargeOrLink = Boolean(file.isLargeFile || file.isExternalLink || file.shareUrl);
            const isRevoked = Boolean(file.revoked);
            const providerLabel = file.shareProvider
              ? SHARE_PROVIDER_LABELS[file.shareProvider]
              : undefined;
            const canRevoke =
              !isRevoked &&
              Boolean(onRevokeFile) &&
              (file.uploaderId === currentUser.id || currentUser.role === 'admin');

            const metaParts: string[] = [formatFileSize(file.size)];
            if (file.nasFolder) metaParts.push(`NAS: ${file.nasFolder}`);
            if (providerLabel && !file.nasFolder) metaParts.push(providerLabel);
            else if (isLargeOrLink && !file.nasFolder) metaParts.push('대용량 링크');
            if (file.hasPasscode) metaParts.push('비밀번호 보호');
            if (typeof file.downloadCount === 'number' || file.maxDownloads) {
              metaParts.push(
                file.maxDownloads
                  ? `다운로드 ${file.downloadCount ?? 0}/${file.maxDownloads}회`
                  : `다운로드 ${file.downloadCount ?? 0}회`,
              );
            }
            metaParts.push(uploader?.name ?? '사원');
            metaParts.push(formatKoreanTime(file.createdAt));

            return (
              <div
                key={file.id}
                className={`p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-3 ${
                  isRevoked ? 'opacity-70' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {file.isImage ? (
                      <button
                        type="button"
                        onClick={() => onPreviewImage(file)}
                        className="h-12 w-12 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 shrink-0 cursor-pointer"
                      >
                        <img
                          src={inlineUrl}
                          alt={file.filename}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-neutral-600 dark:text-neutral-300" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {file.hasPasscode && <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                        <span
                          className={`text-sm font-semibold text-neutral-900 dark:text-white truncate ${
                            isRevoked ? 'line-through' : ''
                          }`}
                        >
                          {file.filename}
                        </span>
                        {isRevoked && (
                          <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0">
                            · 회수됨
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums leading-snug break-words mt-0.5">
                        {metaParts.join(' · ')}
                      </div>
                      {file.shareExpiresAt && (
                        <div className="text-[11px] text-neutral-400 tabular-nums mt-0.5">
                          링크 만료: {file.shareExpiresAt.slice(0, 10)}
                        </div>
                      )}
                    </div>
                  </div>

                  {isRevoked ? (
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400 shrink-0">
                      만료·회수
                    </span>
                  ) : (
                    <a
                      href={downloadUrl}
                      target={file.isExternalLink || file.shareUrl ? '_blank' : undefined}
                      rel={file.isExternalLink || file.shareUrl ? 'noopener noreferrer' : undefined}
                      download={file.isExternalLink || file.shareUrl ? undefined : file.filename}
                      aria-label={`${file.filename} 다운로드`}
                      className="h-9 w-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-[#008069] hover:text-white flex items-center justify-center shrink-0 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => onOpenRoom(file.roomId)}
                    className="text-[11px] font-medium text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer flex items-center gap-1 whitespace-nowrap"
                  >
                    {file.isImage ? <ImageIcon className="h-3 w-3" /> : null}
                    <span>{roomName} 이동</span>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isRevoked && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(absShareUrl).catch(() => {});
                          setCopiedId(file.id);
                          window.setTimeout(() => setCopiedId((cur) => (cur === file.id ? null : cur)), 1800);
                        }}
                        className="h-7 px-2 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedId === file.id ? (
                          <Check className="h-3 w-3 text-[#008069]" />
                        ) : (
                          <Link2 className="h-3 w-3" />
                        )}
                        <span>{copiedId === file.id ? '링크 복사됨' : '링크 복사'}</span>
                      </button>
                    )}

                    {!isRevoked && onSendToSelf && (
                      <button
                        type="button"
                        onClick={async () => {
                          await onSendToSelf(file.messageId);
                          setSentSelfId(file.id);
                          window.setTimeout(
                            () => setSentSelfId((cur) => (cur === file.id ? null : cur)),
                            1800,
                          );
                        }}
                        className="h-7 px-2 rounded-lg bg-[#008069]/10 hover:bg-[#008069]/20 text-[11px] font-semibold text-[#008069] dark:text-[#07C160] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Send className="h-3 w-3" />
                        <span>{sentSelfId === file.id ? '전송됨' : '나에게 보내기'}</span>
                      </button>
                    )}

                    {canRevoke && (
                      <button
                        type="button"
                        disabled={revokingId === file.id}
                        onClick={async () => {
                          if (!onRevokeFile) return;
                          setRevokingId(file.id);
                          try {
                            await onRevokeFile(file.id);
                          } finally {
                            setRevokingId((cur) => (cur === file.id ? null : cur));
                          }
                        }}
                        className="h-7 px-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-[11px] font-semibold text-red-700 dark:text-red-300 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {revokingId === file.id ? '회수 중...' : '링크 회수'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
