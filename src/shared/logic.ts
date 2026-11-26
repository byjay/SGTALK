import type {
  ChatRoom,
  LeaveAlertSummary,
  LeaveRequest,
  LeaveType,
  Message,
  User,
} from './types';

export type RoomFilter = 'all' | 'unread' | 'direct' | 'group';

export function calculateLeaveDays(
  type: LeaveType,
  startDate: string,
  endDate: string,
): { valid: boolean; days: number; error?: string } {
  if (!startDate || !endDate) {
    return { valid: false, days: 0, error: '시작일과 종료일을 선택해주세요.' };
  }

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false, days: 0, error: '올바른 날짜 형식이 아닙니다.' };
  }

  if (end.getTime() < start.getTime()) {
    return { valid: false, days: 0, error: '종료일은 시작일보다 빠를 수 없습니다.' };
  }

  if (type === '오전반차' || type === '오후반차') {
    if (startDate !== endDate) {
      return { valid: false, days: 0, error: '반차는 시작일과 종료일이 같아야 합니다.' };
    }
    return { valid: true, days: 0.5 };
  }

  let weekdays = 0;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      weekdays += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const totalCalendarDays =
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return {
    valid: true,
    days: weekdays > 0 ? weekdays : totalCalendarDays,
  };
}

export interface ParsedChatLeaveCommand {
  matched: boolean;
  type: LeaveType;
  startDate: string;
  endDate: string;
  substituteId: string | null;
  reason: string;
}

function addDaysIso(baseDate: string, offsetDays: number): string {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Parses natural Korean or slash-command chat leave registration requests such as:
 * - "/연차 내일 사유 병원방문"
 * - "/오전반차 2026-11-25 대행 이서연"
 * - "내일 연차 등록 개인일정"
 * - "11월 25일 오후반차 신청"
 */
export function parseChatLeaveCommand(
  rawText: string,
  todayDate: string,
  colleagues: User[],
): ParsedChatLeaveCommand {
  const text = rawText.trim();
  if (/^\/(내연차|연차조회|연차내역|과거연차|휴가기록|스케줄조회|내일정)/.test(text)) {
    return {
      matched: false,
      type: '연차',
      startDate: todayDate,
      endDate: todayDate,
      substituteId: null,
      reason: '',
    };
  }

  const hasSlashTrigger = /^\/(연차|오전반차|오후반차|반차|병가|공가)(?:\s|$)/.test(text);
  const hasLeaveKeyword = /(연차|오전반차|오후반차|반차|병가|공가|휴가)/.test(text);
  const hasExplicitRegAction = /(등록|신청|쓰겠|쓸게|올려|올릴게)/.test(text);
  const hasQueryOrPastIntent =
    /(조회|확인|보여|알려|몇\s*일|몇일|몇\s*개|얼마|남은|남았|잔여|내역|기록|이력|히스토리|스케줄|정보|현황|과거|지난\s*달|전달|지지난달|작년|최근|언제|누구)/.test(
      text,
    );

  // Lookup/balance/past-history questions must never accidentally open a new leave registration
  if (hasQueryOrPastIntent && !hasSlashTrigger && !hasExplicitRegAction) {
    return {
      matched: false,
      type: '연차',
      startDate: todayDate,
      endDate: todayDate,
      substituteId: null,
      reason: '',
    };
  }

  const hasActionKeyword =
    hasExplicitRegAction ||
    (/(사용|휴가)/.test(text) && !hasQueryOrPastIntent);

  if (!hasSlashTrigger && !(hasLeaveKeyword && hasActionKeyword)) {
    return {
      matched: false,
      type: '연차',
      startDate: todayDate,
      endDate: todayDate,
      substituteId: null,
      reason: '',
    };
  }

  let type: LeaveType = '연차';
  if (/오전\s*반차/.test(text)) type = '오전반차';
  else if (/오후\s*반차/.test(text)) type = '오후반차';
  else if (/반차/.test(text)) type = '오후반차';
  else if (/병가/.test(text)) type = '병가';
  else if (/공가/.test(text)) type = '공가';

  // Date extraction: YYYY-MM-DD range or single, MM/DD or M월 D일, 오늘/내일/모레
  let startDate = todayDate;
  let endDate = todayDate;

  const isoMatches = text.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoMatches && isoMatches.length >= 2) {
    startDate = isoMatches[0];
    endDate = isoMatches[1];
  } else if (isoMatches && isoMatches.length === 1) {
    startDate = isoMatches[0];
    endDate = isoMatches[0];
  } else {
    const korMatch = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (korMatch) {
      const year = todayDate.slice(0, 4);
      const month = String(Number(korMatch[1])).padStart(2, '0');
      const day = String(Number(korMatch[2])).padStart(2, '0');
      startDate = `${year}-${month}-${day}`;
      endDate = startDate;
    } else if (/모레/.test(text)) {
      startDate = addDaysIso(todayDate, 2);
      endDate = startDate;
    } else if (/내일/.test(text)) {
      startDate = addDaysIso(todayDate, 1);
      endDate = startDate;
    } else if (/오늘/.test(text)) {
      startDate = todayDate;
      endDate = todayDate;
    }
  }

  if (type === '오전반차' || type === '오후반차') {
    endDate = startDate;
  }

  // Substitute detection by colleague name
  let substituteId: string | null = null;
  for (const col of colleagues) {
    if (col.role === 'bot') continue;
    if (text.includes(col.name)) {
      substituteId = col.id;
      break;
    }
  }

  // Reason extraction
  let reason = '개인 사유';
  const reasonMatch = text.match(/(?:사유|이유)\s*[:：]?\s*(.+)$/);
  if (reasonMatch && reasonMatch[1].trim()) {
    reason = reasonMatch[1].trim();
  } else {
    const cleaned = text
      .replace(/^\/(연차|오전반차|오후반차|반차|병가|공가)/, '')
      .replace(/\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, '')
      .replace(/(오늘|내일|모레|연차|오전반차|오후반차|반차|병가|공가|등록|신청|해줘|할게|합니다|~)/g, '')
      .trim();
    if (cleaned.length >= 2) {
      reason = cleaned;
    }
  }

  return {
    matched: true,
    type,
    startDate,
    endDate,
    substituteId,
    reason,
  };
}

