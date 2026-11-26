import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyComposerTriggerReplacement,
  buildMailDraftFromMessagesPure,
  buildMailReplyDraftPure,
  buildTranscriptText,
  detectComposerTrigger,
  detectInChatQuickIntent,
  extractMentionUserIds,
  extractUrlsFromText,
  filterRoomMessages,
  findFirstUnreadMessageId,
  formatVoiceDuration,
  getReadReceiptBreakdown,
  hasUnreadMentionForUser,
  isMessageExpired,
  maskViewOnceMessageForUser,
  parseMessageSegments,
  parseSgwIntegrationCommand,
  sanitizeDraftsMap,
  sanitizeSafeHttpUrl,
  summarizeRoomMessagesPure,
} from './chatLogic';
import type { MailMessage, Message, User } from './types';

const makeUser = (id: string, name: string, role: User['role'] = 'member'): User => ({
  id,
  name,
  email: `${id}@sgw.co.kr`,
  department: '개발팀',
  position: '선임',
  phone: '',
  avatarUrl: '',
  statusMessage: '',
  presenceStatus: 'online',
  role,
  totalLeaveDays: 15,
  usedLeaveDays: 0,
  online: true,
  lastSeen: '2026-11-21T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
});

const users: User[] = [
  makeUser('u1', '김민준'),
  makeUser('u2', '이서연'),
  makeUser('u3', '박지훈'),
  makeUser('u-bot', 'SGW 알림봇', 'bot'),
];

const usersById: Record<string, User> = Object.fromEntries(users.map((u) => [u.id, u]));

test('parseMessageSegments detects mentions, URLs, and inline code cleanly', () => {
  const segs = parseMessageSegments(
    '@이서연님 https://sgw.co.kr/docs 확인 및 `npm run build` 실행 부탁해요 @전체',
    users,
  );
  assert.equal(segs.some((s) => s.kind === 'mention' && s.userId === 'u2'), true);
  assert.equal(segs.some((s) => s.kind === 'mention' && s.userId === 'all'), true);
  assert.equal(segs.some((s) => s.kind === 'url' && s.href === 'https://sgw.co.kr/docs'), true);
  assert.equal(segs.some((s) => s.kind === 'code' && s.value === 'npm run build'), true);
  assert.deepEqual(extractUrlsFromText('링크: https://example.com/a).'), ['https://example.com/a']);
  assert.deepEqual(extractMentionUserIds('@이서연 @박지훈 확인', users), ['u2', 'u3']);
});

test('detectComposerTrigger and applyComposerTriggerReplacement handle @mention and /command', () => {
  const mentionText = '안녕하세요 @이서';
  const mTrigger = detectComposerTrigger(mentionText, mentionText.length);
  assert.deepEqual(mTrigger, {
    kind: 'mention',
    query: '이서',
    startIndex: 6,
    endIndex: 9,
  });
  const replaced = applyComposerTriggerReplacement(mentionText, mTrigger!, '@이서연');
  assert.equal(replaced.nextText, '안녕하세요 @이서연 ');

  const cmdText = '/연';
  const cTrigger = detectComposerTrigger(cmdText, cmdText.length);
  assert.deepEqual(cTrigger, {
    kind: 'command',
    query: '연',
    startIndex: 0,
    endIndex: 2,
  });
});

test('filterRoomMessages filters by type, query, and starred status', () => {
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u1',
      type: 'text',
      content: '릴리즈 문서 https://sgw.co.kr/release 확인 바랍니다.',
      replyToId: null,
      reactions: {},
      readBy: ['u1'],
      starredByUserIds: ['u1'],
      createdAt: '2026-11-21T01:00:00.000Z',
    },
    {
      id: 'm2',
      roomId: 'r1',
      senderId: 'u2',
      type: 'file',
      content: 'design-v2.pdf',
      replyToId: null,
      file: {
        id: 'f1',
        filename: 'design-v2.pdf',
        mimeType: 'application/pdf',
        size: 1200,
        url: '/api/files/f1/download',
        isImage: false,
      },
      reactions: {},
      readBy: ['u2'],
      createdAt: '2026-11-21T02:00:00.000Z',
    },
  ];

  assert.deepEqual(
    filterRoomMessages(msgs, { query: '', filter: 'links', currentUserId: 'u1', usersById }),
    ['m1'],
  );
  assert.deepEqual(
    filterRoomMessages(msgs, { query: '', filter: 'files', currentUserId: 'u1', usersById }),
    ['m2'],
  );
  assert.deepEqual(
    filterRoomMessages(msgs, { query: '', filter: 'starred', currentUserId: 'u1', usersById }),
    ['m1'],
  );
  assert.deepEqual(
    filterRoomMessages(msgs, { query: '이서연', filter: 'all', currentUserId: 'u1', usersById }),
    ['m2'],
  );
});

