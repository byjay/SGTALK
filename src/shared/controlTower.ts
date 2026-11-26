import type {
  MailMessage,
  MailProvider,
  Notice,
  NoticeScope,
  SedmsMenuKey,
} from './types';
import { parseSgwIntegrationCommand } from './chatLogic';

export interface ConciseMailDigest {
  provider: MailProvider;
  providerLabel: string;
  senderName: string;
  subject: string;
  shortSummary: string;
  attachmentCount: number;
  attachmentNames: string[];
  attachmentLabel: string;
  alertTitle: string;
  alertBody: string;
}

export function getMailProviderLabel(provider?: MailProvider): string {
  return provider === 'bigmail' ? '빅메일' : '비메일';
}

export function buildConciseMailDigest(
  mail: Pick<MailMessage, 'provider' | 'subject' | 'body' | 'shortSummary' | 'attachments'>,
  senderName: string,
): ConciseMailDigest {
  const provider: MailProvider = mail.provider === 'bigmail' ? 'bigmail' : 'bmail';
  const providerLabel = getMailProviderLabel(provider);

  const rawBody = String(mail.shortSummary || mail.body || '')
    .replace(/\s+/g, ' ')
    .trim();

  const shortSummary =
    rawBody.length > 72 ? `${rawBody.slice(0, 72)}…` : rawBody || mail.subject;

  const attachments = Array.isArray(mail.attachments) ? mail.attachments : [];
  const attachmentCount = attachments.length;
  const attachmentNames = attachments.map((a) => a.filename).filter(Boolean);

  const attachmentLabel =
    attachmentCount === 0
      ? '첨부 없음'
      : attachmentCount === 1
        ? `📎 ${attachmentNames[0]}`
        : `📎 ${attachmentNames[0]} 외 ${attachmentCount - 1}개`;

  const alertTitle = `[${providerLabel}] ${senderName} · ${mail.subject}`;
  const alertBody = `내용 요약: ${shortSummary} (${attachmentLabel})`;

  return {
    provider,
    providerLabel,
    senderName,
    subject: mail.subject,
    shortSummary,
    attachmentCount,
    attachmentNames,
    attachmentLabel,
    alertTitle,
    alertBody,
  };
}

export function summarizeMailBodyPure(
  mail: Pick<MailMessage, 'provider' | 'subject' | 'body' | 'attachments'>,
  senderName?: string,
): string[] {
  const providerLabel = getMailProviderLabel(mail.provider);
  const cleanLines = String(mail.body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('---') && !l.startsWith('['));

  const bullets: string[] = [];
  bullets.push(
    `[${providerLabel}] ${senderName ? `${senderName} 발신 · ` : ''}${mail.subject}`,
  );

  if (cleanLines.length > 0) {
    bullets.push(`핵심 요지: ${cleanLines.slice(0, 2).join(' ').slice(0, 140)}`);
  }

  const attachments = mail.attachments ?? [];
  if (attachments.length > 0) {
    const names = attachments.map((a) => a.filename).join(', ');
    bullets.push(`첨부 파일(${attachments.length}건): ${names}`);
  } else {
    const actionLine = cleanLines.find((l) => /(부탁|확인|요청|참석|검토|회신|승인)/.test(l));
    bullets.push(
      actionLine
        ? `후속 조치: ${actionLine.slice(0, 120)}`
        : '첨부 파일 없음 · 상세 보기에서 회신 또는 채팅방 공유 가능',
    );
  }

  return bullets.slice(0, 3);
}

