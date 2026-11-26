import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNasRelativePath,
  buildRoomTranscriptExportText,
  parseDrawCandidates,
  parseHttpRangeHeader,
  sanitizeNasFilename,
  sanitizeNasFolder,
  toggleScheduleRsvpLists,
  validateNasShareRequest,
  validateScheduleCardInput,
} from './nasShare';
import type { Message, ScheduleCardData, User } from './types';

test('sanitizeNasFolder and sanitizeNasFilename block path traversal cleanly', () => {
  assert.equal(sanitizeNasFolder('../../etc/passwd'), 'etc/passwd');
  assert.equal(sanitizeNasFolder('  \\AI-데이터셋\\2026\\ '), 'AI-데이터셋/2026');
  assert.equal(sanitizeNasFolder('..'), '전사-공유');

  assert.equal(sanitizeNasFilename('../../secret/backup.tar.gz'), 'backup.tar.gz');
  assert.equal(sanitizeNasFilename('..'), '');
  assert.equal(
    buildNasRelativePath('AI-데이터셋', 'model_100gb.tar.zst'),
    'AI-데이터셋/model_100gb.tar.zst',
  );
});

test('parseHttpRangeHeader handles standard, open-ended, suffix, and invalid ranges', () => {
  assert.deepEqual(parseHttpRangeHeader('bytes=0-99', 1000), { ok: true, start: 0, end: 99 });
  assert.deepEqual(parseHttpRangeHeader('bytes=500-', 1000), { ok: true, start: 500, end: 999 });
  assert.deepEqual(parseHttpRangeHeader('bytes=-200', 1000), { ok: true, start: 800, end: 999 });
  assert.deepEqual(parseHttpRangeHeader('bytes=200-10000', 1000), { ok: true, start: 200, end: 999 });
  assert.deepEqual(parseHttpRangeHeader('bytes=1500-2000', 1000), { ok: false, unsatisfiable: true });
  assert.equal(parseHttpRangeHeader(undefined, 1000), null);
});

test('validateNasShareRequest supports internal NAS copy without custom external URL and with PIN', () => {
  const autoGateway = validateNasShareRequest({
    nasFolder: 'AI-데이터셋',
    filename: '학습_가중치_100GB.tar.zst',
    sizeValue: 100,
    sizeUnit: 'GB',
    expiresDays: 14,
    passcode: '4321',
    maxDownloads: 5,
  });
  assert.equal(autoGateway.ok, true);
  if (autoGateway.ok) {
    assert.equal(autoGateway.nasFolder, 'AI-데이터셋');
    assert.equal(autoGateway.nasRelativePath, 'AI-데이터셋/학습_가중치_100GB.tar.zst');
    assert.equal(autoGateway.externalNasUrl, null);
    assert.equal(autoGateway.shareProvider, 'nas');
    assert.equal(autoGateway.passcode, '4321');
    assert.equal(autoGateway.maxDownloads, 5);
    assert.equal(autoGateway.sizeBytes, 100 * 1024 * 1024 * 1024);
  }

  const invalidIp = validateNasShareRequest({
    nasFolder: '전사-공유',
    filename: 'archive.zip',
    externalNasUrl: 'http://192.168.0.10/share',
  });
  assert.equal(invalidIp.ok, false);
});

test('KakaoTalk schedule RSVP, lottery candidates, and transcript export helpers work accurately', () => {
  const validSched = validateScheduleCardInput({
    title: 'Q4 대용량 NAS 아키텍처 리뷰',
    dateTime: '2026-11-26 14:00',
    location: '본사 5층 대회의실',
  });
  assert.equal(validSched.ok, true);

  let card: ScheduleCardData = {
    title: '주간 스프린트',
    dateTime: '2026-11-25 10:00',
    attendeesYes: ['u1'],
    attendeesMaybe: [],
    attendeesNo: [],
  };
  card = toggleScheduleRsvpLists(card, 'u2', 'yes');
  assert.deepEqual(card.attendeesYes, ['u1', 'u2']);
  card = toggleScheduleRsvpLists(card, 'u2', 'no');
  assert.deepEqual(card.attendeesYes, ['u1']);
  assert.deepEqual(card.attendeesNo, ['u2']);
  // Clicking 'no' again toggles off
  card = toggleScheduleRsvpLists(card, 'u2', 'no');
  assert.deepEqual(card.attendeesNo, []);

  assert.deepEqual(parseDrawCandidates('김민준, 이서연\n박지훈, 김민준'), ['김민준', '이서연', '박지훈']);

  const usersById = {
    'u-1': { id: 'u-1', name: '김민준' } as User,
  };
  const msgs: Message[] = [
    {
      id: 'm1',
      roomId: 'r1',
      senderId: 'u-1',
      type: 'file',
      content: 'NAS 공유',
      replyToId: null,
      reactions: {},
      readBy: ['u-1'],
      createdAt: '2026-11-24T12:00:00.000Z',
      file: {
        id: 'f1',
        filename: 'dataset.tar',
        mimeType: 'application/octet-stream',
        size: 1024,
        url: '/api/files/f1/download',
        isImage: false,
        nasFolder: 'AI-데이터셋',
      },
    },
  ];
  const exported = buildRoomTranscriptExportText('프로덕트 개발팀', msgs, usersById);
  assert.match(exported, /프로덕트 개발팀/);
  assert.match(exported, /\[NAS: AI-데이터셋\]/);
});
