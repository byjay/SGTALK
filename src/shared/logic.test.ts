import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyLeaveCalendar,
  buildMonthlyLeaveHistoryChartData,
  calculateLeaveDays,
  computeUnreadCount,
  executeLeaveHistoryQuery,
  filterAndSortRooms,
  formatFileSize,
  formatLeaveNotificationText,
  getUserLeaveSummary,
  groupMessagesByDateAndSender,
  isUserOnLeaveOnDate,
  parseChatLeaveCommand,
  parseLeaveHistoryQuery,
  toggleReactionMap,
} from './logic';
import type { ChatRoom, LeaveRequest, Message, User } from './types';

const mockUsers: Record<string, User> = {
  u1: {
    id: 'u1',
    name: '김민준',
    email: 'minjun@worktalk.co.kr',
    department: '프로덕트 개발팀',
    position: '팀장',
    phone: '010-1111-2222',
    avatarUrl: '',
    statusMessage: '개발 중',
    presenceStatus: 'online',
    role: 'admin',
    totalLeaveDays: 15,
    usedLeaveDays: 2,
    online: true,
    lastSeen: '2026-11-21T05:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  u2: {
    id: 'u2',
    name: '이서연',
    email: 'seoyeon@worktalk.co.kr',
    department: 'UX 디자인팀',
    position: '선임',
    phone: '010-2222-3333',
    avatarUrl: '',
    statusMessage: '',
    presenceStatus: 'away',
    role: 'member',
    totalLeaveDays: 15,
    usedLeaveDays: 1,
    online: false,
    lastSeen: '2026-11-21T04:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  bot: {
    id: 'bot',
    name: '사내 알림봇',
    email: 'bot@worktalk.co.kr',
    department: '시스템',
    position: '봇',
    phone: '',
    avatarUrl: '',
    statusMessage: '',
    presenceStatus: 'online',
    role: 'bot',
    totalLeaveDays: 0,
    usedLeaveDays: 0,
    online: true,
    lastSeen: '2026-11-21T05:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
};

test('calculateLeaveDays computes full weekdays, half-day, and rejects invalid dates', () => {
  const halfDay = calculateLeaveDays('오전반차', '2026-11-23', '2026-11-23');
  assert.equal(halfDay.valid, true);
  assert.equal(halfDay.days, 0.5);

  const halfDayMismatch = calculateLeaveDays('오후반차', '2026-11-23', '2026-11-24');
  assert.equal(halfDayMismatch.valid, false);

  const multi = calculateLeaveDays('연차', '2026-11-23', '2026-11-25');
  assert.equal(multi.valid, true);
  assert.equal(multi.days, 3);

  const acrossWeekend = calculateLeaveDays('연차', '2026-11-20', '2026-11-23');
  assert.equal(acrossWeekend.valid, true);
  assert.equal(acrossWeekend.days, 2);

  const reversed = calculateLeaveDays('연차', '2026-11-25', '2026-11-23');
  assert.equal(reversed.valid, false);
});

test('parseChatLeaveCommand parses slash and natural Korean chat leave requests', () => {
  const cols = Object.values(mockUsers);
  const slash = parseChatLeaveCommand('/연차 내일 이서연 사유 병원 진료', '2026-11-21', cols);
  assert.equal(slash.matched, true);
  assert.equal(slash.type, '연차');
  assert.equal(slash.startDate, '2026-11-22');
  assert.equal(slash.endDate, '2026-11-22');
  assert.equal(slash.substituteId, 'u2');
  assert.equal(slash.reason, '병원 진료');

  const naturalHalf = parseChatLeaveCommand('11월 25일 오전반차 신청합니다', '2026-11-21', cols);
  assert.equal(naturalHalf.matched, true);
  assert.equal(naturalHalf.type, '오전반차');
  assert.equal(naturalHalf.startDate, '2026-11-25');
  assert.equal(naturalHalf.endDate, '2026-11-25');

  const normalChat = parseChatLeaveCommand('점심 뭐 드실래요?', '2026-11-21', cols);
  assert.equal(normalChat.matched, false);
});

test('computeUnreadCount excludes bot and already-read members accurately', () => {
  const msg: Message = {
    id: 'm1',
    roomId: 'r1',
    senderId: 'u1',
    type: 'text',
    content: '안녕하세요',
    replyToId: null,
    reactions: {},
    readBy: ['u1'],
    createdAt: '2026-11-21T05:00:00Z',
  };
  assert.equal(computeUnreadCount(msg, ['u1', 'u2', 'bot'], mockUsers), 1);

  const readByAll = { ...msg, readBy: ['u1', 'u2'] };
  assert.equal(computeUnreadCount(readByAll, ['u1', 'u2', 'bot'], mockUsers), 0);
});

test('groupMessagesByDateAndSender collapses consecutive bubbles within the same minute', () => {
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u1',
      type: 'text',
      content: '첫번째',
      replyToId: null,
      reactions: {},
      readBy: ['u1'],
      createdAt: '2026-11-21T01:10:05.000Z',
    },
    {
      id: 'm2',
      roomId: 'r1',
      senderId: 'u1',
      type: 'text',
      content: '두번째',
      replyToId: null,
      reactions: {},
      readBy: ['u1'],
      createdAt: '2026-11-21T01:10:42.000Z',
    },
    {
      id: 'm3',
      roomId: 'r1',
      senderId: 'u2',
      type: 'text',
      content: '답변',
      replyToId: null,
      reactions: {},
      readBy: ['u2'],
      createdAt: '2026-11-21T01:10:50.000Z',
    },
  ];

  const grouped = groupMessagesByDateAndSender(msgs);
  assert.equal(grouped[0].showSenderHeader, true);
  assert.equal(grouped[0].showTimestamp, false);
  assert.equal(grouped[1].showSenderHeader, false);
  assert.equal(grouped[1].showTimestamp, true);
  assert.equal(grouped[2].showSenderHeader, true);
  assert.equal(grouped[2].showTimestamp, true);
  assert.ok(grouped[0].dateHeader !== null);
  assert.equal(grouped[1].dateHeader, null);
});

