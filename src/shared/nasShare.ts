import type {
  Message,
  ScheduleCardData,
  ShareProvider,
  User,
} from './types';
import { validateLargeFileLinkInput } from './voiceAnalysis';

export const NAS_DEFAULT_FOLDERS = [
  '전사-공유',
  '프로덕트개발',
  'AI-데이터셋',
  '디자인-에셋',
  '경영지원-자료실',
] as const;

export function sanitizeNasFolder(raw: string | undefined | null): string {
  const normalized = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .map((seg) => seg.replace(/[^\w.\-가-힣\s()]/g, '_'))
    .filter(Boolean)
    .slice(0, 3)
    .join('/');
  return normalized || '전사-공유';
}

export function sanitizeNasFilename(raw: string | undefined | null): string {
  const leaf = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim() ?? '';
  const cleaned = leaf
    .replace(/\.\.+/g, '.')
    .replace(/[^\w.\-가-힣\s()]/g, '_')
    .trim()
    .slice(0, 180);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return '';
  }
  return cleaned;
}

export function buildNasRelativePath(folder: string, filename: string): string {
  const safeFolder = sanitizeNasFolder(folder);
  const safeName = sanitizeNasFilename(filename) || 'shared_archive.bin';
  return `${safeFolder}/${safeName}`;
}

export type ParsedByteRange =
  | { ok: true; start: number; end: number }
  | { ok: false; unsatisfiable: boolean };

export function parseHttpRangeHeader(
  rangeHeader: string | undefined | null,
  totalSize: number,
): ParsedByteRange | null {
  if (!rangeHeader || totalSize <= 0) return null;
  const trimmed = rangeHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bytes=')) return null;
  const spec = trimmed.slice(6).split(',')[0]?.trim() ?? '';
  const match = spec.match(/^(\d*)-(\d*)$/);
  if (!match) return { ok: false, unsatisfiable: true };

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { ok: false, unsatisfiable: true };

  let start = 0;
  let end = totalSize - 1;

  if (!rawStart && rawEnd) {
    const suffixLen = Number(rawEnd);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
      return { ok: false, unsatisfiable: true };
    }
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : totalSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= totalSize ||
    end < start
  ) {
    return { ok: false, unsatisfiable: true };
  }

  return {
    ok: true,
    start,
    end: Math.min(end, totalSize - 1),
  };
}

export function validateNasShareRequest(input: {
  nasFolder: string;
  filename: string;
  externalNasUrl?: string;
  sizeValue?: number;
  sizeUnit?: 'MB' | 'GB' | 'TB';
  expiresDays?: number;
  passcode?: string;
  maxDownloads?: number | null;
  shareProvider?: ShareProvider;
}):
  | {
      ok: true;
      nasFolder: string;
      filename: string;
      nasRelativePath: string;
      externalNasUrl: string | null;
      sizeBytes: number;
      expiresAt: string;
      expiresDays: number;
      shareProvider: ShareProvider;
      passcode?: string;
      maxDownloads: number | null;
    }
  | { ok: false; error: string } {
  const nasFolder = sanitizeNasFolder(input.nasFolder);
  const filename = sanitizeNasFilename(input.filename);
  if (!filename) {
    return { ok: false, error: 'NAS 폴더에 복사·공유할 파일명을 입력해 주세요.' };
  }

  const rawExternal = String(input.externalNasUrl ?? '').trim();
  const placeholderOrValidatedUrl = rawExternal || 'https://nas-gateway.sgw.invalid/internal-mount';

  const validated = validateLargeFileLinkInput({
    filename,
    externalUrl: placeholderOrValidatedUrl,
    sizeValue: input.sizeValue ?? 100,
    sizeUnit: input.sizeUnit ?? 'GB',
    expiresDays: input.expiresDays ?? 7,
    shareProvider: input.shareProvider ?? 'nas',
    passcode: input.passcode,
    maxDownloads: input.maxDownloads,
  });

  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  return {
    ok: true,
    nasFolder,
    filename,
    nasRelativePath: buildNasRelativePath(nasFolder, filename),
    externalNasUrl: rawExternal ? validated.externalUrl : null,
    sizeBytes: validated.sizeBytes,
    expiresAt: validated.expiresAt,
    expiresDays: validated.expiresDays,
    shareProvider: input.shareProvider ?? 'nas',
    ...(validated.passcode ? { passcode: validated.passcode } : {}),
    maxDownloads: validated.maxDownloads,
  };
}

