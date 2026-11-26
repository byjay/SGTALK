import { useMemo, useState } from 'react';
import {
  CalendarOff,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Search,
  UserPlus,
} from 'lucide-react';
import { isUserOnLeaveOnDate } from '../shared/logic';
import { PRESENCE_LABELS, type LeaveRequest, type PresenceStatus, type User } from '../types/client';
import { Avatar } from './Avatar';

interface FriendsDirectoryProps {
  currentUser: User;
  users: User[];
  leaves: LeaveRequest[];
  todayDate: string;
  onSelectUserProfile: (user: User) => void;
  onStartDirectChat: (userId: string) => void;
  onChangeMyPresence: (status: PresenceStatus) => void;
  onOpenNewChatModal: () => void;
}

const MY_STATUS_OPTIONS: PresenceStatus[] = ['online', 'meeting', 'away', 'out'];

export function FriendsDirectory({
  currentUser,
  users,
  leaves,
  todayDate,
  onSelectUserProfile,
  onStartDirectChat,
  onChangeMyPresence,
  onOpenNewChatModal,
}: FriendsDirectoryProps) {
  const [query, setQuery] = useState('');
  const [collapsedDepts, setCollapsedDepts] = useState<Record<string, boolean>>({});

  const colleagues = useMemo(
    () => users.filter((u) => u.id !== currentUser.id && u.role !== 'bot'),
    [users, currentUser.id],
  );

  const filteredColleagues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return colleagues;
    return colleagues.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        u.position.toLowerCase().includes(q) ||
        u.statusMessage.toLowerCase().includes(q),
    );
  }, [colleagues, query]);

  const onLeaveToday = useMemo(() => {
    return users
      .filter((u) => u.role !== 'bot')
      .map((u) => ({ user: u, leave: isUserOnLeaveOnDate(leaves, u.id, todayDate) }))
      .filter((entry): entry is { user: User; leave: LeaveRequest } => entry.leave !== null);
  }, [users, leaves, todayDate]);

  const groupedByDept = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const u of filteredColleagues) {
      const dept = u.department || '기타 부서';
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(u);
    }
    return Array.from(map.entries());
  }, [filteredColleagues]);

  const toggleDept = (dept: string) => {
    setCollapsedDepts((prev) => ({ ...prev, [dept]: !prev[dept] }));
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white">
            사내 접속자 · 조직도
          </h2>
          <button
            type="button"
            onClick={onOpenNewChatModal}
            aria-label="새 대화 시작"
            title="새 대화 시작"
            className="h-9 w-9 rounded-xl flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2.5">
          동료를 더블클릭하면 바로 1:1 대화가 열립니다
        </p>

        <div className="relative">
          <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름, 부서, 직급 검색"
            aria-label="동료 검색"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#07C160]"
          />
        </div>
      </div>

      {/* Directory List */}
      <div className="flex-1 overflow-y-auto chat-scroll px-2 py-2 space-y-3">
        {/* My Profile & Live Presence Switcher */}
        <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 space-y-2.5">
          <button
            type="button"
            onClick={() => onSelectUserProfile(currentUser)}
            className="w-full flex items-center gap-3 text-left cursor-pointer"
          >
            <Avatar
              user={currentUser}
              size="lg"
              showOnline
              onLeave={Boolean(isUserOnLeaveOnDate(leaves, currentUser.id, todayDate))}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-neutral-900 dark:text-white truncate">
                  {currentUser.name}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {currentUser.position} · {currentUser.department}
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                {currentUser.statusMessage || '상태 메시지를 설정해 보세요'}
              </p>
            </div>
          </button>

          <div className="grid grid-cols-4 gap-1 p-1 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200/70 dark:border-neutral-700">
            {MY_STATUS_OPTIONS.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onChangeMyPresence(st)}
                className={`py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  currentUser.presenceStatus === st
                    ? 'bg-[#008069] text-white font-bold'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {PRESENCE_LABELS[st]}
              </button>
            ))}
          </div>
        </div>

        {/* Today's Leave Section */}
        <div>
          <div className="px-2 py-1 flex items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1.5">
              <CalendarOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              오늘의 연차자
            </span>
            <span className="tabular-nums">{onLeaveToday.length}명</span>
          </div>
          {onLeaveToday.length === 0 ? (
            <p className="px-2 py-2 text-xs text-neutral-400 dark:text-neutral-500">
              오늘 연차 등록된 동료가 없습니다.
            </p>
          ) : (
            <div className="space-y-0.5 mt-1">
              {onLeaveToday.map(({ user, leave }) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelectUserProfile(user)}
                  onDoubleClick={() => onStartDirectChat(user.id)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-amber-50/70 dark:hover:bg-amber-950/20 transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar user={user} size="sm" onLeave />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                        {user.name} {user.position}
                      </div>
                      <div className="text-xs text-amber-700 dark:text-amber-400 truncate">
                        {leave.type} · {user.department}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-neutral-100 dark:border-neutral-800" />

        {/* Departments */}
        <div className="space-y-2">
          {groupedByDept.map(([dept, members]) => {
            const collapsed = Boolean(collapsedDepts[dept]);
            return (
              <div key={dept}>
                <button
                  type="button"
                  onClick={() => toggleDept(dept)}
                  className="w-full px-2 py-1 flex items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer"
                >
                  <span className="flex items-center gap-1">
                    {collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {dept}
                  </span>
                  <span className="tabular-nums">{members.length}</span>
                </button>

                {!collapsed && (
                  <div className="space-y-0.5 mt-0.5">
                    {members.map((member) => {
                      const leaveToday = isUserOnLeaveOnDate(leaves, member.id, todayDate);
                      const statusLabel = leaveToday
                        ? leaveToday.type
                        : PRESENCE_LABELS[member.presenceStatus ?? (member.online ? 'online' : 'offline')];
                      return (
                        <div
                          key={member.id}
                          onDoubleClick={() => onStartDirectChat(member.id)}
                          title="더블클릭으로 1:1 대화 시작"
                          className="group flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800/70 transition-colors select-none"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectUserProfile(member)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              onStartDirectChat(member.id);
                            }}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <Avatar
                              user={member}
                              size="md"
                              showOnline
                              onLeave={Boolean(leaveToday)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                                  {member.name}
                                </span>
                                <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">
                                  {member.position}
                                </span>
                                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
                                  · {statusLabel}
                                </span>
                              </div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                                {member.statusMessage || member.email}
                              </p>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => onStartDirectChat(member.id)}
                            aria-label={`${member.name}님과 1:1 채팅`}
                            title="1:1 채팅"
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-white dark:hover:bg-neutral-700 opacity-80 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                          >
                            <MessageSquarePlus className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {groupedByDept.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-neutral-400">
              검색 조건에 맞는 동료가 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
