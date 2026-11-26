import { ExternalLink } from 'lucide-react';
import {
  extractUrlsFromText,
  parseMessageSegments,
  sanitizeSafeHttpUrl,
} from '../../shared/chatLogic';
import type { User } from '../../types/client';

interface MessageRichTextProps {
  content: string;
  roomMembers: User[];
  currentUserId: string;
  isMe: boolean;
  highlightQuery?: string;
  onSelectUserProfile: (user: User) => void;
}

function renderHighlightedText(text: string, query?: string) {
  const q = query?.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark
        key={idx}
        className="bg-[#FEE500] text-[#111B21] rounded-xs px-0.5 font-semibold"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function MessageRichText({
  content,
  roomMembers,
  currentUserId,
  isMe,
  highlightQuery,
  onSelectUserProfile,
}: MessageRichTextProps) {
  const segments = parseMessageSegments(content, roomMembers);
  const urls = extractUrlsFromText(content);
  const firstUrl = urls.map((u) => sanitizeSafeHttpUrl(u)).find(Boolean) ?? null;

  return (
    <div className="space-y-1.5">
      <p className="whitespace-pre-wrap break-words">
        {segments.map((seg, idx) => {
          if (seg.kind === 'url') {
            const safeHref = sanitizeSafeHttpUrl(seg.href);
            if (!safeHref) {
              return <span key={idx}>{seg.value}</span>;
            }
            return (
              <a
                key={idx}
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 font-medium text-[#008069] dark:text-[#53BDEB] hover:opacity-80 break-all"
              >
                {seg.value}
              </a>
            );
          }

          if (seg.kind === 'code') {
            return (
              <code
                key={idx}
                className="px-1.5 py-0.5 mx-0.5 rounded-md bg-black/8 dark:bg-white/12 font-mono text-[12px]"
              >
                {seg.value}
              </code>
            );
          }

          if (seg.kind === 'mention') {
            const isMentioningMe = seg.userId === currentUserId || seg.userId === 'all';
            const mentionedUser =
              seg.userId !== 'all' ? roomMembers.find((u) => u.id === seg.userId) : undefined;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (mentionedUser) onSelectUserProfile(mentionedUser);
                }}
                className={`inline-flex items-center px-1.5 py-0.2 rounded-md text-xs font-bold mx-0.5 transition-colors ${
                  mentionedUser ? 'cursor-pointer hover:underline' : 'cursor-default'
                } ${
                  isMentioningMe
                    ? isMe
                      ? 'bg-[#008069]/20 text-[#075E54] dark:bg-white/20 dark:text-white'
                      : 'bg-[#FEE500]/70 text-[#1C2924] dark:bg-[#FEE500]/25 dark:text-[#FEE500]'
                    : 'bg-black/8 dark:bg-white/12 text-[#008069] dark:text-[#07C160]'
                }`}
              >
                {seg.value}
              </button>
            );
          }

          return <span key={idx}>{renderHighlightedText(seg.value, highlightQuery)}</span>;
        })}
      </p>

      {firstUrl && (
        <a
          href={firstUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-black/20 border border-black/8 dark:border-white/10 text-[11px] hover:bg-black/10 transition-colors"
        >
          <span className="truncate font-medium opacity-85">{firstUrl}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </a>
      )}
    </div>
  );
}
