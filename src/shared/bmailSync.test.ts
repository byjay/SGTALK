import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBmailEmbedLaunchUrl,
  buildSgwChatMessageDto,
  buildSgwChatRoomDto,
  buildSgwDirectMessageDto,
  buildSgwEmployeeDto,
  mapRemoteBmailItemToMailMessage,
  normalizeBmailLedgerBatch,
} from './bmailSync';
import {
  signSgwSsoTokenForBmail,
  verifySgwSsoTokenFromBmail,
} from '../../server/bmailBridge';
import type { ChatRoom, Message, User } from './types';

const user1: User = {
  id: 'u1',
  name: '김민준',
  email: 'minjun@sgw.co.kr',
  department: '프로덕트 개발팀',
  position: '팀장',
  phone: '010-1111-1111',
  avatarUrl: '',
  statusMessage: '업무 중',
  presenceStatus: 'online',
  role: 'admin',
  totalLeaveDays: 15,
  usedLeaveDays: 3,
  online: true,
  lastSeen: '2026-11-25T05:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const user2: User = {
  ...user1,
  id: 'u2',
  name: '이서연',
  email: 'seoyeon@sgw.co.kr',
  role: 'member',
  position: '선임',
};

test('signSgwSsoTokenForBmail produces HMAC-SHA256 hex token verifiable by byjay/bmail rules', () => {
  const nowSec = 1_800_000_000;
  const secret = 'test-sgw-sso-secret-32bytes-abcdef';
  const token = signSgwSsoTokenForBmail(user1, secret, { nowSec, ttlSec: 300, nonce: 'nonce-1' });

  const verified = verifySgwSsoTokenFromBmail(token, secret, nowSec + 10);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload?.sub, 'u1');
  assert.equal(verified.payload?.nonce, 'nonce-1');

  const expired = verifySgwSsoTokenFromBmail(token, secret, nowSec + 301);
  assert.equal(expired.ok, false);

  const wrongSecret = verifySgwSsoTokenFromBmail(token, 'wrong-secret', nowSec + 10);
  assert.equal(wrongSecret.ok, false);

  const url = buildBmailEmbedLaunchUrl('https://bmail.sgw.co.kr/', token);
  assert.equal(url.startsWith('https://bmail.sgw.co.kr/sgw/mail?embed=sgw&sso_token='), true);
});

test('SGW chat/DM DTO mappers match byjay/bmail sgwChatBridge shapes', () => {
  const emp = buildSgwEmployeeDto(user1);
  assert.equal(emp.sub, 'u1');
  assert.equal(emp.id, 'u1');

  const room: ChatRoom = {
    id: 'dm-1',
    name: '이서연',
    description: '',
    type: 'direct',
    memberIds: ['u1', 'u2'],
    pinnedByUserIds: [],
    mutedByUserIds: [],
    activeNoticeId: null,
    createdAt: '2026-11-25T01:00:00.000Z',
    updatedAt: '2026-11-25T01:05:00.000Z',
  };

  const msg: Message = {
    id: 'msg-1',
    roomId: 'dm-1',
    senderId: 'u1',
    type: 'text',
    content: '135K-01 도면 확인 부탁드립니다.',
    replyToId: null,
    reactions: { '👍': ['u2'] },
    readBy: ['u1'],
    createdAt: '2026-11-25T01:05:00.000Z',
  };

  const roomDto = buildSgwChatRoomDto(room, [msg], 'u2');
  assert.equal(roomDto.unreadCount, 1);
  assert.equal(roomDto.lastMessageSenderId, 'u1');

  const chatDto = buildSgwChatMessageDto(msg);
  assert.equal(chatDto.roomId, 'dm-1');
  assert.equal(chatDto.hasFile, false);

  const dmDto = buildSgwDirectMessageDto(msg, room, { u1: user1, u2: user2 });
  assert.equal(dmDto.receiverId, 'u2');
  assert.equal(dmDto.receiverName, '이서연');
  assert.equal(dmDto.isRead, false);
});

test('normalizeBmailLedgerBatch and mapRemoteBmailItemToMailMessage parse bmail payloads accurately', () => {
  const batch = normalizeBmailLedgerBatch([
    {
      bmail_uid: 'bm-1001',
      direction: 'recv',
      mail_date: '2026-11-25',
      mail_timestamp: '2026-11-25T09:15:00+09:00',
      sender: '발주처 <client@ship.test>',
      recipients: 'minjun@sgw.co.kr',
      subject: '[135K-01] 승인 도면 송부',
      body_snippet: '첨부 도면 검토 요청',
      attachments: [{ filename: '135K-01_GA.dwg', size_bytes: 204800 }],
      action_status: 'need_reply',
      source_system: 'BMAIL_DESKTOP_V12',
    },
    { bmail_uid: '' }, // invalid skipped
  ]);

  assert.equal(batch.length, 1);
  assert.equal(batch[0].bmail_uid, 'bm-1001');
  assert.equal(batch[0].projectCode, '135K-01');
  assert.equal(batch[0].action_status, 'need_reply');

  const converted = mapRemoteBmailItemToMailMessage(
    {
      id: 'sgw-mail-77',
      threadId: 'thr-1',
      senderSub: 'u2',
      senderName: '이서연',
      subject: '배전반 사양서 전달',
      body: 'NAS 링크 및 사양서 첨부드립니다.',
      createdAt: '2026-11-25T09:20:00.000Z',
      attachments: [{ id: 'att-1', filename: 'spec.zip', sizeBytes: 50_000_000 }],
    },
    'u1',
    { u1: user1, u2: user2 },
  );
  assert.equal(converted.provider, 'bigmail');
  assert.equal(converted.senderId, 'u2');
  assert.equal(converted.inReplyToMailId, 'thr-1');
});
