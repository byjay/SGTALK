import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSearchSubject,
  normalizeEgoGoal,
  planDeterministicEgoWorkflow,
  sanitizeSafeHttpUrl,
} from './egoPlanner';
import { isSafeInlineImageMime } from '../../server/security';
import type { User } from './types';

const SAMPLE_COLLEAGUES: User[] = [
  {
    id: 'u-1',
    name: '김민준',
    email: 'minjun@sgw.co.kr',
    department: '프로덕트 개발팀',
    position: '팀장',
    phone: '010-1111-2222',
    avatarUrl: '',
    statusMessage: '',
    presenceStatus: 'online',
    role: 'admin',
    totalLeaveDays: 15,
    usedLeaveDays: 2,
    online: true,
    lastSeen: '2026-11-22T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('SGW EGO Planner & Security Helpers', () => {
  it('normalizes whitespace and caps long goals', () => {
    const normalized = normalizeEgoGoal('  판교\n\t회식   장소   찾아줘  ');
    assert.equal(normalized, '판교 회식 장소 찾아줘');
    assert.equal(normalizeEgoGoal('a'.repeat(700)).length, 600);
  });

  it('extracts concise search subject from Korean natural language commands', () => {
    const subject = extractSearchSubject('판교 회식 장소 찾아서 미팅메모 작성하고 내 카톡으로 보내줘');
    assert.ok(subject.includes('판교 회식'));
    assert.ok(!subject.includes('미팅메모'));
  });

  it('sanitizes external URLs to allow only http/https', () => {
    assert.equal(sanitizeSafeHttpUrl('https://place.map.kakao.com/1234'), 'https://place.map.kakao.com/1234');
    assert.equal(sanitizeSafeHttpUrl('http://developers.kakao.com'), 'http://developers.kakao.com/');
    assert.equal(sanitizeSafeHttpUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeSafeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(sanitizeSafeHttpUrl('not-a-url'), null);
  });

  it('blocks SVG and HTML from inline rendering while allowing safe raster images', () => {
    assert.equal(isSafeInlineImageMime('image/png'), true);
    assert.equal(isSafeInlineImageMime('image/jpeg; charset=utf-8'), true);
    assert.equal(isSafeInlineImageMime('image/webp'), true);
    assert.equal(isSafeInlineImageMime('image/gif'), true);
    assert.equal(isSafeInlineImageMime('image/svg+xml'), false);
    assert.equal(isSafeInlineImageMime('text/html'), false);
    assert.equal(isSafeInlineImageMime('application/javascript'), false);
  });

  it('chains Kakao Local + Meeting Memo + KakaoTalk Memo in one autonomous plan', () => {
    const plan = planDeterministicEgoWorkflow({
      goal: '판교 회식 장소 찾아서 미팅메모 작성하고 내 카톡으로 보내줘',
      todayDate: '2026-11-22',
      colleagues: SAMPLE_COLLEAGUES,
    });
    const kinds = plan.actions.map((a) => a.kind);
    assert.ok(kinds.includes('kakao_local_search'));
    assert.ok(kinds.includes('sgw_meeting_memo'));
    assert.ok(kinds.includes('kakao_talk_memo'));
    assert.ok(plan.planSteps.length >= 3);
  });

  it('chains Daum Web Search with SEDMS document bridge', () => {
    const plan = planDeterministicEgoWorkflow({
      goal: '최신 TypeScript 보안 동향 검색해서 문서관리 열어줘',
      todayDate: '2026-11-22',
      colleagues: SAMPLE_COLLEAGUES,
    });
    const kinds = plan.actions.map((a) => a.kind);
    assert.ok(kinds.includes('kakao_web_search'));
    assert.ok(kinds.includes('sgw_sedms_menu'));
  });

  it('distinguishes explicit auto-submit leave vs interactive leave draft', () => {
    const draftPlan = planDeterministicEgoWorkflow({
      goal: '내일 연차 신청 준비해줘',
      todayDate: '2026-11-22',
      colleagues: SAMPLE_COLLEAGUES,
    });
    const draftAction = draftPlan.actions.find((a) => a.kind === 'sgw_leave_action');
    assert.ok(draftAction);
    assert.equal(draftAction?.autoExecuteLeave, false);

    const immediatePlan = planDeterministicEgoWorkflow({
      goal: '내일 연차 바로 등록해줘',
      todayDate: '2026-11-22',
      colleagues: SAMPLE_COLLEAGUES,
    });
    const immediateAction = immediatePlan.actions.find((a) => a.kind === 'sgw_leave_action');
    assert.ok(immediateAction);
    assert.equal(immediateAction?.autoExecuteLeave, true);
  });

  it('plans sgw_leave_history for conversational leave balance and past history goals', () => {
    const plan = planDeterministicEgoWorkflow({
      goal: '지난달 내 연차 기록이랑 남은 연차 몇일인지 조회해줘',
      todayDate: '2026-11-23',
      colleagues: SAMPLE_COLLEAGUES,
    });
    const kinds = plan.actions.map((a) => a.kind);
    assert.ok(kinds.includes('sgw_leave_history'));
    assert.ok(!kinds.includes('sgw_leave_action'));
    assert.ok(!kinds.includes('sgw_project_calendar'));
  });
});