export function validateScheduleCardInput(input: {
  title: string;
  dateTime: string;
  location?: string;
  memo?: string;
}): { ok: true; data: Omit<ScheduleCardData, 'attendeesYes' | 'attendeesMaybe' | 'attendeesNo'> } | { ok: false; error: string } {
  const title = String(input.title ?? '').trim().slice(0, 120);
  const dateTime = String(input.dateTime ?? '').trim().slice(0, 80);
  const location = String(input.location ?? '').trim().slice(0, 100);
  const memo = String(input.memo ?? '').trim().slice(0, 300);
  if (!title) return { ok: false, error: '일정 제목을 입력해 주세요.' };
  if (!dateTime) return { ok: false, error: '일정 날짜 및 시간을 입력해 주세요.' };
  return {
    ok: true,
    data: {
      title,
      dateTime,
      ...(location ? { location } : {}),
      ...(memo ? { memo } : {}),
    },
  };
}

export function toggleScheduleRsvpLists(
  card: ScheduleCardData,
  userId: string,
  choice: 'yes' | 'maybe' | 'no',
): ScheduleCardData {
  const yes = card.attendeesYes.filter((id) => id !== userId);
  const maybe = card.attendeesMaybe.filter((id) => id !== userId);
  const no = card.attendeesNo.filter((id) => id !== userId);

  const wasYes = card.attendeesYes.includes(userId);
  const wasMaybe = card.attendeesMaybe.includes(userId);
  const wasNo = card.attendeesNo.includes(userId);

  if (choice === 'yes' && !wasYes) yes.push(userId);
  else if (choice === 'maybe' && !wasMaybe) maybe.push(userId);
  else if (choice === 'no' && !wasNo) no.push(userId);

  return {
    ...card,
    attendeesYes: yes,
    attendeesMaybe: maybe,
    attendeesNo: no,
  };
}

export function parseDrawCandidates(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/[\n,]+/)) {
    const clean = part.trim().slice(0, 40);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
    if (out.length >= 30) break;
  }
  return out;
}

export function buildRoomTranscriptExportText(
  roomName: string,
  messages: Message[],
  usersById: Record<string, User>,
): string {
  const header = [
    `SG Talk 대화 내용 내보내기`,
    `대화방: ${roomName}`,
    `내보낸 시각: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    `총 메시지: ${messages.length}건`,
    '----------------------------------------',
  ];
  const lines = messages.map((m) => {
    const sender = usersById[m.senderId]?.name ?? '임직원';
    const time = m.createdAt.slice(0, 19).replace('T', ' ');
    if (m.deleted) return `[${time}] ${sender}: (삭제된 메시지)`;
    if (m.type === 'file' && m.file) {
      const nasPart = m.file.nasFolder ? ` [NAS: ${m.file.nasFolder}]` : '';
      return `[${time}] ${sender}: [파일] ${m.file.filename}${nasPart} (${m.content})`;
    }
    if (m.type === 'voice' && m.voice) {
      return `[${time}] ${sender}: [음성 ${m.voice.durationSec}초] ${m.voice.transcript || m.content}`;
    }
    if (m.type === 'schedule_card' && m.scheduleCard) {
      return `[${time}] ${sender}: [일정] ${m.scheduleCard.title} (${m.scheduleCard.dateTime})`;
    }
    if (m.type === 'draw_card' && m.drawCard) {
      return `[${time}] ${sender}: [추첨] ${m.drawCard.topic} -> 당첨: ${m.drawCard.winner}`;
    }
    return `[${time}] ${sender}: ${m.content}`;
  });
  return [...header, ...lines].join('\n');
}
