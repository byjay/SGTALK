import type { IntegrationActionSummary, MailMessage, Message, SedmsMenuKey, User } from './types';
import { formatFileSize, formatKoreanTime } from './logic';

export type ChatSearchFilter = 'all' | 'files' | 'links' | 'starred' | 'notices';

export type MessageSegment =
  | { kind: 'text'; value: string }
  | { kind: 'url'; value: string; href: string }
  | { kind: 'mention'; value: string; userId: string | 'all'; label: string }
  | { kind: 'code'; value: string };

const URL_REGEX = /https?:\/\/[^\s<>()]+/gi;
const CODE_OR_URL_REGEX = /(`[^`\n]+`|https?:\/\/[^\s<>()]+)/gi;

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return Array.from(
    new Set(
      matches.map((u) => u.replace(/[.,!?;:)\]]+$/, '')).filter((u) => /^https?:\/\//i.test(u)),
    ),
  );
}

/**
 * Splits a message string into safe text, clickable URLs, inline code spans, and @mentions
 * matched against active room members (plus @전체 / @모두).
 */
export function parseMessageSegments(text: string, roomMembers: User[]): MessageSegment[] {
  if (!text) return [];

  const humanMembers = roomMembers
    .filter((u) => u.role !== 'bot')
    .sort((a, b) => b.name.length - a.name.length);

  const mentionTokens: { token: string; userId: string | 'all'; label: string }[] = [
    { token: '@전체', userId: 'all', label: '@전체' },
    { token: '@모두', userId: 'all', label: '@모두' },
    ...humanMembers.map((u) => ({
      token: `@${u.name}`,
      userId: u.id,
      label: `@${u.name}`,
    })),
  ];

  const splitMentions = (chunk: string): MessageSegment[] => {
    if (!chunk) return [];
    const out: MessageSegment[] = [];
    let i = 0;
    let textStart = 0;

    while (i < chunk.length) {
      if (chunk[i] === '@') {
        const matched = mentionTokens.find((mt) => {
          if (!chunk.startsWith(mt.token, i)) return false;
          const nextChar = chunk[i + mt.token.length];
          return nextChar === undefined || /[\s.,!?:;()[\]님]/.test(nextChar);
        });
        if (matched) {
          if (i > textStart) {
            out.push({ kind: 'text', value: chunk.slice(textStart, i) });
          }
          out.push({
            kind: 'mention',
            value: matched.token,
            userId: matched.userId,
            label: matched.label,
          });
          i += matched.token.length;
          textStart = i;
          continue;
        }
      }
      i += 1;
    }

    if (textStart < chunk.length) {
      out.push({ kind: 'text', value: chunk.slice(textStart) });
    }
    return out;
  };

  const result: MessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(CODE_OR_URL_REGEX.source, 'gi');

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const raw = match[0];
    if (start > lastIndex) {
      result.push(...splitMentions(text.slice(lastIndex, start)));
    }

    if (raw.startsWith('`') && raw.endsWith('`') && raw.length >= 2) {
      result.push({ kind: 'code', value: raw.slice(1, -1) });
      lastIndex = start + raw.length;
    } else {
      const cleaned = raw.replace(/[.,!?;:)\]]+$/, '');
      const trailing = raw.slice(cleaned.length);
      result.push({ kind: 'url', value: cleaned, href: cleaned });
      if (trailing) {
        result.push({ kind: 'text', value: trailing });
      }
      lastIndex = start + raw.length;
    }
  }

  if (lastIndex < text.length) {
    result.push(...splitMentions(text.slice(lastIndex)));
  }

  return result;
}

export function extractMentionUserIds(text: string, roomMembers: User[]): string[] {
  const segments = parseMessageSegments(text, roomMembers);
  const ids = new Set<string>();
  for (const seg of segments) {
    if (seg.kind !== 'mention') continue;
    if (seg.userId === 'all') {
      ids.add('all');
    } else {
      ids.add(seg.userId);
    }
  }
  return Array.from(ids);
}

export interface ActiveComposerTrigger {
  kind: 'mention' | 'command';
  query: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Detects an active @mention or leading /slash command around cursorPos.
 */
export function detectComposerTrigger(text: string, cursorPos: number): ActiveComposerTrigger | null {
  const safePos = Math.max(0, Math.min(cursorPos, text.length));
  const before = text.slice(0, safePos);

  if (before.startsWith('/') && !/\s/.test(before)) {
    return {
      kind: 'command',
      query: before.slice(1).toLowerCase(),
      startIndex: 0,
      endIndex: safePos,
    };
  }

  const mentionMatch = before.match(/(?:^|[\s(])@([^\s@]{0,20})$/);
  if (mentionMatch) {
    const query = mentionMatch[1];
    const atIndex = before.lastIndexOf('@');
    return {
      kind: 'mention',
      query: query.toLowerCase(),
      startIndex: atIndex,
      endIndex: safePos,
    };
  }

  return null;
}

export function applyComposerTriggerReplacement(
  text: string,
  trigger: ActiveComposerTrigger,
  replacement: string,
): { nextText: string; nextCursor: number } {
  const prefix = text.slice(0, trigger.startIndex);
  const suffix = text.slice(trigger.endIndex);
  const needsTrailingSpace = suffix.startsWith(' ') ? '' : ' ';
  const inserted = `${replacement}${needsTrailingSpace}`;
  return {
    nextText: `${prefix}${inserted}${suffix}`,
    nextCursor: prefix.length + inserted.length,
  };
}

export function filterRoomMessages(
  messages: Message[],
  options: {
    query: string;
    filter: ChatSearchFilter;
    currentUserId: string;
    usersById?: Record<string, User>;
  },
): string[] {
  const normalizedQuery = options.query.trim().toLowerCase();

  return messages
    .filter((msg) => {
      if (msg.deleted || msg.recalled) return false;

      if (options.filter === 'files' && msg.type !== 'file' && msg.type !== 'image' && msg.type !== 'voice') {
        return false;
      }
      if (options.filter === 'links' && extractUrlsFromText(msg.content).length === 0) {
        return false;
      }
      if (
        options.filter === 'starred' &&
        !(msg.starredByUserIds ?? []).includes(options.currentUserId)
      ) {
        return false;
      }
      if (
        options.filter === 'notices' &&
        msg.type !== 'notice_alert' &&
        msg.type !== 'poll' &&
        msg.type !== 'leave_alert'
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      const contentMatch = msg.content.toLowerCase().includes(normalizedQuery);
      const fileMatch = msg.file?.filename.toLowerCase().includes(normalizedQuery) ?? false;
      const pollMatch = msg.poll?.question.toLowerCase().includes(normalizedQuery) ?? false;
      const voiceMatch = msg.voice?.transcript?.toLowerCase().includes(normalizedQuery) ?? false;
      const senderName = options.usersById?.[msg.senderId]?.name?.toLowerCase() ?? '';
      const senderMatch = senderName.includes(normalizedQuery);

      return contentMatch || fileMatch || pollMatch || voiceMatch || senderMatch;
    })
    .map((m) => m.id);
}

export function findFirstUnreadMessageId(
  sortedMessages: Message[],
  currentUserId: string,
): string | null {
  for (const msg of sortedMessages) {
    if (msg.type === 'system' || msg.deleted || msg.recalled) continue;
    if (msg.senderId === currentUserId) continue;
    if (!msg.readBy.includes(currentUserId)) {
      return msg.id;
    }
  }
  return null;
}

export function hasUnreadMentionForUser(
  messages: Message[],
  roomId: string,
  userId: string,
): boolean {
  return messages.some(
    (m) =>
      m.roomId === roomId &&
      !m.deleted &&
      !m.recalled &&
      m.senderId !== userId &&
      !m.readBy.includes(userId) &&
      Array.isArray(m.mentions) &&
      (m.mentions.includes(userId) || m.mentions.includes('all')),
  );
}

export function isMessageExpired(message: Message, nowMs = Date.now()): boolean {
  if (!message.expiresAt) return false;
  const exp = new Date(message.expiresAt).getTime();
  return !Number.isNaN(exp) && exp <= nowMs;
}

export function formatVoiceDuration(seconds: number): string {
  const safe = Math.max(1, Math.round(seconds));
  if (safe < 60) return `${safe}"`;
  const m = Math.floor(safe / 60);
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function getReadReceiptBreakdown(
  message: Message,
  roomMemberIds: string[],
  usersById: Record<string, User>,
): { readUsers: User[]; unreadUsers: User[] } {
  const readSet = new Set(message.readBy);
  const readUsers: User[] = [];
  const unreadUsers: User[] = [];

  for (const memberId of roomMemberIds) {
    const user = usersById[memberId];
    if (!user || user.role === 'bot') continue;
    if (readSet.has(memberId)) {
      readUsers.push(user);
    } else {
      unreadUsers.push(user);
    }
  }

  return { readUsers, unreadUsers };
}