export function computeUnreadCount(
  message: Message,
  roomMemberIds: string[],
  usersById?: Record<string, User>,
): number {
  if (message.type === 'system' || message.deleted || message.recalled) {
    return 0;
  }

  const activeHumanMembers = roomMemberIds.filter((id) => {
    if (!usersById) return true;
    const member = usersById[id];
    return !member || member.role !== 'bot';
  });

  const readSet = new Set(message.readBy);
  let unread = 0;
  for (const memberId of activeHumanMembers) {
    if (!readSet.has(memberId)) {
      unread += 1;
    }
  }
  return Math.max(0, unread);
}

export function getRoomUnreadCount(
  messages: Message[],
  roomId: string,
  userId: string,
): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.roomId !== roomId) continue;
    if (msg.type === 'system' || msg.recalled) continue;
    if (!msg.readBy.includes(userId)) {
      count += 1;
    }
  }
  return count;
}

export interface DecoratedMessage {
  message: Message;
  dateHeader: string | null;
  showSenderHeader: boolean;
  showTimestamp: boolean;
}

function toMinuteKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

export function toDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function formatKoreanDateHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdays[d.getDay()]}`;
}

export function formatKoreanTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const period = hours < 12 ? '오전' : '오후';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${period} ${displayHour}:${minutes}`;
}

