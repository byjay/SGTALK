import { useMemo, useState } from 'react';
import { Forward, Search, Users, X } from 'lucide-react';
import { getRoomDisplayName } from '../../shared/logic';
import type { ChatRoom, User } from '../../types/client';
import { Avatar } from '../Avatar';

interface ForwardModalProps {
  messageCount: number;
  currentUser: User;
  rooms: ChatRoom[];
  users: User[];
  usersById: Record<string, User>;
  currentRoomId: string;
  onClose: () => void;
  onForward: (target: { targetRoomId?: string; targetUserId?: string }) => Promise<void>;
}

export function ForwardModal({
  messageCount,
  currentUser,
  rooms,
  users,
  usersById,
  currentRoomId,
  onClose,
  onForward,
}: ForwardModalProps) {
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const normalized = query.trim().toLowerCase();

  const targetRooms = useMemo(
    () =>
      rooms.filter((r) => {
        if (r.id === currentRoomId || !r.memberIds.includes(currentUser.id)) return false;
        if (!normalized) return true;
        return getRoomDisplayName(r, currentUser.id, usersById).toLowerCase().includes(normalized);
      }),
    [rooms, currentRoomId, currentUser.id, normalized, usersById],
  );

  const colleagues = useMemo(
    () =>
      users.filter((u) => {
        if (u.id === currentUser.id || u.role === 'bot') return false;
        if (!normalized) return true;
        return (
          u.name.toLowerCase().includes(normalized) ||
          u.department.toLowerCase().includes(normalized)
        );
      }),
    [users, currentUser.id, normalized],
  );

  const handlePick = async (target: { targetRoomId?: string; targetUserId?: string }) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onForward(target);
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
        aria-label="메시지 전달 대상 선택"
        className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Forward className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
            <h3 className="text-base font-bold text-neutral-900 dark:text-white">
              메시지 전달 ({messageCount}건)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="전달 모달 닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="전달할 채팅방 또는 동료 검색..."
              aria-label="전달 대상 검색"
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]"
            />
          </div>

          <div className="max-h-72 overflow-y-auto chat-scroll space-y-3">
            {targetRooms.length > 0 && (
              <div>
                <div className="px-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1">
                  참여 중인 채팅방
                </div>
                <div className="space-y-1">
                  {targetRooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      disabled={submitting}
                      onClick={() => handlePick({ targetRoomId: room.id })}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-[#07C160]/12 dark:hover:bg-[#07C160]/20 text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                          <Users className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
                        </div>
                        <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                          {getRoomDisplayName(room, currentUser.id, usersById)}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-[#008069] dark:text-[#07C160] shrink-0">
                        전달
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {colleagues.length > 0 && (
              <div>
                <div className="px-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1">
                  사내 동료 1:1 전달
                </div>
                <div className="space-y-1">
                  {colleagues.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      disabled={submitting}
                      onClick={() => handlePick({ targetUserId: u.id })}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-[#07C160]/12 dark:hover:bg-[#07C160]/20 text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar user={u} size="xs" showOnline />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                            {u.name} {u.position}
                          </div>
                          <div className="text-[11px] text-neutral-400 truncate">{u.department}</div>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-[#008069] dark:text-[#07C160] shrink-0">
                        1:1 전달
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {targetRooms.length === 0 && colleagues.length === 0 && (
              <p className="py-8 text-center text-xs text-neutral-400">
                검색 결과가 없습니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
