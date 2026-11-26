import { useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  Bookmark,
  CheckCheck,
  LogOut,
  MessageSquarePlus,
  MoreVertical,
  Pin,
  PinOff,
  Search,
  Users,
} from 'lucide-react';
import { formatVoiceDuration, hasUnreadMentionForUser } from '../shared/chatLogic';
import {
  filterAndSortRooms,
  formatRoomListTime,
  getRoomDisplayName,
  getRoomUnreadCount,
  isUserOnLeaveOnDate,
  type RoomFilter,
} from '../shared/logic';
import {
  PRESENCE_LABELS,
  type ChatRoom,
  type LeaveRequest,
  type Message,
  type User,
} from '../types/client';
import { Avatar } from './Avatar';

interface ChatListPanelProps {
  currentUser: User;
  users: User[];
  usersById: Record<string, User>;
  rooms: ChatRoom[];
  messages: Message[];
  leaves: LeaveRequest[];
  todayDate: string;
  activeRoomId: string | null;
  draftsByRoom?: Record<string, string>;
  typingByRoom?: Record<string, string[]>;
  onSelectRoom: (roomId: string) => void;
  onStartDirectChat: (userId: string) => void;
  onOpenSelfChat?: () => void;
  onOpenNewChatModal: () => void;
  onTogglePinRoom?: (roomId: string) => void;
  onToggleMuteRoom?: (roomId: string) => void;
  onMarkRoomRead?: (roomId: string) => void;
  onMarkAllRoomsRead?: () => void;
  onLeaveRoom?: (roomId: string) => void;
}

const FILTER_OPTIONS: { id: RoomFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'unread', label: '안읽음' },
  { id: 'direct', label: '1:1' },
  { id: 'group', label: '그룹' },
];

