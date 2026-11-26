import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConciseMailDigest,
  filterNoticesByScope,
  parseControlTowerCommand,
  summarizeMailBodyPure,
} from './controlTower';
import type { Notice } from './types';

test('buildConciseMailDigest creates concise 1-line summary + attachment badge without dumping full body', () => {
  const digest = buildConciseMailDigest(
    {
      provider: 'bigmail',
      subject: '2026 SGW 차세대 아키텍처 대용량 설계서 송부',
      body: '본문 전체 내용입니다...\n상세 일정과 도면이 포함되어 있으니 검토 부탁드립니다.',
      shortSummary: 'SGW 차세대 아키텍처 대용량 설계서 검토 요청',
      attachments: [
        { id: 'a1', filename: 'SGW_아키텍처_설계서.pdf', size: 42000000 },
        { id: 'a2', filename: '네트워크_토폴로지.zip', size: 84000000 },
      ],
    },
    '박준호 수석',
  );
  assert.equal(digest.provider, 'bigmail');
  assert.equal(digest.providerLabel, '빅메일');
  assert.equal(digest.attachmentCount, 2);
  assert.equal(digest.attachmentLabel, '📎 SGW_아키텍처_설계서.pdf 외 1개');
  assert.ok(digest.alertTitle.includes('[빅메일]'));
  assert.ok(digest.alertBody.includes('첨부') || digest.alertBody.includes('📎'));
});

test('summarizeMailBodyPure produces up to 3 concise bullets', () => {
  const bullets = summarizeMailBodyPure(
    {
      provider: 'bmail',
      subject: '주간 개발 회의 안건 공유',
      body: '안녕하세요 김민준 팀장님.\n금주 목요일 오후 2시 아키텍처 리뷰 회의 진행합니다.\n사전 확인 부탁드립니다.',
      attachments: [],
    },
    '이서연 매니저',
  );
  assert.equal(bullets.length, 3);
  assert.ok(bullets[0].includes('[비메일]'));
});

test('filterNoticesByScope isolates personal notices per owner while showing global notices', () => {
  const notices: Notice[] = [
    {
      id: 'n1',
      roomId: 'room-company',
      scope: 'global',
      messageId: null,
      authorId: 'u-minjun',
      title: '전사 공지',
      content: '내용1',
      pinned: true,
      createdAt: '2026-11-22T09:00:00Z',
    },
    {
      id: 'n2',
      roomId: 'room-self-u-minjun',
      scope: 'personal',
      ownerUserId: 'u-minjun',
      messageId: null,
      authorId: 'u-minjun',
      title: '내 개인 메모',
      content: '내용2',
      pinned: false,
      createdAt: '2026-11-22T10:00:00Z',
    },
    {
      id: 'n3',
      roomId: 'room-self-u-jiyeon',
      scope: 'personal',
      ownerUserId: 'u-jiyeon',
      messageId: null,
      authorId: 'u-jiyeon',
      title: '타인 개인 메모',
      content: '내용3',
      pinned: false,
      createdAt: '2026-11-22T11:00:00Z',
    },
  ];

  const myAll = filterNoticesByScope(notices, 'u-minjun', 'all');
  assert.deepEqual(
    myAll.map((n) => n.id),
    ['n1', 'n2'],
  );

  const globals = filterNoticesByScope(notices, 'u-minjun', 'global');
  assert.deepEqual(
    globals.map((n) => n.id),
    ['n1'],
  );
});

test('parseControlTowerCommand routes BigMail, Notices, Alerts, and Chat voice commands', () => {
  assert.deepEqual(parseControlTowerCommand('최근 빅메일 요약해줘'), {
    kind: 'mail_summarize',
    provider: 'bigmail',
  });
  assert.deepEqual(parseControlTowerCommand('비메일 상세히 열어줘'), {
    kind: 'mail_open',
    provider: 'bmail',
    query: '비메일 상세히 열어줘',
  });

  const personal = parseControlTowerCommand('개인 공지 등록: 오늘 5시 배포 점검');
  assert.equal(personal.kind, 'notice_create_personal');
  if (personal.kind === 'notice_create_personal') {
    assert.ok(personal.content.includes('오늘 5시 배포 점검'));
  }

  const global = parseControlTowerCommand('전체 업무 공지 작성: 금요일 서버 점검 안내');
  assert.equal(global.kind, 'notice_create_global');

  assert.equal(parseControlTowerCommand('전체 알람 브리핑해줘').kind, 'alerts_briefing');
  assert.equal(parseControlTowerCommand('미확인 채팅 알려줘').kind, 'chat_briefing');
});
