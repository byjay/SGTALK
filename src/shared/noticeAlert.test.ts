import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNoticeAckStats,
  formatEmergencyDisasterNoticeText,
  getNoticePriorityMeta,
  normalizeNoticePriority,
  sortNoticesPinnedFirst,
  toggleNoticeAckList,
} from './noticeAlert';
import type { Notice, User } from './types';

const mockUsers: Record<string, User> = {
  'u-1': {
    id: 'u-1',
    name: '김민준',
    email: 'minjun@sgw.co.kr',
    department: '개발',
    position: '팀장',
    phone: '',
    avatarUrl: '',
    statusMessage: '',
    presenceStatus: 'online',
    role: 'member',
    totalLeaveDays: 15,
    usedLeaveDays: 2,
    online: true,
    lastSeen: '',
    createdAt: '',
  },
  'u-2': {
    id: 'u-2',
    name: '이서연',
    email: 'seoyeon@sgw.co.kr',
    department: '디자인',
    position: '선임',
    phone: '',
    avatarUrl: '',
    statusMessage: '',
    presenceStatus: 'online',
    role: 'member',
    totalLeaveDays: 15,
    usedLeaveDays: 1,
    online: true,
    lastSeen: '',
    createdAt: '',
  },
  'u-bot': {
    id: 'u-bot',
    name: 'SGW 알림봇',
    email: 'bot@sgw.co.kr',
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
    lastSeen: '',
    createdAt: '',
  },
};

test('normalizeNoticePriority maps urgent/important/normal properly', () => {
  assert.equal(normalizeNoticePriority({ isUrgent: true }), 'urgent');
  assert.equal(normalizeNoticePriority({ priority: 'urgent' }), 'urgent');
  assert.equal(normalizeNoticePriority({ priority: 'important' }), 'important');
  assert.equal(normalizeNoticePriority({ priority: 'unknown' }), 'normal');
  assert.equal(getNoticePriorityMeta('urgent').emergencyPrefix, '[긴급재난문자]');
});

test('computeNoticeAckStats ignores bots and counts author + acknowledged members', () => {
  const stats = computeNoticeAckStats(
    { authorId: 'u-1', acknowledgedBy: ['u-1'] },
    ['u-1', 'u-2', 'u-bot'],
    mockUsers,
  );
  assert.equal(stats.totalHumanMembers, 2);
  assert.equal(stats.ackCount, 1);
  assert.deepEqual(stats.acknowledgedNames, ['김민준']);
  assert.deepEqual(stats.unacknowledgedNames, ['이서연']);
});

test('toggleNoticeAckList is idempotent and handles undefined', () => {
  const first = toggleNoticeAckList(undefined, 'u-2');
  assert.deepEqual(first, ['u-2']);
  const second = toggleNoticeAckList(first, 'u-2');
  assert.deepEqual(second, ['u-2']);
});

test('formatEmergencyDisasterNoticeText produces clear Korean CBS-like alert text', () => {
  const out = formatEmergencyDisasterNoticeText({
    title: '서버 긴급 점검 안내',
    content: '18:30부터 10분간 사내 네트워크 점검이 진행됩니다.',
    senderName: '김민준 팀장',
    roomName: '전사 공지·자유방',
  });
  assert.match(out.headerLabel, /긴급재난문자/);
  assert.match(out.headerLabel, /SG Talk/);
  assert.equal(out.headline, '서버 긴급 점검 안내');
  assert.equal(out.metaLine, '김민준 팀장 발송 · 전사 공지·자유방');
});

test('sortNoticesPinnedFirst places pinned & urgent notices ahead of older notices', () => {
  const base: Notice[] = [
    {
      id: 'n-old',
      roomId: 'r-1',
      messageId: null,
      authorId: 'u-1',
      title: '이전 일반 공지',
      content: '내용',
      pinned: false,
      createdAt: '2026-11-24T08:00:00Z',
    },
    {
      id: 'n-pin',
      roomId: 'r-1',
      messageId: null,
      authorId: 'u-1',
      title: '고정 긴급 공지',
      content: '긴급',
      pinned: true,
      priority: 'urgent',
      isUrgent: true,
      createdAt: '2026-11-24T09:00:00Z',
    },
  ];
  const sorted = sortNoticesPinnedFirst(base);
  assert.equal(sorted[0].id, 'n-pin');
  assert.equal(sorted[1].id, 'n-old');
});