export function buildTranscriptText(
  messages: Message[],
  usersById: Record<string, User>,
): string {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return sorted
    .map((msg) => {
      const sender = usersById[msg.senderId]?.name ?? '사원';
      const time = formatKoreanTime(msg.createdAt);
      const body =
        msg.type === 'file' || msg.type === 'image'
          ? `[파일] ${msg.file?.filename ?? msg.content}`
          : msg.type === 'voice'
            ? `[음성 ${formatVoiceDuration(msg.voice?.durationSec ?? 3)}] ${msg.voice?.transcript ?? ''}`
            : msg.type === 'poll'
              ? `[투표] ${msg.poll?.question ?? msg.content}`
              : msg.content;
      return `[${time}] ${sender}: ${body}`;
    })
    .join('\n');
}

export interface SedmsMenuCatalogItem {
  menuKey: SedmsMenuKey;
  system: 'SEDMS' | 'SGW';
  label: string;
  shortLabel: string;
  slashCommand: string;
  description: string;
  actionLabel: string;
}

export const SEDMS_MENU_CATALOG: SedmsMenuCatalogItem[] = [
  {
    menuKey: 'leave',
    system: 'SEDMS',
    label: 'SEDMS 연차·휴가 등록',
    shortLabel: '연차등록',
    slashCommand: '/연차',
    description: '대화/음성으로 본인 연차를 등록하고 SEDMS·전 사원에 연동 알림',
    actionLabel: '연차 등록 열기',
  },
  {
    menuKey: 'project-calendar',
    system: 'SGW',
    label: '프로젝트 달력 연동',
    shortLabel: '프로젝트 달력',
    slashCommand: '/달력',
    description: 'SGW·SEDMS 프로젝트 일정 및 마일스톤 달력 바로 열기/등록',
    actionLabel: '프로젝트 달력 열기',
  },
  {
    menuKey: 'meeting-memo',
    system: 'SGW',
    label: 'SGW 미팅메모 연동',
    shortLabel: '미팅메모',
    slashCommand: '/미팅메모',
    description: '대화·음성 메모를 SGW 미팅메모(회의록)로 바로 전송 및 조회',
    actionLabel: 'SGW 미팅메모 열기',
  },
  {
    menuKey: 'meeting',
    system: 'SGW',
    label: 'SGW 회의 바로 연동',
    shortLabel: '회의 연동',
    slashCommand: '/회의',
    description: 'SGW 실시간 화상/음성 회의실 생성 및 즉시 참여',
    actionLabel: '회의 바로 시작',
  },
  {
    menuKey: 'approval',
    system: 'SEDMS',
    label: 'SEDMS 전자결재',
    shortLabel: '전자결재',
    slashCommand: '/결재',
    description: 'SEDMS 결재 대기함 및 기안 문서 바로 열기',
    actionLabel: '전자결재 열기',
  },
  {
    menuKey: 'document',
    system: 'SEDMS',
    label: 'SEDMS 문서·도면 관리',
    shortLabel: '문서관리',
    slashCommand: '/문서',
    description: 'SEDMS 사내 문서함·도면·산출물 검색 및 열기',
    actionLabel: '문서관리 열기',
  },
  {
    menuKey: 'project',
    system: 'SEDMS',
    label: 'SEDMS 프로젝트 관리',
    shortLabel: '프로젝트',
    slashCommand: '/프로젝트',
    description: '진행 중인 SEDMS 프로젝트 워크스페이스 이동',
    actionLabel: '프로젝트 열기',
  },
  {
    menuKey: 'attendance',
    system: 'SEDMS',
    label: 'SEDMS 근태·출퇴근',
    shortLabel: '근태관리',
    slashCommand: '/근태',
    description: '금일 출퇴근·외근·회의 상태 및 근태 현황 연동',
    actionLabel: '근태관리 열기',
  },
  {
    menuKey: 'bmail',
    system: 'SGW',
    label: 'bmail 아웃룩 연동',
    shortLabel: 'bmail',
    slashCommand: '/메일',
    description: '자체 개발 아웃룩 메일(bmail) 바로 열기',
    actionLabel: 'bmail에서 열기',
  },
  {
    menuKey: 'dashboard',
    system: 'SEDMS',
    label: 'SEDMS 전체 포털',
    shortLabel: 'SEDMS 전체',
    slashCommand: '/sedms',
    description: 'SEDMS 그룹웨어 전체 메뉴 허브 열기',
    actionLabel: 'SEDMS 포털 열기',
  },
];