test('findFirstUnreadMessageId and getReadReceiptBreakdown ignore bot and own messages', () => {
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u1',
      type: 'text',
      content: '내 메시지',
      replyToId: null,
      reactions: {},
      readBy: ['u1', 'u2'],
      createdAt: '2026-11-21T01:00:00.000Z',
    },
    {
      id: 'm2',
      roomId: 'r1',
      senderId: 'u2',
      type: 'text',
      content: '안읽은 첫 메시지',
      replyToId: null,
      reactions: {},
      readBy: ['u2'],
      createdAt: '2026-11-21T02:00:00.000Z',
    },
  ];

  assert.equal(findFirstUnreadMessageId(msgs, 'u1'), 'm2');
  const breakdown = getReadReceiptBreakdown(msgs[0], ['u1', 'u2', 'u3', 'u-bot'], usersById);
  assert.deepEqual(
    breakdown.readUsers.map((u) => u.id),
    ['u1', 'u2'],
  );
  assert.deepEqual(
    breakdown.unreadUsers.map((u) => u.id),
    ['u3'],
  );

  const transcript = buildTranscriptText([msgs[0], msgs[1]], usersById);
  assert.equal(transcript.includes('김민준: 내 메시지'), true);
  assert.equal(transcript.includes('이서연: 안읽은 첫 메시지'), true);
});

test('hasUnreadMentionForUser, isMessageExpired, and formatVoiceDuration cover 3x3 features', () => {
  const msgs: Message[] = [
    {
      id: 'm-mention',
      roomId: 'r1',
      senderId: 'u2',
      type: 'text',
      content: '@김민준 확인 부탁드립니다',
      replyToId: null,
      reactions: {},
      readBy: ['u2'],
      mentions: ['u1'],
      createdAt: '2026-11-21T01:00:00.000Z',
    },
    {
      id: 'm-recalled',
      roomId: 'r2',
      senderId: 'u2',
      type: 'text',
      content: '이서연님이 메시지를 회수했습니다.',
      recalled: true,
      recalledOriginalContent: '@김민준 원래 내용',
      replyToId: null,
      reactions: {},
      readBy: ['u2'],
      mentions: ['u1'],
      createdAt: '2026-11-21T01:05:00.000Z',
    },
  ];

  assert.equal(hasUnreadMentionForUser(msgs, 'r1', 'u1'), true);
  assert.equal(hasUnreadMentionForUser(msgs, 'r2', 'u1'), false);

  const nowMs = new Date('2026-11-21T12:00:00.000Z').getTime();
  assert.equal(
    isMessageExpired({ ...msgs[0], expiresAt: '2026-11-21T11:59:00.000Z' }, nowMs),
    true,
  );
  assert.equal(
    isMessageExpired({ ...msgs[0], expiresAt: '2026-11-21T13:00:00.000Z' }, nowMs),
    false,
  );
  assert.equal(isMessageExpired(msgs[0], nowMs), false);

  assert.equal(formatVoiceDuration(0), '1"');
  assert.equal(formatVoiceDuration(8), '8"');
  assert.equal(formatVoiceDuration(75), '1:15');
});

