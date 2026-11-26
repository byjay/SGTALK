import type { SedmsMenuKey, ShareProvider, VoiceAnalysisResult } from './types';

export function analyzeVoiceTranscriptPure(
  rawTranscript: string,
  durationSec = 3,
): VoiceAnalysisResult {
  const transcript = String(rawTranscript ?? '').replace(/\s+/g, ' ').trim();
  const analyzedAt = new Date().toISOString();

  if (!transcript) {
    return {
      summary: `음성 메시지 (${Math.max(1, Math.round(durationSec))}초) · 음성 파형이 감지되었으나 인식된 문장이 없습니다. 다시 말씀해 주세요.`,
      keywords: ['음성메모'],
      actionItems: ['음성 내용을 텍스트로 보완하거나 재녹음하세요.'],
      detectedIntent: 'general',
      analyzedAt,
      engine: 'sgw-voice-engine',
    };
  }

  let detectedIntent: VoiceAnalysisResult['detectedIntent'] = 'general';
  let suggestedMenuKey: SedmsMenuKey | undefined;

  if (/(연차|반차|휴가|병가|공가)/.test(transcript)) {
    detectedIntent = 'leave';
    suggestedMenuKey = 'leave';
  } else if (/(빅메일|비메일|bmail|bigmail|메일|이메일|메일함)/i.test(transcript)) {
    detectedIntent = 'mail';
    suggestedMenuKey = 'bmail';
  } else if (/(전체\s*공지|업무\s*공지|개인\s*공지|공지사항|공지)/.test(transcript)) {
    detectedIntent = 'notice';
  } else if (/(미팅\s*메모|회의록|회의\s*내용|회의\s*요약)/.test(transcript)) {
    detectedIntent = 'meeting_memo';
    suggestedMenuKey = 'meeting-memo';
  } else if (/(달력|캘린더|일정|마일스톤|스케줄)/.test(transcript)) {
    detectedIntent = 'calendar';
    suggestedMenuKey = 'project-calendar';
  } else if (/(화상\s*회의|회의\s*시작|회의\s*참여|미팅\s*열)/.test(transcript)) {
    detectedIntent = 'meeting';
    suggestedMenuKey = 'meeting';
  }

  const stopWords = new Set([
    '오늘',
    '내일',
    '모레',
    '이번',
    '그냥',
    '정도',
    '관련',
    '부분',
    '확인',
    '부탁',
    '합니다',
    '입니다',
    '해주세요',
    '해주세요.',
    '해줘',
    '좀',
    '및',
    '등',
    '그리고',
    '또는',
    '에서',
    '으로',
    '까지',
  ]);

  const tokens = transcript
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const keywords = Array.from(new Set(tokens)).slice(0, 5);
  if (keywords.length === 0) {
    keywords.push('음성메모');
  }

  const sentences = transcript
    .split(/(?<=[.!?다요음])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const summary =
    sentences.length >= 2
      ? `${sentences[0]} · ${sentences[1]}`.slice(0, 180)
      : transcript.slice(0, 140) + (transcript.length > 140 ? '…' : '');

  const actionItems: string[] = [];
  if (detectedIntent === 'leave') {
    actionItems.push('SEDMS 연차·반차 신청서 연동 및 대직자 확인');
  } else if (detectedIntent === 'mail') {
    actionItems.push('빅메일/비메일 수신함 확인 및 핵심 내용 요약 열기');
  } else if (detectedIntent === 'notice') {
    actionItems.push('전체 업무 공지 / 개인 공지사항 등록 또는 공지함 확인');
  } else if (detectedIntent === 'meeting_memo') {
    actionItems.push('SGW 미팅메모로 회의록 자동 저장');
  } else if (detectedIntent === 'calendar') {
    actionItems.push('SGW 프로젝트 달력에 일정 반영');
  } else if (detectedIntent === 'meeting') {
    actionItems.push('SGW 회의실 바로 생성 및 참여 링크 공유');
  }

  if (/(첨부|파일|문서|설계서|견적서|자료|링크)/.test(transcript)) {
    actionItems.push('대용량 파일·공유 링크 첨부 여부 확인');
  }
  if (/(공유|전달|알려|보내|회신)/.test(transcript)) {
    actionItems.push('담당자 또는 대화방에 요약 내용 회신');
  }
  if (actionItems.length === 0) {
    actionItems.push('핵심 키워드 기준으로 팀 대화방에 메모 정리');
  }

  return {
    summary,
    keywords,
    actionItems: actionItems.slice(0, 3),
    detectedIntent,
    ...(suggestedMenuKey ? { suggestedMenuKey } : {}),
    analyzedAt,
    engine: 'sgw-voice-engine',
  };
}

export function buildFallbackMessageTranslationOrSummary(
  rawContent: string,
  mode: 'translate' | 'summary' = 'summary',
): {
  mode: 'translate' | 'summary';
  resultText: string;
  detectedLanguage: 'ko' | 'en' | 'mixed';
} {
  const content = String(rawContent ?? '').replace(/\s+/g, ' ').trim();
  const hasHangul = /[가-힣]/.test(content);
  const hasLatin = /[A-Za-z]{3,}/.test(content);
  const detectedLanguage: 'ko' | 'en' | 'mixed' =
    hasHangul && hasLatin ? 'mixed' : hasHangul ? 'ko' : 'en';

  if (!content) {
    return {
      mode,
      detectedLanguage,
      resultText: '분석할 텍스트가 없습니다.',
    };
  }

  if (mode === 'translate') {
    if (detectedLanguage === 'en') {
      const dictionary: [RegExp, string][] = [
        [/\bplease review\b/gi, '검토 부탁드립니다'],
        [/\bapproval\b/gi, '승인/결재'],
        [/\bmeeting\b/gi, '회의'],
        [/\bdeadline\b/gi, '마감일'],
        [/\bschedule\b/gi, '일정'],
        [/\battached\b/gi, '첨부됨'],
        [/\bdownload\b/gi, '다운로드'],
        [/\bnotice\b/gi, '공지'],
        [/\bupdate\b/gi, '업데이트'],
        [/\burgent\b/gi, '긴급'],
      ];
      let translated = content;
      for (const [pat, rep] of dictionary) {
        translated = translated.replace(pat, rep);
      }
      return {
        mode: 'translate',
        detectedLanguage,
        resultText: `[한글 번역 요약] ${translated}`,
      };
    }
    return {
      mode: 'translate',
      detectedLanguage,
      resultText: `[English Summary] Key topic: "${content.slice(0, 120)}${content.length > 120 ? '...' : ''}"`,
    };
  }

  const parts = content
    .split(/(?<=[.!?다요])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const core = parts.length > 1 ? `${parts[0]} / ${parts[parts.length - 1]}` : content;
  return {
    mode: 'summary',
    detectedLanguage,
    resultText: `[핵심 요약] ${core.slice(0, 140)}${core.length > 140 ? '…' : ''}`,
  };
}

export const SHARE_PROVIDER_LABELS: Record<ShareProvider, string> = {
  'sgw-relay': 'SGW 보안 릴레이',
  nas: '사내 NAS 스토리지',
  s3: 'AWS S3 Presigned',
  gcs: 'GCS Signed URL',
  gdrive: 'Google Drive',
  custom: '직접 외부 스토리지',
};

const VALID_SHARE_PROVIDERS = new Set<ShareProvider>([
  'sgw-relay',
  'nas',
  's3',
  'gcs',
  'gdrive',
  'custom',
]);

function isBlockedInternalHostname(rawHostname: string): boolean {
  const host = rawHostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

export function validateLargeFileLinkInput(input: {
  filename: string;
  externalUrl: string;
  sizeMB?: number;
  sizeValue?: number;
  sizeUnit?: 'MB' | 'GB' | 'TB';
  expiresDays?: number;
  shareProvider?: ShareProvider;
  passcode?: string;
  maxDownloads?: number | null;
}):
  | {
      ok: true;
      filename: string;
      externalUrl: string;
      sizeBytes: number;
      expiresAt: string;
      expiresDays: number;
      shareProvider: ShareProvider;
      passcode?: string;
      maxDownloads: number | null;
    }
  | { ok: false; error: string } {
  const filename = String(input.filename ?? '').trim().slice(0, 180);
  if (!filename) {
    return { ok: false, error: '파일 이름 또는 링크 제목을 입력해 주세요.' };
  }

  const rawUrl = String(input.externalUrl ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: '유효한 http:// 또는 https:// 링크 주소를 입력해 주세요.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'HTTP/HTTPS 보안 링크만 공유할 수 있습니다.' };
  }

  if (isBlockedInternalHostname(parsed.hostname)) {
    return { ok: false, error: '로컬 또는 내부 메타데이터 주소는 외부 공유 링크로 등록할 수 없습니다.' };
  }

  // Convert size into MB (supporting up to 10 TB = 10 * 1024 * 1024 MB)
  let rawSizeMB = Number(input.sizeMB ?? 0);
  if (typeof input.sizeValue === 'number' && Number.isFinite(input.sizeValue) && input.sizeValue > 0) {
    const unit = input.sizeUnit ?? 'GB';
    const multiplier = unit === 'TB' ? 1024 * 1024 : unit === 'GB' ? 1024 : 1;
    rawSizeMB = input.sizeValue * multiplier;
  }
  const MAX_SHARE_MB = 10 * 1024 * 1024; // 10 TB
  const safeSizeMB =
    Number.isFinite(rawSizeMB) && rawSizeMB > 0 ? Math.min(rawSizeMB, MAX_SHARE_MB) : 100 * 1024;
  const sizeBytes = Math.round(safeSizeMB * 1024 * 1024);

  const days = Number(input.expiresDays ?? 7);
  const safeDays = Number.isFinite(days) && days >= 1 ? Math.min(Math.round(days), 90) : 7;
  const expiresAt = new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();

  const shareProvider: ShareProvider =
    input.shareProvider && VALID_SHARE_PROVIDERS.has(input.shareProvider)
      ? input.shareProvider
      : 'sgw-relay';

  let passcode: string | undefined;
  if (typeof input.passcode === 'string' && input.passcode.trim().length > 0) {
    const trimmedCode = input.passcode.trim();
    if (trimmedCode.length < 4 || trimmedCode.length > 24) {
      return { ok: false, error: '공유 비밀번호(PIN)는 4자 이상 24자 이하로 입력해 주세요.' };
    }
    passcode = trimmedCode;
  }

  let maxDownloads: number | null = null;
  if (input.maxDownloads !== undefined && input.maxDownloads !== null && String(input.maxDownloads) !== '') {
    const num = Number(input.maxDownloads);
    if (!Number.isFinite(num) || num < 1 || num > 1000) {
      return { ok: false, error: '최대 다운로드 횟수는 1~1000회 사이로 지정해 주세요.' };
    }
    maxDownloads = Math.floor(num);
  }

  return {
    ok: true,
    filename,
    externalUrl: parsed.toString(),
    sizeBytes,
    expiresAt,
    expiresDays: safeDays,
    shareProvider,
    ...(passcode ? { passcode } : {}),
    maxDownloads,
  };
}