export type ParsedIntegrationCommand =
  | {
      matched: true;
      summary: IntegrationActionSummary;
    }
  | { matched: false };

/**
 * Parses natural Korean text or voice transcripts (and slash commands) in Self Chat / Chat Rooms
 * into standardized SEDMS/SGW integration bridge commands.
 */
export function parseSgwIntegrationCommand(rawText: string): ParsedIntegrationCommand {
  const text = rawText.trim();
  if (!text) return { matched: false };

  const lower = text.toLowerCase();
  const hasSlash = text.startsWith('/');
  const hasIntentVerb =
    /(열어|보여|이동|연동|등록|작성|시작|참여|실행|켜|확인|호출|만들|보내)/.test(text) || hasSlash;

  if (!hasIntentVerb) {
    return { matched: false };
  }

  const makePayload = (extra?: Record<string, string>): Record<string, string> => ({
    rawCommand: text,
    ...(extra ?? {}),
  });

  if (/^\/(달력|일정)/.test(lower) || /프로젝트\s*달력|달력|캘린더/.test(text)) {
    const isCreate = /(등록|추가|생성|작성)/.test(text);
    const isoDate = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return {
      matched: true,
      summary: {
        system: 'SGW',
        menuKey: 'project-calendar',
        title: isCreate ? 'SGW 프로젝트 달력 일정 등록 연동' : 'SGW 프로젝트 달력 열기',
        description: `요청 내용: "${text}"`,
        actionLabel: '프로젝트 달력 열기',
        payload: makePayload({
          action: isCreate ? 'create' : 'view',
          ...(isoDate ? { date: isoDate } : {}),
        }),
      },
    };
  }

  if (/^\/미팅메모/.test(lower) || /미팅\s*메모|회의록|회의\s*메모/.test(text)) {
    const isCreate = /(등록|추가|생성|작성|보내|저장|기록)/.test(text);
    return {
      matched: true,
      summary: {
        system: 'SGW',
        menuKey: 'meeting-memo',
        title: isCreate ? 'SGW 미팅메모 작성 연동' : 'SGW 미팅메모 열기',
        description: `전달 내용: "${text}"`,
        actionLabel: 'SGW 미팅메모 열기',
        payload: makePayload({
          action: isCreate ? 'create' : 'view',
          content: text.replace(/^\/미팅메모\s*/, '').trim(),
        }),
      },
    };
  }

  if (/^\/회의/.test(lower) || /화상\s*회의|회의\s*(열어|시작|참여|생성|연동|켜|잡아)/.test(text)) {
    const isJoin = /참여|입장/.test(text);
    return {
      matched: true,
      summary: {
        system: 'SGW',
        menuKey: 'meeting',
        title: isJoin ? 'SGW 회의 참여 연동' : 'SGW 새 회의 바로 시작',
        description: `요청 내용: "${text}"`,
        actionLabel: isJoin ? '회의 참여하기' : '회의 바로 시작',
        payload: makePayload({
          action: isJoin ? 'join' : 'start',
        }),
      },
    };
  }

  if (/^\/결재/.test(lower) || /전자\s*결재|결재\s*함|결재/.test(text)) {
    return {
      matched: true,
      summary: {
        system: 'SEDMS',
        menuKey: 'approval',
        title: 'SEDMS 전자결재 연동',
        description: `요청 내용: "${text}"`,
        actionLabel: '전자결재 열기',
        payload: makePayload(),
      },
    };
  }

  if (/^\/문서/.test(lower) || /문서\s*(함|관리|열어)|도면/.test(text)) {
    return {
      matched: true,
      summary: {
        system: 'SEDMS',
        menuKey: 'document',
        title: 'SEDMS 문서·도면 관리 연동',
        description: `요청 내용: "${text}"`,
        actionLabel: '문서관리 열기',
        payload: makePayload(),
      },
    };
  }

  if (/^\/프로젝트/.test(lower) || /프로젝트\s*(관리|목록|열어|현황)/.test(text)) {
    return {
      matched: true,
      summary: {
        system: 'SEDMS',
        menuKey: 'project',
        title: 'SEDMS 프로젝트 관리 연동',
        description: `요청 내용: "${text}"`,
        actionLabel: '프로젝트 열기',
        payload: makePayload(),
      },
    };
  }

  if (/^\/근태/.test(lower) || /근태|출근|퇴근/.test(text)) {
    return {
      matched: true,
      summary: {
        system: 'SEDMS',
        menuKey: 'attendance',
        title: 'SEDMS 근태·출퇴근 연동',
        description: `요청 내용: "${text}"`,
        actionLabel: '근태관리 열기',
        payload: makePayload(),
      },
    };
  }

  if (/^\/(bmail|메일)/.test(lower) || /\bbmail\b|비메일|아웃룩/.test(lower)) {
    return {
      matched: true,
      summary: {
        system: 'SGW',
        menuKey: 'bmail',
        title: '자체 아웃룩 bmail 연동',
        description: `요청 내용: "${text}"`,
        actionLabel: 'bmail에서 열기',
        payload: makePayload(),
      },
    };
  }

  if (/^\/sedms/.test(lower) || /sedms\s*(메뉴|포털|열어|전체)/i.test(text)) {
    return {
      matched: true,
      summary: {
        system: 'SEDMS',
        menuKey: 'dashboard',
        title: 'SEDMS 그룹웨어 전체 메뉴 연동',
        description: `요청 내용: "${text}"`,
        actionLabel: 'SEDMS 포털 열기',
        payload: makePayload(),
      },
    };
  }

  return { matched: false };
}