test('filterAndSortRooms prioritizes pinned rooms and filters unread/search', () => {
  const rooms: ChatRoom[] = [
    {
      id: 'r1',
      type: 'group',
      name: '전사 공지방',
      description: '',
      memberIds: ['u1', 'u2'],
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      createdAt: '2026-11-20T00:00:00Z',
      updatedAt: '2026-11-21T05:00:00Z',
    },
    {
      id: 'r2',
      type: 'direct',
      name: 'DM',
      description: '',
      memberIds: ['u1', 'u2'],
      pinnedByUserIds: ['u1'],
      mutedByUserIds: [],
      activeNoticeId: null,
      createdAt: '2026-11-20T00:00:00Z',
      updatedAt: '2026-11-21T03:00:00Z',
    },
  ];
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u2',
      type: 'text',
      content: '공지 확인 부탁드립니다',
      replyToId: null,
      reactions: {},
      readBy: ['u2'],
      createdAt: '2026-11-21T05:00:00Z',
    },
  ];

  const allSorted = filterAndSortRooms(rooms, msgs, 'u1', 'all', '', mockUsers);
  assert.equal(allSorted[0].id, 'r2');

  const unreadOnly = filterAndSortRooms(rooms, msgs, 'u1', 'unread', '', mockUsers);
  assert.equal(unreadOnly.length, 1);
  assert.equal(unreadOnly[0].id, 'r1');

  const byPeerName = filterAndSortRooms(rooms, msgs, 'u1', 'direct', '이서연', mockUsers);
  assert.equal(byPeerName.length, 1);
  assert.equal(byPeerName[0].id, 'r2');
});

test('toggleReactionMap adds and removes reactions cleanly', () => {
  let reactions: Record<string, string[]> = {};
  reactions = toggleReactionMap(reactions, '👍', 'u1');
  assert.deepEqual(reactions['👍'], ['u1']);
  reactions = toggleReactionMap(reactions, '👍', 'u2');
  assert.deepEqual(reactions['👍'], ['u1', 'u2']);
  reactions = toggleReactionMap(reactions, '👍', 'u1');
  assert.deepEqual(reactions['👍'], ['u2']);
  reactions = toggleReactionMap(reactions, '👍', 'u2');
  assert.equal(reactions['👍'], undefined);
});

test('formatLeaveNotificationText and isUserOnLeaveOnDate work cleanly', () => {
  const formatted = formatLeaveNotificationText({
    leaveId: 'l1',
    userId: 'u2',
    userName: '이서연',
    department: 'UX 디자인팀',
    position: '선임',
    leaveType: '연차',
    startDate: '2026-11-21',
    endDate: '2026-11-21',
    daysCount: 1,
    substituteName: '김민준 팀장',
    reason: '개인 휴식',
  });
  assert.ok(formatted.title.includes('이서연'));
  assert.ok(formatted.body.includes('김민준 팀장'));

  const leaves: LeaveRequest[] = [
    {
      id: 'l1',
      userId: 'u2',
      type: '연차',
      startDate: '2026-11-21',
      endDate: '2026-11-22',
      daysCount: 1,
      substituteId: 'u1',
      reason: '휴가',
      status: '승인완료',
      createdAt: '2026-11-20T00:00:00Z',
    },
  ];
  assert.ok(isUserOnLeaveOnDate(leaves, 'u2', '2026-11-21') !== null);
  assert.equal(isUserOnLeaveOnDate(leaves, 'u2', '2026-11-25'), null);
  assert.equal(formatFileSize(2048), '2.0 KB');
});

