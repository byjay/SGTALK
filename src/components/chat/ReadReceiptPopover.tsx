import { CheckCheck, Clock, X } from 'lucide-react';
import { getReadReceiptBreakdown } from '../../shared/chatLogic';
import type { Message, User } from '../../types/client';
import { Avatar } from '../Avatar';

interface ReadReceiptPopoverProps {
  message: Message;
  roomMemberIds: string[];
  usersById: Record<string, User>;
  alignRight: boolean;
  onClose: () => void;
}

export function ReadReceiptPopover({
  message,
  roomMemberIds,
  usersById,
  alignRight,
  onClose,
}: ReadReceiptPopoverProps) {
  const { readUsers, unreadUsers } = getReadReceiptBreakdown(message, roomMemberIds, usersById);

  return (
    <div
      role="dialog"
      aria-label="메시지 읽음 확인 상세"
      className={`absolute bottom-full mb-1.5 ${
        alignRight ? 'right-0' : 'left-0'
      } z-30 w-64 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl p-3 space-y-2.5 text-left`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-1.5">
        <span className="text-xs font-bold text-neutral-900 dark:text-white">
          메시지 읽음 현황
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="읽음 확인 닫기"
          className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto chat-scroll">
        <div>
          <div className="text-[11px] font-semibold text-[#008069] dark:text-[#07C160] flex items-center gap-1 mb-1">
            <CheckCheck className="h-3.5 w-3.5" />
            <span>읽음 ({readUsers.length})</span>
          </div>
          {readUsers.length === 0 ? (
            <p className="text-[11px] text-neutral-400 pl-1">아직 읽은 멤버가 없습니다</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {readUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-[11px] text-neutral-700 dark:text-neutral-200"
                >
                  <Avatar user={u} size="xs" />
                  <span>{u.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1">
            <Clock className="h-3.5 w-3.5" />
            <span>안 읽음 ({unreadUsers.length})</span>
          </div>
          {unreadUsers.length === 0 ? (
            <p className="text-[11px] text-neutral-400 pl-1">모두 읽었습니다</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {unreadUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 text-[11px] text-neutral-700 dark:text-neutral-200"
                >
                  <Avatar user={u} size="xs" />
                  <span>{u.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