export function sanitizeSafeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeDraftsMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string' && v.length > 0 && k.length <= 128) {
      result[k] = v.slice(0, 8000);
    }
  }
  return result;
}

export type InChatQuickIntent =
  | { kind: 'notice'; urgent: boolean; prefillTitle?: string; prefillContent?: string }
  | { kind: 'poll' }
  | { kind: 'schedule_card' }
  | { kind: 'draw' }
  | { kind: 'nas' }
  | { kind: 'file' }
  | { kind: 'mail'; tab: 'inbox' | 'compose' }
  | { kind: 'alerts' }
  | { kind: 'summary' }
  | { kind: 'scheduled_msg' }
  | { kind: 'export_transcript' }
  | { kind: 'view_once' };

function splitInlineTitleAndBody(raw: string): { title?: string; body?: string } {
  const cleaned = raw.trim();
  if (!cleaned) return {};
  const colonIdx = cleaned.indexOf(':');
  if (colonIdx > 0 && colonIdx < 40) {
    const title = cleaned.slice(0, colonIdx).trim();
    const body = cleaned.slice(colonIdx + 1).trim();
    return {
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
    };
  }
  return { body: cleaned };
}

/**
 * Recognizes slash commands and clear Korean action intents that should execute
 * directly inside the Talk chat room without leaving the conversation.
 */