test('parseChatLeaveCommand rejects leave balance and past history lookup queries', () => {
  const cols = Object.values(mockUsers);
  assert.equal(parseChatLeaveCommand('내 연차 몇일 남았어?', '2026-11-23', cols).matched, false);
  assert.equal(parseChatLeaveCommand('지난달 내 연차 사용 기록 조회해줘', '2026-11-23', cols).matched, false);
  assert.equal(parseChatLeaveCommand('/연차조회 지난달', '2026-11-23', cols).matched, false);
  assert.equal(parseChatLeaveCommand('/내연차', '2026-11-23', cols).matched, false);
  assert.equal(parseChatLeaveCommand('과거 연차 내역 보여줘', '2026-11-23', cols).matched, false);
});

test('getUserLeaveSummary, parseLeaveHistoryQuery, executeLeaveHistoryQuery, and buildMonthlyLeaveCalendar work accurately', () => {
  const usersList = Object.values(mockUsers);
  const sampleLeaves: LeaveRequest[] = [
    {
      id: 'l-past-1',
      userId: 'u1',
      type: '연차',
      startDate: '2026-10-14',
      endDate: '2026-10-15',
      daysCount: 2,
      substituteId: 'u2',
      reason: '가을 가족 여행',
      status: '승인완료',
      createdAt: '2026-10-10T09:00:00Z',
    },
    {
      id: 'l-past-2',
      userId: 'u1',
      type: '오전반차',
      startDate: '2026-09-08',
      endDate: '2026-09-08',
      daysCount: 0.5,
      substituteId: 'u2',
      reason: '치과 검진',
      status: '승인완료',
      createdAt: '2026-09-05T09:00:00Z',
    },
    {
      id: 'l-past-3',
      userId: 'u2',
      type: '연차',
      startDate: '2026-10-06',
      endDate: '2026-10-06',
      daysCount: 1,
      substituteId: 'u1',
      reason: '디자인 컨퍼런스',
      status: '승인완료',
      createdAt: '2026-10-01T09:00:00Z',
    },
    {
      id: 'l-future-1',
      userId: 'u1',
      type: '연차',
      startDate: '2026-11-26',
      endDate: '2026-11-26',
      daysCount: 1,
      substituteId: 'u2',
      reason: '개인 휴식',
      status: '승인완료',
      createdAt: '2026-11-20T09:00:00Z',
    },
  ];

  const summary = getUserLeaveSummary(mockUsers.u1, sampleLeaves, '2026-11-23');
  assert.equal(summary.totalDays, 15);
  assert.equal(summary.usedDays, 2);
  assert.equal(summary.remainingDays, 13);
  assert.equal(summary.pastLeaves.length, 2);
  assert.equal(summary.upcomingLeaves.length, 1);

  const lastMonthMine = executeLeaveHistoryQuery(
    '지난달 내 연차 기록 조회해줘',
    sampleLeaves,
    usersList,
    mockUsers.u1,
    '2026-11-23',
  );
  assert.equal(lastMonthMine.query.matched, true);
  assert.equal(lastMonthMine.query.scope, 'mine');
  assert.equal(lastMonthMine.query.focusYearMonth, '2026-10');
  assert.equal(lastMonthMine.matchedLeaves.length, 1);
  assert.equal(lastMonthMine.matchedLeaves[0].id, 'l-past-1');
  assert.equal(lastMonthMine.totalMatchedDays, 2);

  const balanceQ = executeLeaveHistoryQuery(
    '내 연차 몇일 남았어?',
    sampleLeaves,
    usersList,
    mockUsers.u1,
    '2026-11-23',
  );
  assert.equal(balanceQ.query.matched, true);
  assert.equal(balanceQ.query.intent, 'balance');
  assert.ok(balanceQ.summaryText.includes('잔여 13일'));

  const colleaguePast = executeLeaveHistoryQuery(
    '이서연 과거 연차 조회',
    sampleLeaves,
    usersList,
    mockUsers.u1,
    '2026-11-23',
  );
  assert.equal(colleaguePast.query.scope, 'person');
  assert.equal(colleaguePast.query.targetUserId, 'u2');
  assert.equal(colleaguePast.matchedLeaves.length, 1);
  assert.equal(colleaguePast.matchedLeaves[0].id, 'l-past-3');

  const halfDayPast = parseLeaveHistoryQuery(
    '과거 반차 기록 보여줘',
    '2026-11-23',
    mockUsers.u1,
    usersList,
  );
  assert.equal(halfDayPast.leaveTypeFilter, '반차');

  const cal = buildMonthlyLeaveCalendar(2026, 10, sampleLeaves, '2026-11-23', 'u1');
  assert.equal(cal.yearMonth, '2026-10');
  const oct14 = cal.cells.find((c) => c.date === '2026-10-14');
  assert.ok(oct14);
  assert.equal(oct14.leaves.length, 1);
  assert.equal(oct14.leaves[0].id, 'l-past-1');
});