test('parseSgwIntegrationCommand parses calendar, meeting memo, meeting, and SEDMS commands', () => {
  const cal = parseSgwIntegrationCommand('프로젝트 달력 열어줘');
  assert.equal(cal.matched, true);
  if (cal.matched) {
    assert.equal(cal.summary.system, 'SGW');
    assert.equal(cal.summary.menuKey, 'project-calendar');
    assert.equal(cal.summary.payload?.action, 'view');
  }

  const calCreate = parseSgwIntegrationCommand('/달력 2026-12-01 QA 일정 등록');
  assert.equal(calCreate.matched, true);
  if (calCreate.matched) {
    assert.equal(calCreate.summary.payload?.action, 'create');
    assert.equal(calCreate.summary.payload?.date, '2026-12-01');
  }

  const memo = parseSgwIntegrationCommand('오늘 회의록 미팅메모로 작성해줘');
  assert.equal(memo.matched, true);
  if (memo.matched) {
    assert.equal(memo.summary.menuKey, 'meeting-memo');
    assert.equal(memo.summary.payload?.action, 'create');
  }

  const meetingStart = parseSgwIntegrationCommand('개발팀 화상회의 바로 시작해');
  assert.equal(meetingStart.matched, true);
  if (meetingStart.matched) {
    assert.equal(meetingStart.summary.menuKey, 'meeting');
    assert.equal(meetingStart.summary.payload?.action, 'start');
  }

  const meetingJoin = parseSgwIntegrationCommand('/회의 입장');
  assert.equal(meetingJoin.matched, true);
  if (meetingJoin.matched) {
    assert.equal(meetingJoin.summary.payload?.action, 'join');
  }

  const approval = parseSgwIntegrationCommand('SEDMS 전자결재 확인');
  assert.equal(approval.matched, true);
  if (approval.matched) assert.equal(approval.summary.menuKey, 'approval');

  const docs = parseSgwIntegrationCommand('/문서 설계 도면');
  assert.equal(docs.matched, true);
  if (docs.matched) assert.equal(docs.summary.menuKey, 'document');

  const att = parseSgwIntegrationCommand('금일 근태 현황 확인');
  assert.equal(att.matched, true);
  if (att.matched) assert.equal(att.summary.menuKey, 'attendance');

  const portal = parseSgwIntegrationCommand('SEDMS 전체 메뉴 열어');
  assert.equal(portal.matched, true);
  if (portal.matched) assert.equal(portal.summary.menuKey, 'dashboard');

  assert.equal(parseSgwIntegrationCommand('점심 뭐 먹을까요?').matched, false);
});

test('sanitizeSafeHttpUrl allows http/https and rejects javascript/data protocols', () => {
  assert.equal(sanitizeSafeHttpUrl('https://sgw.co.kr/path?a=1'), 'https://sgw.co.kr/path?a=1');
  assert.equal(sanitizeSafeHttpUrl('http://localhost:3000/test'), 'http://localhost:3000/test');
  assert.equal(sanitizeSafeHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeSafeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeSafeHttpUrl('not a url'), null);
});

test('sanitizeDraftsMap strips invalid keys, empty values, and caps length', () => {
  const cleaned = sanitizeDraftsMap({
    'room-company': '초안 메시지',
    'room-empty': '',
    'room-num': 123,
    ['x'.repeat(200)]: 'too-long-key',
    'room-long': 'a'.repeat(9000),
  });
  assert.equal(cleaned['room-company'], '초안 메시지');
  assert.equal('room-empty' in cleaned, false);
  assert.equal('room-num' in cleaned, false);
  assert.equal(cleaned['room-long']?.length, 8000);
  assert.deepEqual(sanitizeDraftsMap(['invalid']), {});
});

test('detectInChatQuickIntent resolves all in-chat slash and Korean natural intents', () => {
  const urgentNotice = detectInChatQuickIntent('/긴급공지 서버 점검: 금일 18시 VPN 재접속');
  assert.deepEqual(urgentNotice, {
    kind: 'notice',
    urgent: true,
    prefillTitle: '서버 점검',
    prefillContent: '금일 18시 VPN 재접속',
  });

  assert.deepEqual(detectInChatQuickIntent('/나스'), { kind: 'nas' });
  assert.deepEqual(detectInChatQuickIntent('100GB NAS 대용량 공유 열어줘'), { kind: 'nas' });
  assert.deepEqual(detectInChatQuickIntent('/메일'), { kind: 'mail', tab: 'inbox' });
  assert.deepEqual(detectInChatQuickIntent('빅메일 보내기 열어줘'), { kind: 'mail', tab: 'compose' });
  assert.deepEqual(detectInChatQuickIntent('최근 대화 내용 요약해줘'), { kind: 'summary' });
  assert.deepEqual(detectInChatQuickIntent('미확인 알림 브리핑 보여줘'), { kind: 'alerts' });
  assert.deepEqual(detectInChatQuickIntent('당번 랜덤 추첨 해줘'), { kind: 'draw' });
  assert.deepEqual(detectInChatQuickIntent('/대화저장'), { kind: 'export_transcript' });
  assert.equal(detectInChatQuickIntent('오늘 점심 같이 드실 분?'), null);
});