export function detectInChatQuickIntent(rawText: string): InChatQuickIntent | null {
  const text = rawText.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  // 1. Slash commands (exact or with trailing inline args)
  if (/^\/(긴급공지|재난문자)(?:\s+(.+))?$/s.test(text)) {
    const arg = text.replace(/^\/(긴급공지|재난문자)\s*/s, '').trim();
    const { title, body } = splitInlineTitleAndBody(arg);
    return { kind: 'notice', urgent: true, prefillTitle: title, prefillContent: body };
  }
  if (/^\/공지(?:\s+(.+))?$/s.test(text)) {
    const arg = text.replace(/^\/공지\s*/s, '').trim();
    const { title, body } = splitInlineTitleAndBody(arg);
    return { kind: 'notice', urgent: false, prefillTitle: title, prefillContent: body };
  }
  if (/^\/투표(?:\s|$)/.test(lower)) return { kind: 'poll' };
  if (/^\/일정(?:\s|$)/.test(lower)) return { kind: 'schedule_card' };
  if (/^\/추첨(?:\s|$)/.test(lower)) return { kind: 'draw' };
  if (/^\/(나스|nas|대용량)(?:\s|$)/i.test(lower)) return { kind: 'nas' };
  if (/^\/파일(?:\s|$)/.test(lower)) return { kind: 'file' };
  if (/^\/(메일쓰기|메일작성|메일보내기)(?:\s|$)/.test(lower)) {
    return { kind: 'mail', tab: 'compose' };
  }
  if (/^\/(메일|빅메일|비메일|bmail|bigmail)(?:\s|$)/i.test(lower)) {
    return { kind: 'mail', tab: /쓰기|작성|보내/.test(text) ? 'compose' : 'inbox' };
  }
  if (/^\/(알림|알람)(?:\s|$)/.test(lower)) return { kind: 'alerts' };
  if (/^\/(요약|대화요약|정리)(?:\s|$)/.test(lower)) return { kind: 'summary' };
  if (/^\/예약(?:\s|$)/.test(lower)) return { kind: 'scheduled_msg' };
  if (/(^\/(비밀|1회열람|보안메시지)(?:\s|$))/.test(lower)) return { kind: 'view_once' };
  if (/(대화저장|내보내기|백업)/.test(lower) && lower.startsWith('/')) {
    return { kind: 'export_transcript' };
  }

  // 2. Natural Korean intent commands (typed in composer or spoken via voice bar)
  const hasActionVerb = /(해줘|해주세요|열어|보여|확인|조회|작성|등록|올려|만들|보내|전송|실행|정해|뽑아|시작|저장|내보내|요약|브리핑)/.test(
    text,
  );
  if (!hasActionVerb) return null;

  if (/(긴급\s*공지|재난\s*문자|긴급\s*알림)/.test(text)) {
    return { kind: 'notice', urgent: true };
  }
  if (/공지\s*(등록|올려|띄워|작성|열어)/.test(text)) {
    return { kind: 'notice', urgent: false };
  }
  if (/(nas|나스|100\s*기가|100gb|대용량\s*(링크|공유|폴더|전송))/i.test(text)) {
    return { kind: 'nas' };
  }
  if (/(메일|빅메일|비메일|bmail|bigmail)/i.test(text)) {
    if (/(보내|작성|쓰기|발송|전송)/.test(text)) {
      return { kind: 'mail', tab: 'compose' };
    }
    return { kind: 'mail', tab: 'inbox' };
  }
  if (/(전체\s*알[림람]|미확인\s*알[림람]|알[림람]\s*(브리핑|확인|열어|보여))/.test(text)) {
    return { kind: 'alerts' };
  }
  if (/(대화|채팅|방|지금까지)\s*(내용\s*)?(요약|정리)/.test(text)) {
    return { kind: 'summary' };
  }
  if (/(투표\s*(만들|올려|열어|시작)|팀\s*투표)/.test(text)) {
    return { kind: 'poll' };
  }
  if (/(일정\s*(카드|공유)|참석\s*확인\s*(만들|올려))/.test(text)) {
    return { kind: 'schedule_card' };
  }
  if (/(랜덤\s*추첨|당번\s*(뽑|정하|추첨)|사다리)/.test(text)) {
    return { kind: 'draw' };
  }
  if (/(예약\s*(전송|메시지)|메시지\s*예약)/.test(text)) {
    return { kind: 'scheduled_msg' };
  }
  if (/(대화\s*(저장|내보내기)|텍스트\s*저장)/.test(text)) {
    return { kind: 'export_transcript' };
  }
  if (/(1회\s*열람|비밀\s*메시지|시크릿\s*메시지)/.test(text)) {
    return { kind: 'view_once' };
  }

  return null;
}

