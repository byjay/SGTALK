import type { Notice, NoticePriority, User } from './types';

export function normalizeNoticePriority(input: {
  priority?: unknown;
  isUrgent?: unknown;
}): NoticePriority {
  if (input.isUrgent === true || input.priority === 'urgent') return 'urgent';
  if (input.priority === 'important') return 'important';
  return 'normal';
}

export function getNoticePriorityMeta(priority: NoticePriority): {
  label: string;
  badgeText: string;
  emergencyPrefix: string;
} {
  switch (priority) {
    case 'urgent':
      return {
        label: '긴급 재난문자 공지',
        badgeText: '긴급 재난문자',
        emergencyPrefix: '[긴급재난문자]',
      };
    case 'important':
      return {
        label: '중요 공지',
        badgeText: '중요',
        emergencyPrefix: '[중요 공지]',
      };
    default:
      return {
        label: '일반 공지',
        badgeText: '공지',
        emergencyPrefix: '[공지]',
      };
  }
}

export function toggleNoticeAckList(
  existing: string[] | undefined,
  userId: string,
): string[] {
  const list = Array.isArray(existing) ? existing : [];
  if (!userId) return list;
  if (list.includes(userId)) {
    return list;
  }
  return [...list, userId];
}

export function computeNoticeAckStats(
  notice: Pick<Notice, 'acknowledgedBy' | 'authorId'>,
  memberIds: string[],
  usersById?: Record<string, User>,
): {
  ackCount: number;
  totalHumanMembers: number;
  acknowledgedIds: string[];
  acknowledgedNames: string[];
  unacknowledgedNames: string[];
} {
  const humanMemberIds = Array.from(new Set(memberIds)).filter((id) => {
    if (!usersById) return true;
    const u = usersById[id];
    return !u || u.role !== 'bot';
  });

  const rawAck = Array.isArray(notice.acknowledgedBy) ? notice.acknowledgedBy : [];
  const ackSet = new Set(rawAck);
  if (notice.authorId && !ackSet.has(notice.authorId)) {
    ackSet.add(notice.authorId);
  }

  const acknowledgedIds = humanMemberIds.filter((id) => ackSet.has(id));
  const unacknowledgedIds = humanMemberIds.filter((id) => !ackSet.has(id));

  return {
    ackCount: acknowledgedIds.length,
    totalHumanMembers: Math.max(humanMemberIds.length, acknowledgedIds.length),
    acknowledgedIds,
    acknowledgedNames: acknowledgedIds.map((id) => usersById?.[id]?.name ?? id),
    unacknowledgedNames: unacknowledgedIds.map((id) => usersById?.[id]?.name ?? id),
  };
}

export function formatEmergencyDisasterNoticeText(input: {
  title: string;
  content: string;
  senderName: string;
  roomName: string;
}): {
  headerLabel: string;
  headline: string;
  summaryBody: string;
  metaLine: string;
} {
  const cleanTitle = input.title.trim() || '전 회원 긴급 공지';
  const cleanContent = input.content.trim();
  const cleanSender = input.senderName.trim() || '관리자';
  const cleanRoom = input.roomName.trim() || '전사 공지';
  return {
    headerLabel: '[긴급재난문자 · SG Talk 전 회원 알림]',
    headline: cleanTitle,
    summaryBody: cleanContent,
    metaLine: `${cleanSender} 발송 · ${cleanRoom}`,
  };
}

export function sortNoticesPinnedFirst(notices: Notice[]): Notice[] {
  return [...notices].sort((a, b) => {
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    const aUrg = a.isUrgent || a.priority === 'urgent' ? 1 : 0;
    const bUrg = b.isUrgent || b.priority === 'urgent' ? 1 : 0;
    if (aUrg !== bUrg) return bUrg - aUrg;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