export function filterNoticesByScope(
  notices: Notice[],
  currentUserId: string,
  scope: NoticeScope | 'all',
): Notice[] {
  const visible = notices.filter((n) => {
    const s = n.scope ?? 'room';
    if (s === 'personal') {
      return n.ownerUserId === currentUserId || n.authorId === currentUserId;
    }
    return true;
  });

  const scoped =
    scope === 'all'
      ? visible
      : visible.filter((n) => (n.scope ?? 'room') === scope);

  return [...scoped].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export type ControlTowerIntent =
  | { kind: 'mail_summarize'; provider?: MailProvider }
  | { kind: 'mail_open'; provider?: MailProvider; query?: string }
  | { kind: 'mail_list'; provider?: MailProvider }
  | { kind: 'notice_create_global'; title: string; content: string }
  | { kind: 'notice_create_personal'; title: string; content: string }
  | { kind: 'notice_list'; scope: 'global' | 'personal' | 'all' }
  | { kind: 'alerts_briefing' }
  | { kind: 'chat_briefing' }
  | { kind: 'large_link_open' }
  | { kind: 'leave_info' }
  | { kind: 'sedms_action'; menuKey: SedmsMenuKey; rawText: string }
  | { kind: 'general_briefing'; rawText: string };

export function parseControlTowerCommand(
  rawText: string,
  _todayDate?: string,
): ControlTowerIntent {
  const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return { kind: 'alerts_briefing' };
  }

  const lower = text.toLowerCase();
  const provider: MailProvider | undefined =
    /빅메일|bigmail/.test(lower)
      ? 'bigmail'
      : /비메일|bmail|아웃룩/.test(lower)
        ? 'bmail'
        : undefined;

  // 1. Notice creation (personal vs global)
  if (/개인\s*공지/.test(text) && /(등록|추가|작성|저장|올려|만들|메모)/.test(text)) {
    const stripped = text
      .replace(/^.*?개인\s*공지(?:사항)?\s*(?:등록|추가|작성|저장|올려줘|만들어줘|:|-)?\s*/i, '')
      .trim();
    const content = stripped || text;
    return {
      kind: 'notice_create_personal',
      title: `개인 공지 · ${content.slice(0, 28)}`,
      content,
    };
  }

  if (/(전체\s*(?:업무\s*)?공지|업무\s*공지|전사\s*공지)/.test(text) && /(등록|추가|작성|발송|올려|만들)/.test(text)) {
    const stripped = text
      .replace(/^.*?(?:전체\s*(?:업무\s*)?공지|업무\s*공지|전사\s*공지)(?:사항)?\s*(?:등록|추가|작성|발송|올려줘|만들어줘|:|-)?\s*/i, '')
      .trim();
    const content = stripped || text;
    return {
      kind: 'notice_create_global',
      title: `전체 업무 공지 · ${content.slice(0, 28)}`,
      content,
    };
  }

  // 2. Notice listing
  if (/개인\s*공지/.test(text)) {
    return { kind: 'notice_list', scope: 'personal' };
  }
  if (/(전체\s*(?:업무\s*)?공지|업무\s*공지|전사\s*공지|공지사항|공지\s*보여|공지\s*알려)/.test(text)) {
    return { kind: 'notice_list', scope: 'global' };
  }

  // 3. Mail actions (BigMail / BMail)
  if (provider || /(메일|이메일|받은편지|메일함)/.test(text)) {
    if (/(요약|내용|정리|알려|브리핑|무슨|뭐)/.test(text)) {
      return { kind: 'mail_summarize', ...(provider ? { provider } : {}) };
    }
    if (/(열어|상세|상세히|보기|들어가|연동|보여|확인)/.test(text)) {
      return { kind: 'mail_open', ...(provider ? { provider } : {}), query: text };
    }
    return { kind: 'mail_list', ...(provider ? { provider } : {}) };
  }

  // 4. Unified alerts briefing
  if (/(전체\s*알람|전체\s*알림|알람\s*(보여|알려|요약|브리핑)|알림\s*(보여|알려|요약|브리핑)|미확인\s*알람|오늘\s*브리핑)/.test(text)) {
    return { kind: 'alerts_briefing' };
  }

  // 5. Chat briefing
  if (/(채팅|메시지|대화방|안\s*읽은|미확인\s*채팅)/.test(text)) {
    return { kind: 'chat_briefing' };
  }

  // 6. Large file link sharing
  if (/(대용량|링크\s*공유|파일\s*링크|대용량\s*파일)/.test(text)) {
    return { kind: 'large_link_open' };
  }

  // 7. Leave summary
  if (/(내\s*연차|잔여\s*연차|연차\s*(현황|정보|기록|조회))/.test(text)) {
    return { kind: 'leave_info' };
  }

  // 8. SEDMS / SGW bridge
  const sedmsParsed = parseSgwIntegrationCommand(text);
  if (sedmsParsed.matched) {
    return {
      kind: 'sedms_action',
      menuKey: sedmsParsed.summary.menuKey,
      rawText: text,
    };
  }

  return { kind: 'general_briefing', rawText: text };
}