export interface RoomSummaryResult {
  summaryText: string;
  bullets: string[];
  messageCount: number;
}

/**
 * Pure deterministic room conversation summarizer for instant offline/online /요약 inside Talk.
 */
export function summarizeRoomMessagesPure(
  roomName: string,
  messages: Message[],
  usersById: Record<string, User>,
): RoomSummaryResult {
  const valid = messages.filter((m) => !m.recalled);
  if (valid.length === 0) {
    return {
      summaryText: `${roomName}에 아직 요약할 대화가 없습니다.`,
      bullets: ['대화 내용이 아직 없습니다.'],
      messageCount: 0,
    };
  }

  const recent = valid.slice(-25);
  const participants = Array.from(
    new Set(
      recent
        .map((m) => usersById[m.senderId]?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  );

  const fileMsgs = recent.filter((m) => m.type === 'file' || m.type === 'image');
  const urgentOrNoticeMsgs = recent.filter((m) => m.type === 'notice_alert');
  const pollOrScheduleMsgs = recent.filter(
    (m) => m.type === 'poll' || m.type === 'schedule_card',
  );
  const textAndVoiceMsgs = recent.filter(
    (m) =>
      (m.type === 'text' || m.type === 'voice') &&
      m.senderId !== 'u-bot' &&
      !m.content.startsWith('[대화 요약]'),
  );

  const bullets: string[] = [];
  bullets.push(
    `참여 현황: ${participants.slice(0, 5).join(', ')}${
      participants.length > 5 ? ` 외 ${participants.length - 5}명` : ''
    } (최근 ${recent.length}건 분석)`,
  );

  if (urgentOrNoticeMsgs.length > 0) {
    const latestNotice = urgentOrNoticeMsgs[urgentOrNoticeMsgs.length - 1];
    bullets.push(
      `공지·전파: ${latestNotice.noticeAlert?.title ?? latestNotice.content.slice(0, 48)}`,
    );
  }

  if (pollOrScheduleMsgs.length > 0) {
    const latestCard = pollOrScheduleMsgs[pollOrScheduleMsgs.length - 1];
    bullets.push(
      latestCard.poll
        ? `진행 중 투표: "${latestCard.poll.question}"`
        : `공유 일정: "${latestCard.scheduleCard?.title ?? latestCard.content}"`,
    );
  }

  if (fileMsgs.length > 0) {
    const fileNames = fileMsgs
      .slice(-2)
      .map((m) => m.file?.filename ?? m.content)
      .join(', ');
    bullets.push(`공유 파일(${fileMsgs.length}건): ${fileNames}`);
  }

  const keyLines = textAndVoiceMsgs.slice(-3);
  for (const m of keyLines) {
    const sender = usersById[m.senderId]?.name ?? '사원';
    const raw =
      m.type === 'voice'
        ? `[음성] ${m.voice?.transcript ?? m.content}`
        : m.content;
    const singleLine = raw.replace(/\s+/g, ' ').trim();
    const clipped = singleLine.length > 68 ? `${singleLine.slice(0, 68)}...` : singleLine;
    bullets.push(`${sender}: ${clipped}`);
  }

  const summaryText = [
    `[대화 요약] ${roomName} (최근 ${recent.length}건)`,
    ...bullets.map((b) => `• ${b}`),
  ].join('\n');

  return {
    summaryText,
    bullets,
    messageCount: recent.length,
  };
}

export interface InChatMailDraft {
  provider: 'bigmail' | 'bmail';
  recipientIds: string[];
  subject: string;
  body: string;
  existingAttachmentIds: string[];
  inReplyToMailId?: string | null;
}

/**
 * Masks sensitive 1-time-view message body unless the current user is the original sender.
 * Recipients reveal the real content once via POST /api/messages/:messageId/view-once.
 */
export function maskViewOnceMessageForUser(msg: Message, viewerUserId: string): Message {
  if (!msg.viewOnce || msg.deleted || msg.recalled) return msg;
  if (msg.senderId === viewerUserId) return msg;
  const viewed = (msg.viewedByUserIds ?? []).includes(viewerUserId);
  return {
    ...msg,
    content: viewed ? '1회 열람이 완료되어 보안 잠금된 메시지입니다.' : '🔒 1회 열람 비밀 메시지',
  };
}

/**
 * Converts one or more chat messages (including shared files and 100GB+ NAS packages)
 * into a pre-filled bmail/BigMail draft ready to send directly inside SG Talk.
 */
export function buildMailDraftFromMessagesPure(
  roomName: string,
  pickedMessages: Message[],
  usersById: Record<string, User>,
): InChatMailDraft {
  const valid = pickedMessages.filter((m) => !m.deleted && !m.recalled && !m.viewOnce);
  const existingAttachmentIds = Array.from(
    new Set(
      valid
        .map((m) => m.file?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const hasLargeOrNas = valid.some(
    (m) => Boolean(m.file?.isLargeFile || m.file?.nasFolder || (m.file?.size ?? 0) >= 1024 * 1024 * 50),
  );
  const firstFile = valid.find((m) => m.file)?.file;
  const subject =
    valid.length === 1 && firstFile
      ? `[SG Talk 전달] ${firstFile.filename}`
      : `[SG Talk 전달] ${roomName} 대화 내용 (${valid.length}건)`;

  const lines = valid.map((m) => {
    const sender = usersById[m.senderId]?.name ?? '사원';
    const time = formatKoreanTime(m.createdAt);
    if (m.file) {
      const nasHint = m.file.nasFolder ? ` [NAS:${m.file.nasFolder}]` : '';
      const linkHint = m.file.nasExternalAccessUrl || m.file.shareUrl || '';
      return `[${time}] ${sender}: 📎 ${m.file.filename} (${formatFileSize(m.file.size)})${nasHint}${
        linkHint ? `\n   링크: ${linkHint}` : ''
      }`;
    }
    if (m.type === 'voice') {
      return `[${time}] ${sender}: [음성 메시지] ${m.voice?.transcript ?? m.content}`;
    }
    return `[${time}] ${sender}: ${m.content}`;
  });

  const body =
    lines.length > 0
      ? `SG Talk [${roomName}] 대화방에서 전달된 내용입니다.\n\n${lines.join('\n')}`
      : `SG Talk [${roomName}] 대화방 공유 내용입니다.`;

  return {
    provider: hasLargeOrNas || existingAttachmentIds.length > 0 ? 'bigmail' : 'bmail',
    recipientIds: [],
    subject,
    body,
    existingAttachmentIds,
  };
}

/**
 * Prepares a reply, reply-all, or forward draft for any incoming/sent bmail or BigMail.
 */
export function buildMailReplyDraftPure(
  mail: MailMessage,
  senderName: string,
  mode: 'reply' | 'replyAll' | 'forward',
  currentUserId: string,
): InChatMailDraft {
  const provider: 'bigmail' | 'bmail' = mail.provider === 'bigmail' ? 'bigmail' : 'bmail';
  const cleanSubject = mail.subject.replace(/^(Re|Fwd):\s*/i, '').trim();
  const subject = mode === 'forward' ? `Fwd: ${cleanSubject}` : `Re: ${cleanSubject}`;

  let recipientIds: string[] = [];
  if (mode === 'reply') {
    recipientIds = mail.senderId !== currentUserId ? [mail.senderId] : [...mail.recipientIds];
  } else if (mode === 'replyAll') {
    recipientIds = Array.from(
      new Set([mail.senderId, ...mail.recipientIds].filter((id) => id && id !== currentUserId)),
    );
  }

  const attachmentNotes =
    (mail.attachments?.length ?? 0) > 0
      ? `\n첨부: ${(mail.attachments ?? []).map((a) => `${a.filename} (${formatFileSize(a.size)})`).join(', ')}`
      : '';

  const quotedBody = [
    '',
    '--- 원본 메일 ---',
    `보낸사람: ${senderName}`,
    `제목: ${mail.subject}${attachmentNotes}`,
    '',
    mail.body,
  ].join('\n');

  const existingAttachmentIds =
    mode === 'forward'
      ? (mail.attachments ?? []).filter((a) => !a.revoked).map((a) => a.id)
      : [];

  return {
    provider,
    recipientIds,
    subject,
    body: quotedBody,
    existingAttachmentIds,
    inReplyToMailId: mode === 'forward' ? null : mail.id,
  };
}