export function ChatListPanel({
  currentUser,
  users,
  usersById,
  rooms,
  messages,
  leaves,
  todayDate,
  activeRoomId,
  draftsByRoom = {},
  typingByRoom = {},
  onSelectRoom,
  onStartDirectChat,
  onOpenSelfChat,
  onOpenNewChatModal,
  onTogglePinRoom,
  onToggleMuteRoom,
  onMarkRoomRead,
  onMarkAllRoomsRead,
  onLeaveRoom,
}: ChatListPanelProps) {
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [query, setQuery] = useState('');
  const [openMenuRoomId, setOpenMenuRoomId] = useState<string | null>(null);

  const totalUnreadCount = useMemo(
    () =>
      rooms.reduce(
        (acc, r) => acc + getRoomUnreadCount(messages, r.id, currentUser.id),
        0,
      ),
    [rooms, messages, currentUser.id],
  );

  const colleagues = useMemo(
    () => users.filter((u) => u.id !== currentUser.id && u.role !== 'bot'),
    [users, currentUser.id],
  );

  const lastMessageByRoom = useMemo(() => {
    const map: Record<string, Message> = {};
    for (const msg of messages) {
      const prev = map[msg.roomId];
      if (!prev || new Date(msg.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
        map[msg.roomId] = msg;
      }
    }
    return map;
  }, [messages]);

  const sortedRooms = useMemo(
    () => filterAndSortRooms(rooms, messages, currentUser.id, filter, query, usersById),
    [rooms, messages, currentUser.id, filter, query, usersById],
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-neutral-100 dark:border-neutral-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white">
            채팅
          </h2>
          <div className="flex items-center gap-1.5">
            {onMarkAllRoomsRead && totalUnreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRoomsRead}
                aria-label="전체 채팅방 모두 읽음 처리"
                title="안 읽은 메시지 모두 읽음 처리"
                className="h-9 px-2 rounded-xl flex items-center gap-1 text-xs font-semibold text-[#075E54] dark:text-[#07C160] bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>모두 읽음</span>
              </button>
            )}
            {onOpenSelfChat && (
              <button
                type="button"
                onClick={onOpenSelfChat}
                aria-label="나와의 채팅 열기"
                title="나와의 채팅 (개인 메모·파일 보관)"
                className="h-9 px-2.5 rounded-xl flex items-center gap-1 text-xs font-semibold text-[#1C2924] bg-[#FEE500] hover:bg-[#F5DC00] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span>나와의 채팅</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenNewChatModal}
              aria-label="새 채팅방 만들기"
              title="새 채팅방 만들기"
              className="h-9 px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-[#008069] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MessageSquarePlus className="h-4 w-4" />
              <span>새 채팅</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="채팅방 이름, 참여자 검색"
            aria-label="채팅방 검색"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#07C160]"
          />
        </div>

        {/* Segmented Filter Tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilter(opt.id)}
              className={`py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === opt.id
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Company Account Logged-In Status Strip (Double-Click to Chat) */}
      <div className="px-3 py-2.5 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/40">
        <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
          <span>회사 계정 상태 · 더블클릭 대화</span>
          <span className="tabular-nums">{colleagues.filter((c) => c.online).length}명 접속</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 chat-scroll">
          {colleagues.map((col) => {
            const leaveToday = isUserOnLeaveOnDate(leaves, col.id, todayDate);
            const statusText = leaveToday
              ? leaveToday.type
              : PRESENCE_LABELS[col.presenceStatus ?? (col.online ? 'online' : 'offline')];
            return (
              <button
                key={col.id}
                type="button"
                onDoubleClick={() => onStartDirectChat(col.id)}
                title={`${col.name} (${statusText}) · 더블클릭으로 1:1 대화`}
                aria-label={`${col.name} ${statusText} 더블클릭으로 대화`}
                className="shrink-0 w-14 flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-white dark:hover:bg-neutral-800 transition-colors cursor-pointer select-none"
              >
                <Avatar user={col} size="sm" showOnline onLeave={Boolean(leaveToday)} />
                <span className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200 truncate w-full text-center">
                  {col.name}
                </span>
                <span className="text-[10px] text-neutral-400 truncate w-full text-center">
                  {statusText}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Room List */}
      <div className="flex-1 overflow-y-auto chat-scroll p-2 space-y-0.5">
        {sortedRooms.map((room) => {
          const isActive = room.id === activeRoomId;
          const displayName = getRoomDisplayName(room, currentUser.id, usersById);
          const unreadCount = getRoomUnreadCount(messages, room.id, currentUser.id);
          const hasMention = hasUnreadMentionForUser(messages, room.id, currentUser.id);
          const lastMsg = lastMessageByRoom[room.id];
          const isPinned = room.pinnedByUserIds.includes(currentUser.id);
          const isMuted = room.mutedByUserIds.includes(currentUser.id);
          const draft = (draftsByRoom[room.id] ?? '').trim();
          const typingNames = (typingByRoom[room.id] ?? [])
            .filter((id) => id !== currentUser.id)
            .map((id) => usersById[id]?.name)
            .filter(Boolean);

          const peerUser =
            room.type === 'direct'
              ? usersById[room.memberIds.find((id) => id !== currentUser.id) ?? currentUser.id]
              : room.type === 'bot'
                ? usersById['u-bot']
                : room.type === 'self'
                  ? currentUser
                  : null;

          const humanMemberCount = room.memberIds.filter(
            (id) => usersById[id]?.role !== 'bot',
          ).length;

          return (
            <div key={room.id} className="relative group">
              <button
                type="button"
                onClick={() => {
                  setOpenMenuRoomId(null);
                  onSelectRoom(room.id);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 pr-8 rounded-xl text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#07C160]/12 dark:bg-[#07C160]/20'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/70'
                }`}
              >
                {peerUser ? (
                  <div className="relative shrink-0">
                    <Avatar user={peerUser} size="md" showOnline={room.type === 'direct'} />
                    {room.type === 'self' && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-[#FEE500] text-[#1C2924] text-[10px] font-extrabold flex items-center justify-center border-2 border-white dark:border-neutral-900">
                        나
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="h-11 w-11 rounded-[16px] bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-center shrink-0">
                    <Users className="h-5 w-5" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {room.type === 'self' && (
                        <span className="px-1.5 py-0.5 rounded bg-[#FEE500] text-[#1C2924] text-[10px] font-bold shrink-0">
                          나
                        </span>
                      )}
                      <span className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                        {displayName}
                      </span>
                      {room.type !== 'direct' && room.type !== 'self' && (
                        <span className="text-xs text-neutral-400 tabular-nums shrink-0">
                          {humanMemberCount}
                        </span>
                      )}
                      {isPinned && (
                        <Pin className="h-3 w-3 text-[#008069] dark:text-[#07C160] shrink-0" aria-label="상단 고정됨" />
                      )}
                      {isMuted && (
                        <BellOff className="h-3 w-3 text-neutral-400 shrink-0" aria-label="알림 꺼짐" />
                      )}
                    </div>
                    <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
                      {lastMsg ? formatRoomListTime(lastMsg.createdAt) : ''}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    {typingNames.length > 0 ? (
                      <p className="text-xs font-medium text-[#008069] dark:text-[#07C160] truncate">
                        {typingNames[0]}님이 입력 중...
                      </p>
                    ) : draft && !isActive ? (
                      <p className="text-xs text-neutral-600 dark:text-neutral-300 truncate">
                        <span className="font-bold text-rose-600 dark:text-rose-400 mr-1">
                          [임시저장]
                        </span>
                        {draft}
                      </p>
                    ) : (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                        {hasMention && (
                          <span className="font-bold text-[#008069] dark:text-[#07C160] mr-1">
                            [나를 멘션]
                          </span>
                        )}
                        {lastMsg
                          ? lastMsg.deleted
                            ? '삭제된 메시지입니다.'
                            : lastMsg.recalled
                              ? lastMsg.content
                              : lastMsg.viewOnce
                                ? '🔒 1회 열람 비밀 메시지'
                                : lastMsg.type === 'image'
                                  ? '사진을 보냈습니다.'
                                  : lastMsg.type === 'voice'
                                    ? `음성 메시지 ${formatVoiceDuration(lastMsg.voice?.durationSec ?? 3)}`
                                    : lastMsg.type === 'file'
                                      ? `파일: ${lastMsg.file?.filename ?? lastMsg.content}`
                                      : lastMsg.type === 'poll'
                                        ? `투표: ${lastMsg.poll?.question}`
                                        : lastMsg.content
                          : '대화를 시작해 보세요.'}
                      </p>
                    )}

                    {unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#FF4B4B] text-white text-[11px] font-bold flex items-center justify-center tabular-nums shrink-0">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Quick Room Menu Trigger */}
              {(onTogglePinRoom || onToggleMuteRoom || onMarkRoomRead || onLeaveRoom) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuRoomId((cur) => (cur === room.id ? null : room.id));
                  }}
                  aria-label={`${displayName} 방 옵션`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-700 cursor-pointer"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              )}

              {openMenuRoomId === room.id && (
                <div className="absolute right-2 top-11 z-30 w-40 p-1 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-xl space-y-0.5 text-xs">
                  {onTogglePinRoom && (
                    <button
                      type="button"
                      onClick={() => {
                        onTogglePinRoom(room.id);
                        setOpenMenuRoomId(null);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2 cursor-pointer"
                    >
                      {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      <span>{isPinned ? '고정 해제' : '상단 고정'}</span>
                    </button>
                  )}
                  {onToggleMuteRoom && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleMuteRoom(room.id);
                        setOpenMenuRoomId(null);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2 cursor-pointer"
                    >
                      {isMuted ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                      <span>{isMuted ? '알림 켜기' : '알림 끄기'}</span>
                    </button>
                  )}
                  {onMarkRoomRead && unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onMarkRoomRead(room.id);
                        setOpenMenuRoomId(null);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2 cursor-pointer"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      <span>모두 읽음 처리</span>
                    </button>
                  )}
                  {onLeaveRoom && room.type === 'group' && (
                    <button
                      type="button"
                      onClick={() => {
                        onLeaveRoom(room.id);
                        setOpenMenuRoomId(null);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center gap-2 cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>채팅방 나가기</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {sortedRooms.length === 0 && (
          <div className="py-10 px-4 text-center space-y-2">
            <p className="text-xs text-neutral-400">표시할 채팅방이 없습니다.</p>
            <button
              type="button"
              onClick={onOpenNewChatModal}
              className="px-3 py-1.5 rounded-lg bg-[#008069] text-white text-xs font-semibold cursor-pointer"
            >
              새 채팅 시작하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