export function formatRoomListTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (toDateKey(iso) === toDateKey(now.toISOString())) {
    return formatKoreanTime(iso);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (toDateKey(iso) === toDateKey(yesterday.toISOString())) {
    return '어제';
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function groupMessagesByDateAndSender(messages: Message[]): DecoratedMessage[] {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return sorted.map((msg, idx) => {
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

    const currentDateKey = toDateKey(msg.createdAt);
    const prevDateKey = prev ? toDateKey(prev.createdAt) : null;
    const nextDateKey = next ? toDateKey(next.createdAt) : null;

    const dateHeader = currentDateKey !== prevDateKey ? formatKoreanDateHeader(msg.createdAt) : null;

    const sameAsPrev =
      prev !== null &&
      prev.senderId === msg.senderId &&
      prev.type !== 'system' &&
      msg.type !== 'system' &&
      !prev.recalled &&
      !msg.recalled &&
      currentDateKey === prevDateKey &&
      toMinuteKey(prev.createdAt) === toMinuteKey(msg.createdAt);

    const sameAsNext =
      next !== null &&
      next.senderId === msg.senderId &&
      next.type !== 'system' &&
      msg.type !== 'system' &&
      !next.recalled &&
      !msg.recalled &&
      currentDateKey === nextDateKey &&
      toMinuteKey(next.createdAt) === toMinuteKey(msg.createdAt);

    return {
      message: msg,
      dateHeader,
      showSenderHeader: msg.type !== 'system' && !msg.recalled && !sameAsPrev,
      showTimestamp: msg.type !== 'system' && !msg.recalled && !sameAsNext,
    };
  });
}

export function getRoomDisplayName(
  room: ChatRoom,
  currentUserId: string,
  usersById: Record<string, User>,
): string {
  if (room.type === 'self') {
    return '나와의 채팅';
  }
  if (room.type === 'direct') {
    const peerId = room.memberIds.find((id) => id !== currentUserId) ?? currentUserId;
    return usersById[peerId]?.name ?? room.name;
  }
  return room.name;
}

export function filterAndSortRooms(
  rooms: ChatRoom[],
  messages: Message[],
  currentUserId: string,
  filter: RoomFilter,
  query: string,
  usersById: Record<string, User>,
): ChatRoom[] {
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = rooms.filter((room) => {
    if (!room.memberIds.includes(currentUserId)) return false;

    if (filter === 'unread' && getRoomUnreadCount(messages, room.id, currentUserId) === 0) {
      return false;
    }
    if (filter === 'direct' && room.type !== 'direct') {
      return false;
    }
    if (filter === 'group' && room.type === 'direct') {
      return false;
    }

    if (!normalizedQuery) return true;

    const displayName = getRoomDisplayName(room, currentUserId, usersById).toLowerCase();
    if (displayName.includes(normalizedQuery)) return true;

    return room.memberIds.some((id) => {
      const u = usersById[id];
      return (
        u &&
        (u.name.toLowerCase().includes(normalizedQuery) ||
          u.department.toLowerCase().includes(normalizedQuery))
      );
    });
  });

  return filtered.sort((a, b) => {
    const aPinned = a.pinnedByUserIds.includes(currentUserId) ? 1 : 0;
    const bPinned = b.pinnedByUserIds.includes(currentUserId) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function toggleReactionMap(
  reactions: Record<string, string[]>,
  emoji: string,
  userId: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [key, users] of Object.entries(reactions)) {
    next[key] = [...users];
  }
  const existing = next[emoji] ?? [];
  if (existing.includes(userId)) {
    const filtered = existing.filter((id) => id !== userId);
    if (filtered.length === 0) {
      delete next[emoji];
    } else {
      next[emoji] = filtered;
    }
  } else {
    next[emoji] = [...existing, userId];
  }
  return next;
}

export function buildLeaveBroadcastSummary(
  user: User,
  leave: LeaveRequest,
  substituteUser: User | null,
): LeaveAlertSummary {
  return {
    leaveId: leave.id,
    userId: user.id,
    userName: user.name,
    department: user.department,
    position: user.position,
    leaveType: leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    daysCount: leave.daysCount,
    substituteName: substituteUser ? `${substituteUser.name} ${substituteUser.position}` : '지정 안 함',
    reason: leave.reason || '개인 사유',
  };
}

export function formatLeaveNotificationText(summary: LeaveAlertSummary): {
  title: string;
  body: string;
} {
  const dateText =
    summary.startDate === summary.endDate
      ? summary.startDate
      : `${summary.startDate} ~ ${summary.endDate}`;

  return {
    title: `[연차 알림] ${summary.userName} ${summary.position} (${summary.department})`,
    body: `${summary.leaveType} · ${dateText} (${summary.daysCount}일) · 업무대행: ${summary.substituteName}`,
  };
}

export function isUserOnLeaveOnDate(leaves: LeaveRequest[], userId: string, targetDate: string): LeaveRequest | null {
  return (
    leaves.find(
      (l) =>
        l.userId === userId &&
        l.startDate <= targetDate &&
        l.endDate >= targetDate,
    ) ?? null
  );
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  if (gb < 1024) return `${gb.toFixed(1)} GB`;
  const tb = gb / 1024;
  return `${tb.toFixed(2)} TB`;
}

export interface LeaveTypeBreakdownItem {
  type: LeaveType;
  count: number;
  days: number;
}

export interface UserLeaveSummary {
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  usagePercent: number;
  myLeaves: LeaveRequest[];
  pastLeaves: LeaveRequest[];
  activeTodayLeaves: LeaveRequest[];
  upcomingLeaves: LeaveRequest[];
  byType: LeaveTypeBreakdownItem[];
}

export function getUserLeaveSummary(
  user: User,
  leaves: LeaveRequest[],
  todayDate: string,
): UserLeaveSummary {
  const myLeaves = leaves
    .filter((l) => l.userId === user.id)
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
      return b.createdAt.localeCompare(a.createdAt);
    });

  const pastLeaves = myLeaves.filter((l) => l.endDate < todayDate);
  const activeTodayLeaves = myLeaves.filter(
    (l) => l.startDate <= todayDate && l.endDate >= todayDate,
  );
  const upcomingLeaves = myLeaves.filter((l) => l.startDate > todayDate);

  const types: LeaveType[] = ['연차', '오전반차', '오후반차', '병가', '공가'];
  const byType: LeaveTypeBreakdownItem[] = types.map((type) => {
    const items = myLeaves.filter((l) => l.type === type);
    const days = Number(items.reduce((sum, item) => sum + item.daysCount, 0).toFixed(1));
    return { type, count: items.length, days };
  });

  const totalDays = user.totalLeaveDays;
  const usedDays = user.usedLeaveDays;
  const remainingDays = Math.max(0, Number((totalDays - usedDays).toFixed(1)));
  const usagePercent =
    totalDays > 0 ? Math.min(100, Math.round((usedDays / totalDays) * 100)) : 0;

  return {
    totalDays,
    usedDays,
    remainingDays,
    usagePercent,
    myLeaves,
    pastLeaves,
    activeTodayLeaves,
    upcomingLeaves,
    byType,
  };
}

function shiftYearMonth(year: number, month: number, deltaMonths: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth };
}

function getMonthDateRange(year: number, month: number): { startDate: string; endDate: string; ym: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    ym: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export type LeaveQueryIntent = 'balance' | 'history' | 'schedule';
export type LeaveQueryScope = 'mine' | 'all' | 'person';

export interface ParsedLeaveHistoryQuery {
  matched: boolean;
  rawText: string;
  intent: LeaveQueryIntent;
  scope: LeaveQueryScope;
  targetUserId: string | null;
  targetUserName: string | null;
  periodLabel: string;
  fromDate: string | null;
  toDate: string | null;
  focusYearMonth: string | null;
  leaveTypeFilter: LeaveType | '반차' | null;
  keyword: string | null;
}

export function parseLeaveHistoryQuery(
  rawText: string,
  todayDate: string,
  currentUser: User,
  users: User[],
  options?: { forceConversationMode?: boolean },
): ParsedLeaveHistoryQuery {
  const text = rawText.trim();
  const empty: ParsedLeaveHistoryQuery = {
    matched: false,
    rawText: text,
    intent: 'history',
    scope: 'mine',
    targetUserId: currentUser.id,
    targetUserName: currentUser.name,
    periodLabel: '전체 기간',
    fromDate: null,
    toDate: null,
    focusYearMonth: null,
    leaveTypeFilter: null,
    keyword: null,
  };
  if (!text) return empty;

  const isExplicitQuerySlash = /^\/(내연차|연차조회|연차내역|과거연차|휴가기록|스케줄조회|내일정)(?:\s|$)/.test(
    text,
  );
  const isLeaveRegSlash = /^\/(연차|오전반차|오후반차|반차|병가|공가)(?:\s|$)/.test(text);
  const hasExplicitRegAction = /(등록|신청|쓰겠|쓸게|올려|올릴게)/.test(text);
  if (isLeaveRegSlash || (hasExplicitRegAction && !isExplicitQuerySlash)) {
    return empty;
  }

  const hasLeaveOrScheduleDomain =
    isExplicitQuerySlash ||
    /(연차|반차|오전반차|오후반차|병가|공가|휴가|스케줄|일정|휴무)/.test(text);
  const hasQuerySignal =
    isExplicitQuerySlash ||
    /(조회|확인|보여|알려|몇\s*일|몇일|몇\s*개|얼마|남은|남았|잔여|사용|내역|기록|이력|히스토리|과거|지난\s*달|전달|지지난달|이번\s*달|다음\s*달|작년|올해|최근|언제|누구|정보|현황|요약)/.test(
      text,
    );

  if (!options?.forceConversationMode) {
    if (!hasLeaveOrScheduleDomain || !hasQuerySignal) {
      return empty;
    }
    // Avoid hijacking project calendar menu commands when not asking about leave/past history
    if (/프로젝트\s*달력/.test(text) && !/(연차|휴가|과거|기록|내역|반차)/.test(text)) {
      return empty;
    }
  }

  // 1. Target scope (specific colleague vs company-wide vs mine)
  let scope: LeaveQueryScope = 'mine';
  let targetUserId: string | null = currentUser.id;
  let targetUserName: string | null = currentUser.name;

  const humanUsers = users.filter((u) => u.role !== 'bot');
  const matchedPerson = humanUsers.find(
    (u) => u.id !== currentUser.id && text.includes(u.name),
  );
  if (matchedPerson) {
    scope = 'person';
    targetUserId = matchedPerson.id;
    targetUserName = matchedPerson.name;
  } else if (/(전사|전체\s*직원|팀원|모두|동료|누구|회사\s*전체)/.test(text) && !/(내\s*연차|본인)/.test(text)) {
    scope = 'all';
    targetUserId = null;
    targetUserName = '전사 임직원';
  }

  // 2. Period & date range extraction
  const baseYear = Number(todayDate.slice(0, 4)) || 2026;
  const baseMonth = Number(todayDate.slice(5, 7)) || 11;
  let fromDate: string | null = null;
  let toDate: string | null = null;
  let periodLabel = '전체 기간';
  let focusYearMonth: string | null = null;

  const isoDates = text.match(/\d{4}-\d{2}-\d{2}/g);
  const ymMatch = text.match(/(\d{4})[-./년\s]+(\d{1,2})\s*월?/);
  const monthOnlyMatch = text.match(/(?:^|\s|작년\s*|올해\s*|지난\s*)(\d{1,2})\s*월/);
  const recentMonthsMatch = text.match(/최근\s*(\d{1,2})\s*개?월/);

  if (isoDates && isoDates.length >= 2) {
    fromDate = isoDates[0] <= isoDates[1] ? isoDates[0] : isoDates[1];
    toDate = isoDates[0] <= isoDates[1] ? isoDates[1] : isoDates[0];
    periodLabel = `${fromDate} ~ ${toDate}`;
    focusYearMonth = fromDate.slice(0, 7);
  } else if (isoDates && isoDates.length === 1) {
    fromDate = isoDates[0];
    toDate = isoDates[0];
    periodLabel = isoDates[0];
    focusYearMonth = isoDates[0].slice(0, 7);
  } else if (/어제/.test(text)) {
    const yesterday = addDaysIso(todayDate, -1);
    fromDate = yesterday;
    toDate = yesterday;
    periodLabel = `어제 (${yesterday})`;
    focusYearMonth = yesterday.slice(0, 7);
  } else if (/오늘/.test(text)) {
    fromDate = todayDate;
    toDate = todayDate;
    periodLabel = `오늘 (${todayDate})`;
    focusYearMonth = todayDate.slice(0, 7);
  } else if (/지지난\s*달|2\s*개?월\s*전/.test(text)) {
    const shifted = shiftYearMonth(baseYear, baseMonth, -2);
    const range = getMonthDateRange(shifted.year, shifted.month);
    fromDate = range.startDate;
    toDate = range.endDate;
    focusYearMonth = range.ym;
    periodLabel = `지지난달 (${shifted.year}년 ${shifted.month}월)`;
  } else if (/지난\s*달|전\s*달/.test(text)) {
    const shifted = shiftYearMonth(baseYear, baseMonth, -1);
    const range = getMonthDateRange(shifted.year, shifted.month);
    fromDate = range.startDate;
    toDate = range.endDate;
    focusYearMonth = range.ym;
    periodLabel = `지난달 (${shifted.year}년 ${shifted.month}월)`;
  } else if (/이번\s*달|금월/.test(text)) {
    const range = getMonthDateRange(baseYear, baseMonth);
    fromDate = range.startDate;
    toDate = range.endDate;
    focusYearMonth = range.ym;
    periodLabel = `이번달 (${baseYear}년 ${baseMonth}월)`;
  } else if (/다음\s*달|내월/.test(text)) {
    const shifted = shiftYearMonth(baseYear, baseMonth, 1);
    const range = getMonthDateRange(shifted.year, shifted.month);
    fromDate = range.startDate;
    toDate = range.endDate;
    focusYearMonth = range.ym;
    periodLabel = `다음달 (${shifted.year}년 ${shifted.month}월)`;
  } else if (recentMonthsMatch) {
    const n = Math.max(1, Math.min(24, Number(recentMonthsMatch[1])));
    const shifted = shiftYearMonth(baseYear, baseMonth, -(n - 1));
    const startRange = getMonthDateRange(shifted.year, shifted.month);
    fromDate = startRange.startDate;
    toDate = todayDate;
    focusYearMonth = `${baseYear}-${String(baseMonth).padStart(2, '0')}`;
    periodLabel = `최근 ${n}개월 (${startRange.startDate} ~ ${todayDate})`;
  } else if (ymMatch) {
    const y = Number(ymMatch[1]);
    const m = Math.max(1, Math.min(12, Number(ymMatch[2])));
    const range = getMonthDateRange(y, m);
    fromDate = range.startDate;
    toDate = range.endDate;
    focusYearMonth = range.ym;
    periodLabel = `${y}년 ${m}월`;
  } else if (monthOnlyMatch) {
    const m = Math.max(1, Math.min(12, Number(monthOnlyMatch[1])));
    const y = /작년/.test(text) ? baseYear - 1 : baseYear;
    const range = getMonthDateRange(y, m);
    fromDate = range.startDate;
    toDate = range.endDate;
    focusYearMonth = range.ym;
    periodLabel = `${y}년 ${m}월`;
  } else if (/작년/.test(text)) {
    const y = baseYear - 1;
    fromDate = `${y}-01-01`;
    toDate = `${y}-12-31`;
    focusYearMonth = `${y}-12`;
    periodLabel = `작년 (${y}년)`;
  } else if (/올해|금년/.test(text)) {
    fromDate = `${baseYear}-01-01`;
    toDate = /과거|지난/.test(text) ? addDaysIso(todayDate, -1) : `${baseYear}-12-31`;
    periodLabel = /과거|지난/.test(text) ? `${baseYear}년 과거 기록` : `${baseYear}년 전체`;
  } else if (/(과거|이전|예전)/.test(text)) {
    toDate = addDaysIso(todayDate, -1);
    periodLabel = `과거 전체 (~ ${toDate})`;
  } else if (/(기록|내역|이력|히스토리)/.test(text) && !/(전체|모두|예정|앞으로)/.test(text)) {
    toDate = addDaysIso(todayDate, -1);
    periodLabel = `과거 사용 기록 (~ ${toDate})`;
  }

  // 3. Specific leave type filter (only narrow when non-generic or explicit "반차/병가/공가")
  let leaveTypeFilter: LeaveType | '반차' | null = null;
  if (/오전\s*반차/.test(text)) leaveTypeFilter = '오전반차';
  else if (/오후\s*반차/.test(text)) leaveTypeFilter = '오후반차';
  else if (/반차/.test(text)) leaveTypeFilter = '반차';
  else if (/병가/.test(text)) leaveTypeFilter = '병가';
  else if (/공가/.test(text)) leaveTypeFilter = '공가';

  // 4. Intent detection
  let intent: LeaveQueryIntent = 'history';
  const asksBalance =
    /(남은|남았|잔여|몇\s*일|몇일|몇\s*개|얼마|연차\s*정보|연차\s*현황|내\s*연차\s*요약|^\/?내연차$)/.test(
      text,
    );
  const asksPastOrMonth = Boolean(fromDate || toDate || /(기록|내역|이력|과거|지난)/.test(text));
  if (asksBalance && !asksPastOrMonth) {
    intent = 'balance';
  } else if (/(스케줄|일정|달력|오늘|전사)/.test(text) && !/(과거|기록|내역)/.test(text)) {
    intent = 'schedule';
  }

  // 5. Optional free-text keyword when user runs a keyword search inside Schedule Assistant
  let keyword: string | null = null;
  if (options?.forceConversationMode && !asksBalance && !fromDate && !toDate && !leaveTypeFilter && scope === 'mine') {
    const cleaned = text
      .replace(/(연차|휴가|스케줄|일정|기록|내역|조회|보여줘|찾아줘|알려줘|검색|내|전체|전사)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 2) {
      keyword = cleaned;
      scope = 'all';
      targetUserId = null;
      targetUserName = '전사 검색';
      periodLabel = `"${cleaned}" 포함 전체`;
    }
  }

  return {
    matched: true,
    rawText: text,
    intent,
    scope,
    targetUserId,
    targetUserName,
    periodLabel,
    fromDate,
    toDate,
    focusYearMonth,
    leaveTypeFilter,
    keyword,
  };
}

export interface LeaveHistoryQueryResult {
  query: ParsedLeaveHistoryQuery;
  matchedLeaves: LeaveRequest[];
  totalMatchedDays: number;
  summaryText: string;
  balanceSummary: UserLeaveSummary;
}

export function executeLeaveHistoryQuery(
  rawText: string,
  leaves: LeaveRequest[],
  users: User[],
  currentUser: User,
  todayDate: string,
  options?: { forceConversationMode?: boolean },
): LeaveHistoryQueryResult {
  const query = parseLeaveHistoryQuery(rawText, todayDate, currentUser, users, options);
  const balanceSummary = getUserLeaveSummary(currentUser, leaves, todayDate);
  const usersById: Record<string, User> = {};
  for (const u of users) usersById[u.id] = u;

  if (!query.matched) {
    return {
      query,
      matchedLeaves: [],
      totalMatchedDays: 0,
      summaryText: '',
      balanceSummary,
    };
  }

  const filtered = leaves
    .filter((l) => {
      if (query.scope === 'mine' && l.userId !== currentUser.id) return false;
      if (query.scope === 'person' && query.targetUserId && l.userId !== query.targetUserId) {
        return false;
      }
      if (query.fromDate && l.endDate < query.fromDate) return false;
      if (query.toDate && l.startDate > query.toDate) return false;
      if (query.leaveTypeFilter === '반차') {
        if (l.type !== '오전반차' && l.type !== '오후반차') return false;
      } else if (query.leaveTypeFilter && l.type !== query.leaveTypeFilter) {
        return false;
      }
      if (query.keyword) {
        const kw = query.keyword.toLowerCase();
        const ownerName = usersById[l.userId]?.name?.toLowerCase() ?? '';
        const dept = usersById[l.userId]?.department?.toLowerCase() ?? '';
        if (
          !l.reason.toLowerCase().includes(kw) &&
          !l.type.toLowerCase().includes(kw) &&
          !ownerName.includes(kw) &&
          !dept.includes(kw)
        ) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
      return b.createdAt.localeCompare(a.createdAt);
    });

  const totalMatchedDays = Number(
    filtered.reduce((sum, item) => sum + item.daysCount, 0).toFixed(1),
  );

  const lines: string[] = [];
  if (query.scope === 'mine' || query.intent === 'balance') {
    lines.push(
      `📅 ${currentUser.name} ${currentUser.position} 내 연차 정보: 잔여 ${balanceSummary.remainingDays}일 (총 ${balanceSummary.totalDays}일 중 ${balanceSummary.usedDays}일 사용 · ${balanceSummary.usagePercent}%)`,
    );
  } else if (query.scope === 'person' && query.targetUserId && usersById[query.targetUserId]) {
    const target = usersById[query.targetUserId];
    const rem = Math.max(0, Number((target.totalLeaveDays - target.usedLeaveDays).toFixed(1)));
    lines.push(
      `👤 ${target.name} ${target.position}(${target.department}) 연차 현황: 잔여 ${rem}일 / 사용 ${target.usedLeaveDays}일`,
    );
  }

  const scopeTitle =
    query.scope === 'mine'
      ? '내 일정'
      : query.scope === 'person'
        ? `${query.targetUserName ?? '동료'} 일정`
        : '전사 일정';

  lines.push(
    `🔎 [${scopeTitle} · ${query.periodLabel}] 조회 결과 ${filtered.length}건 (총 ${totalMatchedDays}일)`,
  );

  if (filtered.length === 0) {
    lines.push('해당 조건과 기간에 등록된 연차·휴가 기록이 없습니다.');
  } else {
    for (const item of filtered.slice(0, 6)) {
      const owner = usersById[item.userId];
      const sub = item.substituteId ? usersById[item.substituteId] : null;
      const dateStr =
        item.startDate === item.endDate
          ? item.startDate
          : `${item.startDate}~${item.endDate}`;
      const statusTag =
        item.endDate < todayDate ? '사용완료' : item.startDate <= todayDate ? '오늘휴무' : '예정';
      const ownerTag = query.scope === 'all' ? `${owner?.name ?? '사원'} · ` : '';
      lines.push(
        `• [${statusTag}] ${ownerTag}${dateStr} ${item.type}(${item.daysCount}일) — ${item.reason || '개인 사유'}${
          sub ? ` (대행: ${sub.name})` : ''
        }`,
      );
    }
    if (filtered.length > 6) {
      lines.push(`…외 ${filtered.length - 6}건이 더 있습니다.`);
    }
  }

  return {
    query,
    matchedLeaves: filtered,
    totalMatchedDays,
    summaryText: lines.join('\n'),
    balanceSummary,
  };
}

export interface MonthlyCalendarCell {
  date: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  leaves: LeaveRequest[];
}

export interface MonthlyLeaveCalendar {
  year: number;
  month: number;
  yearMonth: string;
  label: string;
  cells: MonthlyCalendarCell[];
}

export function buildMonthlyLeaveCalendar(
  year: number,
  month: number,
  leaves: LeaveRequest[],
  todayDate: string,
  filterUserId?: string | null,
): MonthlyLeaveCalendar {
  const safeMonth = Math.max(1, Math.min(12, month));
  const mm = String(safeMonth).padStart(2, '0');
  const firstOfMonth = new Date(Date.UTC(year, safeMonth - 1, 1));
  const startDayOfWeek = firstOfMonth.getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const totalCells = Math.ceil((startDayOfWeek + daysInMonth) / 7) * 7;

  const scopedLeaves = filterUserId
    ? leaves.filter((l) => l.userId === filterUserId)
    : leaves;

  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(1 - startDayOfWeek);

  const cells: MonthlyCalendarCell[] = [];
  for (let i = 0; i < totalCells; i += 1) {
    const cur = new Date(gridStart);
    cur.setUTCDate(gridStart.getUTCDate() + i);
    const iso = cur.toISOString().slice(0, 10);
    const cellYear = cur.getUTCFullYear();
    const cellMonth = cur.getUTCMonth() + 1;
    const cellDay = cur.getUTCDate();
    const dow = cur.getUTCDay();

    const dayLeaves = scopedLeaves.filter(
      (l) => l.startDate <= iso && l.endDate >= iso,
    );

    cells.push({
      date: iso,
      day: cellDay,
      inCurrentMonth: cellYear === year && cellMonth === safeMonth,
      isToday: iso === todayDate,
      isWeekend: dow === 0 || dow === 6,
      leaves: dayLeaves,
    });
  }

  return {
    year,
    month: safeMonth,
    yearMonth: `${year}-${mm}`,
    label: `${year}년 ${safeMonth}월`,
    cells,
  };
}

export interface MonthlyLeaveHistoryBucket {
  yearMonth: string;
  label: string;
  fullLabel: string;
  totalDays: number;
  recordCount: number;
  연차: number;
  오전반차: number;
  오후반차: number;
  병가: number;
  공가: number;
}

export interface LeaveHistoryChartResult {
  buckets: MonthlyLeaveHistoryBucket[];
  matchedLeaves: LeaveRequest[];
  totalPastDays: number;
  totalPastRecords: number;
  activeMonthsCount: number;
  averageDaysPerMonth: number;
  peakMonth: { yearMonth: string; fullLabel: string; totalDays: number } | null;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function allocateLeaveDaysByMonth(leave: LeaveRequest): Record<string, number> {
  const startYm = leave.startDate.slice(0, 7);
  const endYm = leave.endDate.slice(0, 7);
  if (startYm === endYm) {
    return { [startYm]: leave.daysCount };
  }

  const start = new Date(`${leave.startDate}T00:00:00Z`);
  const end = new Date(`${leave.endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { [startYm]: leave.daysCount };
  }

  const weekdayCounts: Record<string, number> = {};
  const calendarCounts: Record<string, number> = {};
  let totalWeekdays = 0;
  let totalCalendar = 0;

  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const ym = cursor.toISOString().slice(0, 7);
    const dow = cursor.getUTCDay();
    calendarCounts[ym] = (calendarCounts[ym] ?? 0) + 1;
    totalCalendar += 1;
    if (dow !== 0 && dow !== 6) {
      weekdayCounts[ym] = (weekdayCounts[ym] ?? 0) + 1;
      totalWeekdays += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const weights = totalWeekdays > 0 ? weekdayCounts : calendarCounts;
  const totalWeight = totalWeekdays > 0 ? totalWeekdays : totalCalendar;
  const out: Record<string, number> = {};
  for (const [ym, count] of Object.entries(weights)) {
    out[ym] = roundToTenth((leave.daysCount * count) / totalWeight);
  }
  return out;
}

export function buildMonthlyLeaveHistoryChartData(
  leaves: LeaveRequest[],
  todayDate: string,
  options?: {
    userId?: string | null;
    monthsBack?: number;
  },
): LeaveHistoryChartResult {
  const monthsBack = Math.max(1, Math.min(24, options?.monthsBack ?? 6));
  const baseYear = Number(todayDate.slice(0, 4)) || 2026;
  const baseMonth = Number(todayDate.slice(5, 7)) || 11;

  const buckets: MonthlyLeaveHistoryBucket[] = [];
  const bucketMap = new Map<string, MonthlyLeaveHistoryBucket>();
  const spansYearBoundary = baseMonth - (monthsBack - 1) <= 0;

  for (let offset = -(monthsBack - 1); offset <= 0; offset += 1) {
    const { year, month } = shiftYearMonth(baseYear, baseMonth, offset);
    const mm = String(month).padStart(2, '0');
    const yearMonth = `${year}-${mm}`;
    const label = spansYearBoundary ? `${String(year).slice(2)}.${month}월` : `${month}월`;
    const bucket: MonthlyLeaveHistoryBucket = {
      yearMonth,
      label,
      fullLabel: `${year}년 ${month}월`,
      totalDays: 0,
      recordCount: 0,
      연차: 0,
      오전반차: 0,
      오후반차: 0,
      병가: 0,
      공가: 0,
    };
    buckets.push(bucket);
    bucketMap.set(yearMonth, bucket);
  }

  const windowStartYm = buckets[0]?.yearMonth ?? '';
  const windowEndYm = buckets[buckets.length - 1]?.yearMonth ?? '';

  const pastLeaves = leaves
    .filter((l) => {
      if (options?.userId && l.userId !== options.userId) return false;
      return l.endDate < todayDate;
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
      return b.createdAt.localeCompare(a.createdAt);
    });

  const matchedLeaves: LeaveRequest[] = [];

  for (const leave of pastLeaves) {
    const perMonth = allocateLeaveDaysByMonth(leave);
    let overlapsWindow = false;
    for (const [ym, days] of Object.entries(perMonth)) {
      if (ym < windowStartYm || ym > windowEndYm) continue;
      const bucket = bucketMap.get(ym);
      if (!bucket) continue;
      overlapsWindow = true;
      bucket.totalDays = roundToTenth(bucket.totalDays + days);
      bucket.recordCount += 1;
      bucket[leave.type] = roundToTenth(bucket[leave.type] + days);
    }
    if (overlapsWindow) {
      matchedLeaves.push(leave);
    }
  }

  const totalPastDays = roundToTenth(
    buckets.reduce((sum, b) => sum + b.totalDays, 0),
  );
  const totalPastRecords = matchedLeaves.length;
  const activeMonthsCount = buckets.filter((b) => b.totalDays > 0).length;
  const averageDaysPerMonth = roundToTenth(totalPastDays / buckets.length);

  let peakMonth: LeaveHistoryChartResult['peakMonth'] = null;
  for (const b of buckets) {
    if (b.totalDays > 0 && (!peakMonth || b.totalDays > peakMonth.totalDays)) {
      peakMonth = {
        yearMonth: b.yearMonth,
        fullLabel: b.fullLabel,
        totalDays: b.totalDays,
      };
    }
  }

  return {
    buckets,
    matchedLeaves,
    totalPastDays,
    totalPastRecords,
    activeMonthsCount,
    averageDaysPerMonth,
    peakMonth,
  };
}