test('buildMonthlyLeaveHistoryChartData aggregates past leaves per month and excludes upcoming leaves', () => {
  const sampleLeaves: LeaveRequest[] = [
    {
      id: 'l-sep',
      userId: 'u1',
      type: '오전반차',
      startDate: '2026-09-08',
      endDate: '2026-09-08',
      daysCount: 0.5,
      substituteId: 'u2',
      reason: '치과 검진',
      status: '승인완료',
      createdAt: '2026-09-05T09:00:00Z',
    },
    {
      id: 'l-oct-mine',
      userId: 'u1',
      type: '연차',
      startDate: '2026-10-14',
      endDate: '2026-10-15',
      daysCount: 2,
      substituteId: 'u2',
      reason: '가을 가족 여행',
      status: '승인완료',
      createdAt: '2026-10-10T09:00:00Z',
    },
    {
      id: 'l-oct-col',
      userId: 'u2',
      type: '병가',
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      daysCount: 1,
      substituteId: 'u1',
      reason: '감기 몸살',
      status: '승인완료',
      createdAt: '2026-10-19T09:00:00Z',
    },
    {
      id: 'l-cross-month',
      userId: 'u2',
      // 2026-07-31 (Fri, 1 weekday) ~ 2026-08-03 (Mon, 1 weekday) => 1d in Jul, 1d in Aug
      type: '연차',
      startDate: '2026-07-31',
      endDate: '2026-08-03',
      daysCount: 2,
      substituteId: 'u1',
      reason: '여름 휴가',
      status: '승인완료',
      createdAt: '2026-07-20T09:00:00Z',
    },
    {
      id: 'l-today',
      userId: 'u1',
      type: '연차',
      startDate: '2026-11-23',
      endDate: '2026-11-23',
      daysCount: 1,
      substituteId: 'u2',
      reason: '오늘 연차',
      status: '승인완료',
      createdAt: '2026-11-22T09:00:00Z',
    },
  ];

  const empty = buildMonthlyLeaveHistoryChartData([], '2026-11-23', { userId: 'u1', monthsBack: 6 });
  assert.equal(empty.buckets.length, 6);
  assert.equal(empty.totalPastDays, 0);
  assert.equal(empty.peakMonth, null);

  const mine = buildMonthlyLeaveHistoryChartData(sampleLeaves, '2026-11-23', { userId: 'u1', monthsBack: 6 });
  assert.equal(mine.buckets.map((b) => b.yearMonth).join(','), '2026-06,2026-07,2026-08,2026-09,2026-10,2026-11');
  assert.equal(mine.totalPastDays, 2.5);
  assert.equal(mine.totalPastRecords, 2);
  assert.equal(mine.activeMonthsCount, 2);
  assert.equal(mine.peakMonth?.yearMonth, '2026-10');
  assert.equal(mine.peakMonth?.totalDays, 2);
  const sepBucket = mine.buckets.find((b) => b.yearMonth === '2026-09');
  assert.equal(sepBucket?.오전반차, 0.5);
  assert.equal(mine.buckets.find((b) => b.yearMonth === '2026-11')?.totalDays, 0);

  const companyAll = buildMonthlyLeaveHistoryChartData(sampleLeaves, '2026-11-23', { userId: null, monthsBack: 6 });
  assert.equal(companyAll.totalPastDays, 5.5);
  assert.equal(companyAll.buckets.find((b) => b.yearMonth === '2026-07')?.totalDays, 1);
  assert.equal(companyAll.buckets.find((b) => b.yearMonth === '2026-08')?.totalDays, 1);
  assert.equal(companyAll.buckets.find((b) => b.yearMonth === '2026-10')?.병가, 1);
  assert.equal(companyAll.buckets.find((b) => b.yearMonth === '2026-10')?.연차, 2);

  const twelveMonths = buildMonthlyLeaveHistoryChartData(sampleLeaves, '2026-11-23', { userId: null, monthsBack: 12 });
  assert.equal(twelveMonths.buckets.length, 12);
  assert.equal(twelveMonths.buckets[0].yearMonth, '2025-12');
  assert.equal(twelveMonths.buckets[0].label, '25.12월');
});

test('formatFileSize formats B, KB, MB, 100GB+, and TB sizes accurately', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(200 * 1024 * 1024), '200.0 MB');
  assert.equal(formatFileSize(100 * 1024 * 1024 * 1024), '100.0 GB');
  assert.equal(formatFileSize(1.5 * 1024 * 1024 * 1024 * 1024), '1.50 TB');
});