test('summarizeRoomMessagesPure distills room messages into readable bullets', () => {
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u1',
      type: 'text',
      content: '금일 릴리즈 일정 점검 부탁드립니다.',
      replyToId: null,
      reactions: {},
      readBy: ['u1'],
      createdAt: '2026-11-25T01:00:00.000Z',
    },
    {
      id: 'm2',
      roomId: 'r1',
      senderId: 'u2',
      type: 'file',
      content: 'release-v3.zip',
      replyToId: null,
      file: {
        id: 'f2',
        filename: 'release-v3.zip',
        mimeType: 'application/zip',
        size: 1024 * 1024 * 12,
        url: '/api/files/f2/download',
        isImage: false,
      },
      reactions: {},
      readBy: ['u2'],
      createdAt: '2026-11-25T01:05:00.000Z',
    },
  ];
  const res = summarizeRoomMessagesPure('프로덕트 개발팀', msgs, usersById);
  assert.equal(res.messageCount, 2);
  assert.equal(res.bullets.some((b) => b.includes('release-v3.zip')), true);
  assert.equal(res.summaryText.includes('[대화 요약] 프로덕트 개발팀'), true);
});

test('maskViewOnceMessageForUser conceals secret content from recipients and preserves for sender', () => {
  const secretMsg: Message = {
    id: 'm-secret',
    roomId: 'r1',
    senderId: 'u1',
    type: 'text',
    content: 'VPN 임시 비밀번호: SGW-9921-PASS',
    viewOnce: true,
    viewedByUserIds: [],
    replyToId: null,
    reactions: {},
    readBy: ['u1'],
    createdAt: '2026-11-25T02:00:00.000Z',
  };

  assert.equal(maskViewOnceMessageForUser(secretMsg, 'u1').content, 'VPN 임시 비밀번호: SGW-9921-PASS');
  assert.equal(maskViewOnceMessageForUser(secretMsg, 'u2').content, '🔒 1회 열람 비밀 메시지');

  const afterView = { ...secretMsg, viewedByUserIds: ['u2'] };
  assert.equal(
    maskViewOnceMessageForUser(afterView, 'u2').content.includes('보안 잠금된 메시지'),
    true,
  );
  assert.deepEqual(detectInChatQuickIntent('/1회열람'), { kind: 'view_once' });
});

test('buildMailDraftFromMessagesPure and buildMailReplyDraftPure bridge SG Talk and bmail seamlessly', () => {
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u1',
      type: 'text',
      content: '금일 100GB NAS 패키지 공유합니다.',
      replyToId: null,
      reactions: {},
      readBy: ['u1'],
      createdAt: '2026-11-25T01:00:00.000Z',
    },
    {
      id: 'm2',
      roomId: 'r1',
      senderId: 'u2',
      type: 'file',
      content: 'Asset_100GB.tar.zst',
      replyToId: null,
      file: {
        id: 'nas-100g',
        filename: 'Asset_100GB.tar.zst',
        mimeType: 'application/zstd',
        size: 100 * 1024 * 1024 * 1024,
        url: '/api/files/nas-100g/download',
        isImage: false,
        nasFolder: '전사-공유',
        nasExternalAccessUrl: 'https://nas.sgw.co.kr/share/abc',
      },
      reactions: {},
      readBy: ['u2'],
      createdAt: '2026-11-25T01:02:00.000Z',
    },
  ];

  const draft = buildMailDraftFromMessagesPure('프로덕트 개발팀', msgs, usersById);
  assert.equal(draft.provider, 'bigmail');
  assert.deepEqual(draft.existingAttachmentIds, ['nas-100g']);
  assert.equal(draft.body.includes('Asset_100GB.tar.zst'), true);
  assert.equal(draft.body.includes('https://nas.sgw.co.kr/share/abc'), true);

  const incoming: MailMessage = {
    id: 'mail-9',
    provider: 'bigmail',
    senderId: 'u2',
    recipientIds: ['u1', 'u3'],
    subject: 'Q4 릴리즈 검토',
    body: '검토 후 회신 부탁드립니다.',
    attachments: [
      {
        id: 'att-9',
        filename: 'pack.zip',
        size: 1024,
        mimeType: 'application/zip',
      },
    ],
    category: '일반',
    readByUserIds: ['u2'],
    createdAt: '2026-11-25T01:10:00.000Z',
  };

  const replyAll = buildMailReplyDraftPure(incoming, '이서연', 'replyAll', 'u1');
  assert.equal(replyAll.subject, 'Re: Q4 릴리즈 검토');
  assert.deepEqual(replyAll.recipientIds, ['u2', 'u3']);
  assert.equal(replyAll.inReplyToMailId, 'mail-9');

  const fwd = buildMailReplyDraftPure(incoming, '이서연', 'forward', 'u1');
  assert.equal(fwd.subject, 'Fwd: Q4 릴리즈 검토');
  assert.deepEqual(fwd.existingAttachmentIds, ['att-9']);
  assert.equal(fwd.inReplyToMailId, null);
});



