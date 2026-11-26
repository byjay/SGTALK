import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLeaveBroadcastSummary,
  calculateLeaveDays,
  executeLeaveHistoryQuery,
  formatLeaveNotificationText,
  toggleReactionMap,
} from '../src/shared/logic';
import {
  extractMentionUserIds,
  isMessageExpired,
  maskViewOnceMessageForUser,
} from '../src/shared/chatLogic';
import {
  normalizeBmailLedgerBatch,
  type BmailLedgerItem,
  type BmailRemoteMailItem,
  mapRemoteBmailItemToMailMessage,
} from '../src/shared/bmailSync';
import { buildConciseMailDigest } from '../src/shared/controlTower';
import { toggleScheduleRsvpLists } from '../src/shared/nasShare';
import {
  getNoticePriorityMeta,
  normalizeNoticePriority,
  toggleNoticeAckList,
} from '../src/shared/noticeAlert';
import type {
  BootstrapPayload,
  ChatRoom,
  DrawCardData,
  FileAttachment,
  ForwardedMeta,
  IntegrationActionSummary,
  LeaveRequest,
  LeaveType,
  MailAttachmentItem,
  MailCategory,
  MailMessage,
  MailProvider,
  Message,
  Notice,
  NoticePriority,
  NotificationItem,
  PollData,
  PresenceStatus,
  ScheduleCardData,
  ScheduledMessageItem,
  SedmsMenuKey,
  SharedFileItem,
  ShareProvider,
  StorageLocation,
  User,
  VoiceAnalysisResult,
  VoiceAttachment,
} from '../src/shared/types';
import { resolveNasFilePath } from './nas';
import { isPathInsideDir } from './security';

export interface StoredUser extends User {
  passwordHash: string;
}

export interface DatabaseState {
  users: StoredUser[];
  rooms: ChatRoom[];
  messages: Message[];
  notices: Notice[];
  leaves: LeaveRequest[];
  mails: MailMessage[];
  notifications: NotificationItem[];
  files: SharedFileItem[];
  scheduledMessages: ScheduledMessageItem[];
  sharePasscodeHashes?: Record<string, string>;
  bmailLedger?: BmailLedgerItem[];
  weeklyPushDates?: string[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

export function ensureDataDirs(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function getUploadDir(): string {
  ensureDataDirs();
  return UPLOAD_DIR;
}

export function hashPassword(password: string): string {
  const salt = 'worktalk-corp-salt-2026';
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function sanitizeUser(u: StoredUser): User {
  const { passwordHash: _ignored, ...rest } = u;
  return rest;
}

function getTodayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysDateString(baseIsoDate: string, days: number): string {
  const d = new Date(`${baseIsoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findMonthWeekdayRange(
  baseIsoDate: string,
  deltaMonths: number,
  preferredStartDay: number,
  weekdayCount: number,
): { startDate: string; endDate: string } {
  const baseYear = Number(baseIsoDate.slice(0, 4)) || 2026;
  const baseMonth = Number(baseIsoDate.slice(5, 7)) || 11;
  const zeroBased = baseYear * 12 + (baseMonth - 1) + deltaMonths;
  const y = Math.floor(zeroBased / 12);
  const m = ((zeroBased % 12) + 12) % 12 + 1;
  const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const safeStartDay = Math.max(1, Math.min(maxDay - weekdayCount - 2, preferredStartDay));
  let cur = new Date(Date.UTC(y, m - 1, safeStartDay));

  while (cur.getUTCDay() === 0 || cur.getUTCDay() === 6) {
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  const startDate = cur.toISOString().slice(0, 10);
  let remaining = Math.max(1, weekdayCount) - 1;
  while (remaining > 0) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) {
      remaining -= 1;
    }
  }
  const endDate = cur.toISOString().slice(0, 10);
  return { startDate, endDate };
}

function createSeedDatabase(): DatabaseState {
  ensureDataDirs();
  const today = getTodayDateString();
  const plus2 = addDaysDateString(today, 2);
  const plus3 = addDaysDateString(today, 3);
  const nowIso = new Date().toISOString();
  const tMinus3h = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const tMinus2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const tMinus45m = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const tMinus25m = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const tMinus10m = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const sampleFileId = 'file-guide-01';
  const sampleDiskFilename = 'sample-guide.txt';
  const sampleDiskPath = path.join(UPLOAD_DIR, sampleDiskFilename);
  if (!fs.existsSync(sampleDiskPath)) {
    fs.writeFileSync(
      sampleDiskPath,
      [
        'SG Talk 이용 가이드',
        '=======================================',
        '1. 왼쪽 회사 계정 접속자 목록에서 동료를 더블클릭하면 즉시 1:1 대화방이 열립니다.',
        '2. 채팅창에서 "/연차 내일 사유 개인일정" 처럼 대화로 바로 연차 등록이 가능합니다.',
        '3. 연차 등록 및 bmail(사내 메일) 수신 시 가입된 임직원에게 실시간 메신저 알림이 연동됩니다.',
      ].join('\n'),
      'utf-8',
    );
  }

  const defaultPassHash = hashPassword('worktalk1234');

  const users: StoredUser[] = [
    {
      id: 'u-minjun',
      name: '김민준',
      email: 'minjun@sgw.co.kr',
      department: '프로덕트 개발팀',
      position: '팀장',
      phone: '010-4821-1024',
      avatarUrl: '/src/assets/images/avatar_kim_minjun_1795266107528.jpg',
      statusMessage: '4분기 SG Talk 개편 스프린트',
      presenceStatus: 'online',
      role: 'admin',
      totalLeaveDays: 15,
      usedLeaveDays: 2.5,
      online: true,
      lastSeen: nowIso,
      createdAt: '2026-01-02T09:00:00.000Z',
      passwordHash: defaultPassHash,
    },
    {
      id: 'u-seoyeon',
      name: '이서연',
      email: 'seoyeon@sgw.co.kr',
      department: 'UX 디자인팀',
      position: '선임',
      phone: '010-3912-8840',
      avatarUrl: '/src/assets/images/avatar_lee_seoyeon_1795266107614.jpg',
      statusMessage: '디자인 시스템 v3 시안 리뷰 중',
      presenceStatus: 'online',
      role: 'member',
      totalLeaveDays: 15,
      usedLeaveDays: 3,
      online: true,
      lastSeen: tMinus10m,
      createdAt: '2026-01-02T09:00:00.000Z',
      passwordHash: defaultPassHash,
    },
    {
      id: 'u-jihoon',
      name: '박지훈',
      email: 'jihoon@sgw.co.kr',
      department: '경영지원·HR팀',
      position: '매니저',
      phone: '010-7721-3309',
      avatarUrl: '/src/assets/images/avatar_park_jihoon_1795266107118.jpg',
      statusMessage: '연차/결재/bmail 연동 문의 환영',
      presenceStatus: 'meeting',
      role: 'admin',
      totalLeaveDays: 15,
      usedLeaveDays: 1,
      online: true,
      lastSeen: tMinus25m,
      createdAt: '2026-01-02T09:00:00.000Z',
      passwordHash: defaultPassHash,
    },
    {
      id: 'u-yuna',
      name: '최유나',
      email: 'yuna@sgw.co.kr',
      department: '그로스 마케팅팀',
      position: '매니저',
      phone: '010-6504-2190',
      avatarUrl: '/src/assets/images/avatar_choi_yuna_1795266107019.jpg',
      statusMessage: '연말 캠페인 미팅 이동 중',
      presenceStatus: 'out',
      role: 'member',
      totalLeaveDays: 15,
      usedLeaveDays: 4,
      online: true,
      lastSeen: tMinus45m,
      createdAt: '2026-01-05T09:00:00.000Z',
      passwordHash: defaultPassHash,
    },
    {
      id: 'u-hyunwoo',
      name: '정현우',
      email: 'hyunwoo@sgw.co.kr',
      department: '프로덕트 개발팀',
      position: '선임',
      phone: '010-5190-7712',
      avatarUrl: '',
      statusMessage: '오늘 오후 반차 · 긴급 이슈는 민준 팀장님께',
      presenceStatus: 'away',
      role: 'member',
      totalLeaveDays: 15,
      usedLeaveDays: 3.5,
      online: false,
      lastSeen: tMinus2h,
      createdAt: '2026-01-10T09:00:00.000Z',
      passwordHash: defaultPassHash,
    },
    {
      id: 'u-bot',
      name: 'SGW 알림봇',
      email: 'bot@sgw.co.kr',
      department: 'SGW 시스템',
      position: '자동알림',
      phone: '',
      avatarUrl: '',
      statusMessage: '연차 등록 · bmail 수신 · 전사 공지 실시간 연동',
      presenceStatus: 'online',
      role: 'bot',
      totalLeaveDays: 0,
      usedLeaveDays: 0,
      online: true,
      lastSeen: nowIso,
      createdAt: '2026-01-01T00:00:00.000Z',
      passwordHash: defaultPassHash,
    },
  ];

  const allMemberIds = users.map((u) => u.id);

  const notices: Notice[] = [
    {
      id: 'notice-global-1',
      roomId: 'room-company',
      scope: 'global',
      messageId: null,
      authorId: 'u-jihoon',
      title: '[전체 업무 공지] 2026년 4분기 보안 점검 및 대용량 파일 링크 공유 정책',
      content:
        '사내 대용량 파일(최대 500MB 분할 업로드 및 100GB 단위 외부 공유 링크)은 만료일·비밀번호·다운로드 제한이 적용된 보안 공유 링크를 통해 안전하게 전달해 주세요. 빅메일·비메일 수신 시 통합 어시스턴트에서 즉시 요약·열기가 가능합니다.',
      pinned: true,
      priority: 'important',
      isUrgent: false,
      acknowledgedBy: ['u-jihoon', 'u-minjun'],
      createdAt: tMinus2h,
    },
    {
      id: 'notice-global-2',
      roomId: 'room-company',
      scope: 'global',
      messageId: null,
      authorId: 'u-minjun',
      title: '[전체 업무 공지] SEDMS × SG Talk 통합 음성 어시스턴트 가동',
      content:
        '상단 통합 어시스턴트 또는 채팅창 마이크 버튼으로 "최근 빅메일 요약해줘", "전체 업무 공지 등록", "내일 오전반차 신청" 등 음성 제어가 가능합니다.',
      pinned: false,
      priority: 'normal',
      isUrgent: false,
      acknowledgedBy: ['u-minjun'],
      createdAt: tMinus3h,
    },
    {
      id: 'notice-personal-1',
      roomId: 'room-self-u-minjun',
      scope: 'personal',
      ownerUserId: 'u-minjun',
      messageId: null,
      authorId: 'u-minjun',
      title: '[개인 공지] 오후 4시 아키텍처 설계서 첨부 메일 검토 및 PR 머지',
      content: '이서연 선임 빅메일 첨부 PDF 검토 후 프로덕트 개발팀 방에 피드백 공유하기.',
      pinned: true,
      priority: 'normal',
      isUrgent: false,
      acknowledgedBy: ['u-minjun'],
      createdAt: tMinus45m,
    },
    {
      id: 'notice-company-1',
      roomId: 'room-company',
      scope: 'room',
      messageId: 'msg-company-1',
      authorId: 'u-jihoon',
      title: 'SG Talk · bmail 연동 및 대화형 연차 등록 안내',
      content:
        '왼쪽 회사 계정 목록에서 동료를 더블클릭하면 바로 1:1 대화가 열립니다. 채팅 입력창에 "/연차 내일 사유 개인일정" 입력 시 대화로 즉시 연차가 등록되고 전사 bmail/메신저 알림이 발송됩니다.',
      pinned: true,
      priority: 'important',
      isUrgent: false,
      acknowledgedBy: ['u-jihoon', 'u-minjun', 'u-seoyeon'],
      createdAt: tMinus3h,
    },
    {
      id: 'notice-dev-1',
      roomId: 'room-dev',
      scope: 'room',
      messageId: 'msg-dev-1',
      authorId: 'u-minjun',
      title: '금주 정기 배포 및 PR 리뷰 원칙',
      content: '매주 목요일 오후 4시 스테이징 배포, 금요일 오전 10시 프로덕션 반영입니다.',
      pinned: true,
      priority: 'normal',
      isUrgent: false,
      acknowledgedBy: ['u-minjun'],
      createdAt: tMinus3h,
    },
  ];

  const rooms: ChatRoom[] = [
    {
      id: 'room-company',
      type: 'company',
      name: '전사 공지·자유방',
      description: 'SGW 전사 공지, 연차·메일 알림 및 사내 소통 채널',
      memberIds: allMemberIds,
      pinnedByUserIds: ['u-minjun'],
      mutedByUserIds: [],
      activeNoticeId: 'notice-company-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: tMinus10m,
    },
    {
      id: 'room-bot',
      type: 'bot',
      name: 'SGW 연차·bmail 알림봇',
      description: '연차 등록 및 bmail 수신 시 즉시 알림을 전달하는 공식 연동 채널',
      memberIds: allMemberIds,
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: tMinus45m,
    },
    {
      id: 'room-dev',
      type: 'group',
      name: '프로덕트 개발팀',
      description: 'SGW 서브앱 프론트엔드·백엔드 협업방',
      memberIds: ['u-minjun', 'u-seoyeon', 'u-hyunwoo'],
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: 'notice-dev-1',
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: tMinus25m,
    },
    {
      id: 'room-dm-minjun-seoyeon',
      type: 'direct',
      name: '이서연',
      description: '',
      memberIds: ['u-minjun', 'u-seoyeon'],
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: tMinus45m,
    },
    {
      id: 'room-dm-minjun-jihoon',
      type: 'direct',
      name: '박지훈',
      description: '',
      memberIds: ['u-minjun', 'u-jihoon'],
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      createdAt: '2026-02-05T00:00:00.000Z',
      updatedAt: tMinus3h,
    },
    {
      id: 'room-self-u-minjun',
      type: 'self',
      name: '나와의 채팅',
      description: '개인 메모, 링크 및 파일을 보관하는 나만의 채팅방',
      memberIds: ['u-minjun'],
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      disappearingSeconds: null,
      createdAt: '2026-02-05T00:00:00.000Z',
      updatedAt: tMinus3h,
    },
  ];

  const minjunLastMonth = findMonthWeekdayRange(today, -1, 14, 2);
  const minjunTwoMonthsAgo = findMonthWeekdayRange(today, -2, 8, 1);
  const seoyeonLastMonth = findMonthWeekdayRange(today, -1, 6, 1);
  const jihoonLastMonth = findMonthWeekdayRange(today, -1, 22, 1);
  const yunaTwoMonthsAgo = findMonthWeekdayRange(today, -2, 16, 3);
  const yunaLastMonth = findMonthWeekdayRange(today, -1, 20, 1);
  const hyunwooTwoMonthsAgo = findMonthWeekdayRange(today, -2, 21, 3);

  const leaves: LeaveRequest[] = [
    {
      id: 'leave-seed-1',
      userId: 'u-hyunwoo',
      type: '오후반차',
      startDate: today,
      endDate: today,
      daysCount: 0.5,
      substituteId: 'u-minjun',
      reason: '개인 병원 예약 및 휴식',
      status: '승인완료',
      createdAt: tMinus2h,
    },
    {
      id: 'leave-seed-2',
      userId: 'u-seoyeon',
      type: '연차',
      startDate: plus2,
      endDate: plus3,
      daysCount: 2,
      substituteId: 'u-yuna',
      reason: '가족 여행 일정',
      status: '승인완료',
      createdAt: tMinus3h,
    },
    {
      id: 'leave-seed-hist-1',
      userId: 'u-minjun',
      type: '연차',
      startDate: minjunLastMonth.startDate,
      endDate: minjunLastMonth.endDate,
      daysCount: 2,
      substituteId: 'u-hyunwoo',
      reason: '가을 가족 여행 및 재충전',
      status: '승인완료',
      createdAt: `${minjunLastMonth.startDate}T09:00:00.000Z`,
    },
    {
      id: 'leave-seed-hist-2',
      userId: 'u-minjun',
      type: '오전반차',
      startDate: minjunTwoMonthsAgo.startDate,
      endDate: minjunTwoMonthsAgo.startDate,
      daysCount: 0.5,
      substituteId: 'u-seoyeon',
      reason: '치과 정기 검진 및 스케일링',
      status: '승인완료',
      createdAt: `${minjunTwoMonthsAgo.startDate}T08:30:00.000Z`,
    },
    {
      id: 'leave-seed-hist-3',
      userId: 'u-seoyeon',
      type: '연차',
      startDate: seoyeonLastMonth.startDate,
      endDate: seoyeonLastMonth.startDate,
      daysCount: 1,
      substituteId: 'u-yuna',
      reason: '디자인 컨퍼런스 참석 및 휴식',
      status: '승인완료',
      createdAt: `${seoyeonLastMonth.startDate}T09:10:00.000Z`,
    },
    {
      id: 'leave-seed-hist-4',
      userId: 'u-jihoon',
      type: '연차',
      startDate: jihoonLastMonth.startDate,
      endDate: jihoonLastMonth.startDate,
      daysCount: 1,
      substituteId: 'u-minjun',
      reason: '은행 및 관공서 개인 업무',
      status: '승인완료',
      createdAt: `${jihoonLastMonth.startDate}T09:00:00.000Z`,
    },
    {
      id: 'leave-seed-hist-5',
      userId: 'u-yuna',
      type: '연차',
      startDate: yunaLastMonth.startDate,
      endDate: yunaLastMonth.startDate,
      daysCount: 1,
      substituteId: 'u-seoyeon',
      reason: '가족 행사 참석',
      status: '승인완료',
      createdAt: `${yunaLastMonth.startDate}T09:00:00.000Z`,
    },
    {
      id: 'leave-seed-hist-6',
      userId: 'u-yuna',
      type: '연차',
      startDate: yunaTwoMonthsAgo.startDate,
      endDate: yunaTwoMonthsAgo.endDate,
      daysCount: 3,
      substituteId: 'u-jihoon',
      reason: '늦은 하계 휴가',
      status: '승인완료',
      createdAt: `${yunaTwoMonthsAgo.startDate}T09:00:00.000Z`,
    },
    {
      id: 'leave-seed-hist-7',
      userId: 'u-hyunwoo',
      type: '연차',
      startDate: hyunwooTwoMonthsAgo.startDate,
      endDate: hyunwooTwoMonthsAgo.endDate,
      daysCount: 3,
      substituteId: 'u-minjun',
      reason: '제주 워케이션 및 휴식',
      status: '승인완료',
      createdAt: `${hyunwooTwoMonthsAgo.startDate}T09:00:00.000Z`,
    },
  ];

  const mails: MailMessage[] = [
    {
      id: 'mail-seed-bigmail-1',
      provider: 'bigmail',
      senderId: 'u-seoyeon',
      recipientIds: ['u-minjun', 'u-hyunwoo', 'u-jihoon'],
      subject: '[빅메일] 2026 SGW × SEDMS 차세대 대용량 아키텍처 설계서 송부',
      shortSummary: 'SGW 차세대 아키텍처 설계서 및 UI 리소스 대용량 패키지 검토 요청',
      body: '김민준 팀장님, 정현우 선임님 안녕하세요.\n차세대 SGW × SEDMS 통합 메신저 아키텍처 최종 설계서와 컴포넌트 리소스 번들을 빅메일로 송부드립니다.\n\n1. 주요 변경사항: 실시간 음성 AI 분석 파이프라인 및 대용량 링크 공유 규격\n2. 검토 기한: 금주 목요일 오후 3시까지 의견 회신 부탁드립니다.\n3. 첨부 대용량 파일은 사내 메일앱 또는 보안 링크로 즉시 내려받으실 수 있습니다.',
      attachments: [
        {
          id: 'att-bigmail-1',
          filename: '2026_SGW_SEDMS_아키텍처_설계서.pdf',
          size: 44_564_480,
          mimeType: 'application/pdf',
          downloadUrl: `/api/files/${sampleFileId}/download`,
        },
        {
          id: 'att-bigmail-2',
          filename: 'SGW_UI_디자인시스템_에셋.zip',
          size: 128_974_848,
          mimeType: 'application/zip',
          downloadUrl: `/api/files/${sampleFileId}/download`,
        },
      ],
      category: '공지',
      readByUserIds: ['u-seoyeon'],
      createdAt: tMinus10m,
    },
    {
      id: 'mail-seed-1',
      provider: 'bmail',
      senderId: 'u-jihoon',
      recipientIds: allMemberIds.filter((id) => id !== 'u-bot'),
      subject: '[SGW 인사] 4분기 연차 사용 촉진 및 메신저 자동 알림 안내',
      shortSummary: '4분기 연차 사용 촉진 계획 및 대화형 "/연차" 자동 알림 안내',
      body: '안녕하세요, 경영지원팀 박지훈입니다.\nSG Talk 내 "/연차" 대화 명령어 또는 연차 등록 화면에서 연차를 신청하시면 전 사원 메일 및 메신저 알림봇으로 즉시 공유됩니다.',
      attachments: [],
      category: '공지',
      readByUserIds: ['u-jihoon'],
      createdAt: tMinus3h,
    },
    {
      id: 'mail-seed-2',
      provider: 'bmail',
      senderId: 'u-seoyeon',
      recipientIds: ['u-minjun', 'u-hyunwoo'],
      subject: '[UX 디자인팀] SG Talk 확장앱 레이아웃 최종 시안 전달',
      shortSummary: '웹 확장앱·앱 모드 전환 UI 시안 전달 및 피드백 요청',
      body: '민준 팀장님, 현우님 안녕하세요.\n웹 확장앱 화면과 모바일 앱 화면 전환 UI 시안을 bmail로 전달드립니다. 확인 후 메신저로 편하게 피드백 주세요!',
      attachments: [
        {
          id: 'att-bmail-1',
          filename: 'SGW_확장앱_UI시안_요약.txt',
          size: 184_320,
          mimeType: 'text/plain',
          downloadUrl: `/api/files/${sampleFileId}/download`,
        },
      ],
      category: '일반',
      readByUserIds: ['u-seoyeon'],
      createdAt: tMinus45m,
    },
    {
      id: 'mail-seed-3',
      provider: 'bmail',
      senderId: 'u-hyunwoo',
      recipientIds: allMemberIds.filter((id) => id !== 'u-bot'),
      subject: `[연차 알림] 정현우 선임 - 오늘(${today}) 오후반차 등록`,
      shortSummary: `정현우 선임 금일 오후반차(0.5일) 등록 · 대직 김민준 팀장`,
      body: `정현우 선임(프로덕트 개발팀)이 오늘 오후반차(0.5일)를 등록했습니다.\n업무 대행: 김민준 팀장\n사유: 개인 병원 예약 및 휴식`,
      attachments: [],
      category: '연차알림',
      readByUserIds: ['u-hyunwoo', 'u-minjun'],
      linkedLeaveId: 'leave-seed-1',
      createdAt: tMinus2h,
    },
  ];

  const sampleAttachment: FileAttachment = {
    id: sampleFileId,
    filename: '2026_SG_Talk_가이드.txt',
    mimeType: 'text/plain',
    size: fs.statSync(sampleDiskPath).size,
    url: `/api/files/${sampleFileId}/download`,
    isImage: false,
  };

  const files: SharedFileItem[] = [
    {
      id: sampleFileId,
      roomId: 'room-company',
      uploaderId: 'u-jihoon',
      messageId: 'msg-company-2',
      filename: sampleAttachment.filename,
      mimeType: sampleAttachment.mimeType,
      size: sampleAttachment.size,
      url: sampleAttachment.url,
      isImage: false,
      createdAt: tMinus2h,
    },
  ];

  const messages: Message[] = [
    {
      id: 'msg-company-1',
      roomId: 'room-company',
      senderId: 'u-jihoon',
      type: 'text',
      content:
        '안녕하세요! SG Talk 왼쪽 회사 계정 목록에서 동료를 더블클릭하면 바로 1:1 채팅이 시작됩니다. 대화창에 "/연차 내일 사유 개인일정"을 입력하면 대화로 자기 연차도 등록할 수 있어요.',
      replyToId: null,
      reactions: { '👍': ['u-minjun', 'u-seoyeon', 'u-yuna'], '✅': ['u-hyunwoo'] },
      readBy: ['u-jihoon', 'u-minjun', 'u-seoyeon', 'u-yuna', 'u-hyunwoo'],
      createdAt: tMinus3h,
    },
    {
      id: 'msg-company-2',
      roomId: 'room-company',
      senderId: 'u-jihoon',
      type: 'file',
      content: 'SG Talk 및 메일 알림 연동 가이드를 첨부합니다.',
      replyToId: null,
      file: sampleAttachment,
      reactions: {},
      readBy: ['u-jihoon', 'u-minjun', 'u-seoyeon'],
      createdAt: tMinus2h,
    },
    {
      id: 'msg-company-3',
      roomId: 'room-company',
      senderId: 'u-yuna',
      type: 'poll',
      content: '이번 주 금요일 팀별 런치 메뉴 투표 진행합니다!',
      replyToId: null,
      poll: {
        question: '금요일 전사 타운홀 후 점심 메뉴 선택',
        options: [
          { id: 'opt-1', text: '한식 정식 (성수동)', voterIds: ['u-minjun', 'u-yuna'] },
          { id: 'opt-2', text: '일식 돈카츠 & 우동', voterIds: ['u-seoyeon'] },
          { id: 'opt-3', text: '샐러드 & 샌드위치 도시락', voterIds: ['u-jihoon'] },
        ],
        allowMultiple: false,
      },
      reactions: { '❤️': ['u-seoyeon'] },
      readBy: ['u-yuna', 'u-minjun', 'u-seoyeon'],
      createdAt: tMinus45m,
    },
    {
      id: 'msg-company-4',
      roomId: 'room-company',
      senderId: 'u-seoyeon',
      type: 'text',
      content: 'bmail 수신 알림 연동도 완료되었으니 확인 부탁드립니다! https://sgw.co.kr/guide',
      replyToId: null,
      reactions: { '🔥': ['u-minjun', 'u-yuna'] },
      readBy: ['u-seoyeon', 'u-minjun'],
      createdAt: tMinus10m,
    },
    {
      id: 'msg-company-5',
      roomId: 'room-company',
      senderId: 'u-seoyeon',
      type: 'voice',
      content: '[음성 메시지] 디자인 시스템 v3 시안 피드백 완료했습니다.',
      replyToId: null,
      voice: {
        durationSec: 6,
        waveform: [28, 52, 74, 46, 88, 66, 40, 78, 92, 58, 44, 70, 84, 50, 34, 62, 72, 42, 30, 48],
        transcript: '디자인 시스템 v3 시안과 공지 배너 간격 최종 수정해서 반영해 두었습니다. 확인 부탁드려요!',
      },
      reactions: { '👍': ['u-minjun'] },
      readBy: ['u-seoyeon', 'u-minjun'],
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    {
      id: 'msg-bot-1',
      roomId: 'room-bot',
      senderId: 'u-bot',
      type: 'leave_alert',
      content: '정현우 선임(프로덕트 개발팀)님이 오늘 오후반차를 등록했습니다.',
      replyToId: null,
      leaveAlert: {
        leaveId: 'leave-seed-1',
        userId: 'u-hyunwoo',
        userName: '정현우',
        department: '프로덕트 개발팀',
        position: '선임',
        leaveType: '오후반차',
        startDate: today,
        endDate: today,
        daysCount: 0.5,
        substituteName: '김민준 팀장',
        reason: '개인 병원 예약 및 휴식',
      },
      reactions: { '👌': ['u-minjun'] },
      readBy: ['u-minjun', 'u-jihoon'],
      createdAt: tMinus2h,
    },
    {
      id: 'msg-bot-2',
      roomId: 'room-bot',
      senderId: 'u-bot',
      type: 'mail_alert',
      content: '[비메일] 이서연 선임 · SG Talk 확장앱 레이아웃 최종 시안 전달',
      replyToId: null,
      mailAlert: {
        mailId: 'mail-seed-2',
        provider: 'bmail',
        senderId: 'u-seoyeon',
        senderName: '이서연 선임',
        senderEmail: 'seoyeon@sgw.co.kr',
        subject: '[UX 디자인팀] SG Talk 확장앱 레이아웃 최종 시안 전달',
        preview: '웹 확장앱·앱 모드 전환 UI 시안 전달 및 피드백 요청',
        shortSummary: '웹 확장앱·앱 모드 전환 UI 시안 전달 및 피드백 요청',
        attachmentCount: 1,
        attachmentNames: ['SGW_확장앱_UI시안_요약.txt'],
        category: '일반',
      },
      reactions: {},
      readBy: ['u-seoyeon'],
      createdAt: tMinus45m,
    },
    {
      id: 'msg-bot-3',
      roomId: 'room-bot',
      senderId: 'u-bot',
      type: 'mail_alert',
      content: '[빅메일] 이서연 선임 · 2026 SGW × SEDMS 차세대 대용량 아키텍처 설계서 송부',
      replyToId: null,
      mailAlert: {
        mailId: 'mail-seed-bigmail-1',
        provider: 'bigmail',
        senderId: 'u-seoyeon',
        senderName: '이서연 선임',
        senderEmail: 'seoyeon@sgw.co.kr',
        subject: '[빅메일] 2026 SGW × SEDMS 차세대 대용량 아키텍처 설계서 송부',
        preview: 'SGW 차세대 아키텍처 설계서 및 UI 리소스 대용량 패키지 검토 요청',
        shortSummary: 'SGW 차세대 아키텍처 설계서 및 UI 리소스 대용량 패키지 검토 요청',
        attachmentCount: 2,
        attachmentNames: ['2026_SGW_SEDMS_아키텍처_설계서.pdf', 'SGW_UI_디자인시스템_에셋.zip'],
        category: '공지',
      },
      reactions: {},
      readBy: ['u-seoyeon'],
      createdAt: tMinus10m,
    },
    {
      id: 'msg-dev-1',
      roomId: 'room-dev',
      senderId: 'u-minjun',
      type: 'text',
      content: '매주 목요일 오후 4시 스테이징 배포, 금요일 오전 10시 프로덕션 반영입니다.',
      replyToId: null,
      reactions: { '👍': ['u-hyunwoo', 'u-seoyeon'] },
      readBy: ['u-minjun', 'u-hyunwoo', 'u-seoyeon'],
      createdAt: tMinus3h,
    },
    {
      id: 'msg-dev-2',
      roomId: 'room-dev',
      senderId: 'u-hyunwoo',
      type: 'text',
      content: '@김민준 팀장님, 오늘 오후 반차여서 오전 중으로 WebSocket 이벤트 핸들러 PR 올려두겠습니다!',
      replyToId: null,
      mentions: ['u-minjun'],
      reactions: {},
      readBy: ['u-hyunwoo'],
      createdAt: tMinus25m,
    },
    {
      id: 'msg-dm-1',
      roomId: 'room-dm-minjun-seoyeon',
      senderId: 'u-seoyeon',
      type: 'text',
      content: '팀장님, 채팅방 내 공지 배너 접기/펼치기 간격 확인 부탁드려요!',
      replyToId: null,
      reactions: {},
      readBy: ['u-seoyeon'],
      createdAt: tMinus45m,
    },
    {
      id: 'msg-dm-2',
      roomId: 'room-dm-minjun-jihoon',
      senderId: 'u-jihoon',
      type: 'text',
      content: '민준님, 연차 등록 전사 알림 및 bmail 연동 테스트도 문제없이 잘 동작합니다.',
      replyToId: null,
      reactions: { '🙏': ['u-minjun'] },
      readBy: ['u-jihoon', 'u-minjun'],
      createdAt: tMinus3h,
    },
    {
      id: 'msg-self-1',
      roomId: 'room-self-u-minjun',
      senderId: 'u-minjun',
      type: 'text',
      content:
        '📌 나와의 채팅 · SEDMS × SGW AI 커맨드 허브\n음성이나 텍스트로 "내일 연차 등록", "프로젝트 달력 열어줘", "미팅메모 작성해줘", "회의 바로 시작", "SEDMS 전자결재 열어줘" 등을 입력하면 연동 브리지가 즉시 실행됩니다.',
      replyToId: null,
      reactions: {},
      readBy: ['u-minjun'],
      starredByUserIds: ['u-minjun'],
      createdAt: tMinus3h,
    },
  ];

  const notifications: NotificationItem[] = [
    ...users
      .filter((u) => u.role !== 'bot')
      .map((u) => ({
        id: `notif-seed-${u.id}`,
        userId: u.id,
        type: 'leave' as const,
        title: '[연차 알림] 정현우 선임 (프로덕트 개발팀)',
        body: `오후반차 · ${today} (0.5일) · 업무대행: 김민준 팀장`,
        roomId: 'room-bot',
        leaveId: 'leave-seed-1',
        actorId: 'u-hyunwoo',
        read: u.id === 'u-hyunwoo',
        createdAt: tMinus2h,
      })),
    {
      id: 'notif-seed-bigmail-minjun',
      userId: 'u-minjun',
      type: 'mail',
      title: '[빅메일] 이서연 선임 · 2026 SGW × SEDMS 차세대 대용량 아키텍처 설계서 송부',
      body: '내용 요약: SGW 차세대 아키텍처 설계서 및 UI 리소스 대용량 패키지 검토 요청 (📎 2026_SGW_SEDMS_아키텍처_설계서.pdf 외 1개)',
      roomId: 'room-bot',
      leaveId: null,
      mailId: 'mail-seed-bigmail-1',
      actorId: 'u-seoyeon',
      read: false,
      createdAt: tMinus10m,
    },
    {
      id: 'notif-seed-global-minjun',
      userId: 'u-minjun',
      type: 'notice',
      title: '[전체 업무 공지] 2026년 4분기 보안 점검 및 대용량 파일 링크 공유 정책',
      body: '사내 대용량 파일(최대 500MB 분할 업로드 및 100GB 단위 외부 공유 링크)은 만료일·비밀번호·다운로드 제한이 적용된 보안 공유 링크를 통해 안전하게 전달해 주세요.',
      roomId: 'room-company',
      leaveId: null,
      noticeId: 'notice-global-1',
      actorId: 'u-jihoon',
      read: false,
      createdAt: tMinus2h,
    },
  ];

  return {
    users,
    rooms,
    messages,
    notices,
    leaves,
    mails,
    notifications,
    files,
    scheduledMessages: [],
    sharePasscodeHashes: {},
  };
}

class GroupwareStore {
  private state: DatabaseState;
  private fileDiskMap = new Map<string, string>();

  constructor() {
    ensureDataDirs();
    if (fs.existsSync(DB_PATH)) {
      try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DatabaseState>;
        const fallback = createSeedDatabase();
        this.state = {
          users: (parsed.users ?? fallback.users).map((u) => ({
            ...u,
            presenceStatus: u.presenceStatus ?? (u.online ? 'online' : 'offline'),
          })),
          rooms: parsed.rooms ?? fallback.rooms,
          messages: parsed.messages ?? fallback.messages,
          notices: (parsed.notices ?? fallback.notices).map((n) => ({
            ...n,
            priority: normalizeNoticePriority({ priority: n.priority, isUrgent: n.isUrgent }),
            isUrgent: Boolean(n.isUrgent || n.priority === 'urgent'),
            acknowledgedBy:
              Array.isArray(n.acknowledgedBy) && n.acknowledgedBy.length > 0
                ? n.acknowledgedBy
                : n.authorId
                  ? [n.authorId]
                  : [],
          })),
          leaves: parsed.leaves ?? fallback.leaves,
          mails: parsed.mails ?? fallback.mails,
          notifications: parsed.notifications ?? fallback.notifications,
          files: parsed.files ?? fallback.files,
          scheduledMessages: parsed.scheduledMessages ?? [],
          sharePasscodeHashes: parsed.sharePasscodeHashes ?? {},
        };

        // Backfill missing BigMail / Global & Personal Notice seeds cleanly on persisted DBs
        let migrated = false;
        for (const u of this.state.users) {
          if (/SGW 메신저|WorkTalk/i.test(u.statusMessage)) {
            u.statusMessage = u.statusMessage.replace(/SGW 메신저|WorkTalk/gi, 'SG Talk');
            migrated = true;
          }
        }
        for (const seedMail of fallback.mails) {
          if (!this.state.mails.some((m) => m.id === seedMail.id)) {
            this.state.mails.unshift(seedMail);
            migrated = true;
          } else {
            const existingMail = this.state.mails.find((m) => m.id === seedMail.id);
            if (existingMail && !existingMail.provider && seedMail.provider) {
              existingMail.provider = seedMail.provider;
              existingMail.shortSummary = existingMail.shortSummary ?? seedMail.shortSummary;
              existingMail.attachments = existingMail.attachments ?? seedMail.attachments;
              migrated = true;
            }
          }
        }
        for (const seedNotice of fallback.notices) {
          const existingIdx = this.state.notices.findIndex((n) => n.id === seedNotice.id);
          if (existingIdx === -1) {
            this.state.notices.unshift(seedNotice);
            migrated = true;
          } else {
            const cur = this.state.notices[existingIdx];
            if (/\uCEE8\uD2B8\uB864 \uD0C0\uC6CC|\uC2A4\uD0C0\uC77C|\uB450\uB1CC|SGW 메신저|WorkTalk/.test(`${cur.title} ${cur.content}`)) {
              this.state.notices[existingIdx] = { ...cur, title: seedNotice.title, content: seedNotice.content };
              migrated = true;
            }
          }
        }
        for (const seedMail of fallback.mails) {
          const existing = this.state.mails.find((m) => m.id === seedMail.id);
          if (existing && /\uCEE8\uD2B8\uB864 \uD0C0\uC6CC|\uC2A4\uD0C0\uC77C|\uB450\uB1CC/.test(`${existing.subject} ${existing.body} ${existing.shortSummary ?? ''}`)) {
            existing.subject = seedMail.subject;
            existing.body = seedMail.body;
            existing.shortSummary = seedMail.shortSummary;
            migrated = true;
          }
        }
        for (const seedMsg of fallback.messages) {
          const existingIdx = this.state.messages.findIndex((m) => m.id === seedMsg.id);
          if (existingIdx === -1) {
            this.state.messages.push(seedMsg);
            migrated = true;
          } else {
            const cur = this.state.messages[existingIdx];
            if (/\uCEE8\uD2B8\uB864 \uD0C0\uC6CC|\uC2A4\uD0C0\uC77C|\uB450\uB1CC/.test(`${cur.content} ${cur.mailAlert?.preview ?? ''}`)) {
              this.state.messages[existingIdx] = {
                ...cur,
                content: seedMsg.content,
                mailAlert: seedMsg.mailAlert ?? cur.mailAlert,
              };
              migrated = true;
            }
          }
        }
        for (const seedNotif of fallback.notifications) {
          if (!this.state.notifications.some((n) => n.id === seedNotif.id)) {
            this.state.notifications.unshift(seedNotif);
            migrated = true;
          }
        }
        if (migrated) this.save();
      } catch {
        this.state = createSeedDatabase();
        this.save();
      }
    } else {
      this.state = createSeedDatabase();
      this.save();
    }

    this.fileDiskMap.set('file-guide-01', 'sample-guide.txt');
    for (const f of this.state.files) {
      if (!this.fileDiskMap.has(f.id)) {
        const expected = `${f.id}-${f.filename}`;
        if (fs.existsSync(path.join(UPLOAD_DIR, expected))) {
          this.fileDiskMap.set(f.id, expected);
        } else {
          const match = fs.readdirSync(UPLOAD_DIR).find((name) => name.startsWith(f.id));
          if (match) {
            this.fileDiskMap.set(f.id, match);
          }
        }
      }
    }
  }

  private save(): void {
    ensureDataDirs();
    const tmp = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_PATH);
  }

  getDiskPathForFile(fileId: string): { filePath: string; item: SharedFileItem } | null {
    const item = this.state.files.find((f) => f.id === fileId);
    if (!item) return null;
    if (item.nasRelativePath) {
      const nasResolved = resolveNasFilePath(item.nasRelativePath);
      if (nasResolved) {
        return { filePath: nasResolved.fullPath, item };
      }
    }
    const diskName = this.fileDiskMap.get(fileId);
    if (!diskName) return null;
    const fullPath = path.resolve(UPLOAD_DIR, diskName);
    if (!isPathInsideDir(fullPath, UPLOAD_DIR)) return null;
    if (!fs.existsSync(fullPath)) return null;
    return { filePath: fullPath, item };
  }

  registerUploadedDiskName(fileId: string, diskName: string): void {
    this.fileDiskMap.set(fileId, diskName);
  }

  setUserOnline(userId: string, online: boolean): User | null {
    const user = this.state.users.find((u) => u.id === userId);
    if (!user) return null;
    user.online = online;
    if (online && user.presenceStatus === 'offline') {
      user.presenceStatus = 'online';
    } else if (!online && user.role !== 'bot') {
      user.presenceStatus = 'offline';
    }
    user.lastSeen = new Date().toISOString();
    this.save();
    return sanitizeUser(user);
  }

  getUsers(): User[] {
    return this.state.users.map(sanitizeUser);
  }

  ensureSelfRoom(userId: string): { room?: ChatRoom; created: boolean } {
    const user = this.state.users.find((u) => u.id === userId);
    if (!user || user.role === 'bot') return { created: false };

    const existing = this.state.rooms.find(
      (r) => r.type === 'self' && r.memberIds.includes(userId),
    );
    if (existing) {
      return { room: existing, created: false };
    }

    const now = new Date().toISOString();
    const room: ChatRoom = {
      id: `room-self-${userId}`,
      type: 'self',
      name: '나와의 채팅',
      description: '개인 메모, 링크 및 파일을 보관하는 나만의 채팅방',
      memberIds: [userId],
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      disappearingSeconds: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.rooms.push(room);
    this.state.messages.push({
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: userId,
      type: 'text',
      content:
        '📌 나와의 채팅 · SEDMS × SGW 허브입니다. 상단 바 또는 음성·텍스트 명령으로 연차등록, 프로젝트 달력, SGW 미팅메모, 회의를 바로 연동하세요.',
      replyToId: null,
      reactions: {},
      readBy: [userId],
      createdAt: now,
    });
    this.save();
    return { room, created: true };
  }

  getBootstrap(userId: string): BootstrapPayload | null {
    const current = this.state.users.find((u) => u.id === userId);
    if (!current) return null;

    this.ensureSelfRoom(userId);
    const nowMs = Date.now();

    const rooms = this.state.rooms.filter((r) => r.memberIds.includes(userId));
    const roomIdSet = new Set(rooms.map((r) => r.id));

    return {
      currentUser: sanitizeUser(current),
      users: this.state.users.map(sanitizeUser),
      rooms,
      messages: this.state.messages
        .filter((m) => roomIdSet.has(m.roomId) && !isMessageExpired(m, nowMs))
        .map((m) => maskViewOnceMessageForUser(m, userId)),
      notices: this.state.notices.filter(
        (n) =>
          n.scope === 'global' ||
          (n.scope === 'personal' && (n.ownerUserId === userId || n.authorId === userId)) ||
          roomIdSet.has(n.roomId),
      ),
      leaves: [...this.state.leaves].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
      mails: this.state.mails
        .filter((m) => m.senderId === userId || m.recipientIds.includes(userId))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      notifications: this.state.notifications
        .filter((n) => n.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      files: this.state.files
        .filter((f) => roomIdSet.has(f.roomId))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      scheduledMessages: (this.state.scheduledMessages ?? [])
        .filter((s) => s.senderId === userId && s.status === 'pending')
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    };
  }

  registerUser(input: {
    name: string;
    email: string;
    department: string;
    position: string;
    phone?: string;
    password: string;
  }): { user?: User; error?: string; systemMessages: Message[] } {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!name || !email || !input.password) {
      return { error: '이름, 이메일, 비밀번호는 필수 항목입니다.', systemMessages: [] };
    }
    if (this.state.users.some((u) => u.email.toLowerCase() === email)) {
      return { error: '이미 가입된 이메일입니다.', systemMessages: [] };
    }

    const now = new Date().toISOString();
    const newUser: StoredUser = {
      id: `u-${crypto.randomUUID().slice(0, 8)}`,
      name,
      email,
      department: input.department.trim() || '프로덕트 개발팀',
      position: input.position.trim() || '매니저',
      phone: input.phone?.trim() || '010-0000-0000',
      avatarUrl: '',
      statusMessage: 'SG Talk에 새로 합류했습니다!',
      presenceStatus: 'online',
      role: 'member',
      totalLeaveDays: 15,
      usedLeaveDays: 0,
      online: true,
      lastSeen: now,
      createdAt: now,
      passwordHash: hashPassword(input.password),
    };

    this.state.users.push(newUser);

    const systemMessages: Message[] = [];
    for (const room of this.state.rooms) {
      if (room.type === 'company' || room.type === 'bot') {
        if (!room.memberIds.includes(newUser.id)) {
          room.memberIds.push(newUser.id);
        }
        if (room.type === 'company') {
          const joinMsg: Message = {
            id: `msg-${crypto.randomUUID().slice(0, 8)}`,
            roomId: room.id,
            senderId: 'u-bot',
            type: 'system',
            content: `${newUser.name} ${newUser.position}(${newUser.department})님이 SG Talk에 가입했습니다.`,
            replyToId: null,
            reactions: {},
            readBy: [newUser.id],
            createdAt: now,
          };
          this.state.messages.push(joinMsg);
          room.updatedAt = now;
          systemMessages.push(joinMsg);
        }
      }
    }

    this.ensureSelfRoom(newUser.id);
    this.save();
    return { user: sanitizeUser(newUser), systemMessages };
  }

  loginUser(email: string, password: string): { user?: User; error?: string } {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password) {
      return { error: '회사 이메일과 비밀번호를 입력해주세요.' };
    }
    const found = this.state.users.find((u) => u.email.toLowerCase() === normalized && u.role !== 'bot');
    const candidateHash = hashPassword(password);
    const dummyHash = found ? found.passwordHash : hashPassword('dummy-timing-guard-placeholder');
    const storedBuf = Buffer.from(dummyHash, 'hex');
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const matches =
      Boolean(found) &&
      storedBuf.length === candidateBuf.length &&
      crypto.timingSafeEqual(storedBuf, candidateBuf);

    if (!matches || !found) {
      return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
    }
    found.online = true;
    if (found.presenceStatus === 'offline') found.presenceStatus = 'online';
    found.lastSeen = new Date().toISOString();
    this.save();
    return { user: sanitizeUser(found) };
  }

  updateUserProfile(
    userId: string,
    patch: {
      statusMessage?: string;
      presenceStatus?: PresenceStatus;
      department?: string;
      position?: string;
      phone?: string;
    },
  ): User | null {
    const user = this.state.users.find((u) => u.id === userId);
    if (!user) return null;
    if (typeof patch.statusMessage === 'string') user.statusMessage = patch.statusMessage.slice(0, 80);
    if (patch.presenceStatus) {
      user.presenceStatus = patch.presenceStatus;
      user.online = patch.presenceStatus !== 'offline';
    }
    if (typeof patch.department === 'string' && patch.department.trim()) user.department = patch.department.trim();
    if (typeof patch.position === 'string' && patch.position.trim()) user.position = patch.position.trim();
    if (typeof patch.phone === 'string') user.phone = patch.phone.trim();
    this.save();
    return sanitizeUser(user);
  }

  createOrFindRoom(input: {
    creatorId: string;
    memberIds: string[];
    name?: string;
    description?: string;
  }): { room: ChatRoom; created: boolean; systemMessage?: Message } {
    const uniqueMembers = Array.from(new Set([input.creatorId, ...input.memberIds]));
    if (uniqueMembers.length === 2 && !input.name?.trim()) {
      const existing = this.state.rooms.find(
        (r) =>
          r.type === 'direct' &&
          r.memberIds.length === 2 &&
          uniqueMembers.every((id) => r.memberIds.includes(id)),
      );
      if (existing) {
        return { room: existing, created: false };
      }
    }

    const now = new Date().toISOString();
    const isDirect = uniqueMembers.length === 2 && !input.name?.trim();
    const memberNames = uniqueMembers
      .filter((id) => id !== input.creatorId)
      .map((id) => this.state.users.find((u) => u.id === id)?.name ?? '사원')
      .join(', ');

    const room: ChatRoom = {
      id: `room-${crypto.randomUUID().slice(0, 8)}`,
      type: isDirect ? 'direct' : 'group',
      name: isDirect ? memberNames : input.name?.trim() || `${memberNames} 그룹채팅`,
      description: input.description?.trim() || '',
      memberIds: uniqueMembers,
      pinnedByUserIds: [],
      mutedByUserIds: [],
      activeNoticeId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.state.rooms.push(room);

    let systemMessage: Message | undefined;
    if (!isDirect) {
      const creator = this.state.users.find((u) => u.id === input.creatorId);
      systemMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        roomId: room.id,
        senderId: 'u-bot',
        type: 'system',
        content: `${creator?.name ?? '사용자'}님이 ${room.name} 채팅방을 개설했습니다.`,
        replyToId: null,
        reactions: {},
        readBy: [input.creatorId],
        createdAt: now,
      };
      this.state.messages.push(systemMessage);
    }

    this.save();
    return { room, created: true, systemMessage };
  }

  toggleRoomPin(roomId: string, userId: string): ChatRoom | null {
    const room = this.state.rooms.find((r) => r.id === roomId);
    if (!room) return null;
    if (room.pinnedByUserIds.includes(userId)) {
      room.pinnedByUserIds = room.pinnedByUserIds.filter((id) => id !== userId);
    } else {
      room.pinnedByUserIds = [...room.pinnedByUserIds, userId];
    }
    this.save();
    return room;
  }

  toggleRoomMute(roomId: string, userId: string): ChatRoom | null {
    const room = this.state.rooms.find((r) => r.id === roomId);
    if (!room) return null;
    if (room.mutedByUserIds.includes(userId)) {
      room.mutedByUserIds = room.mutedByUserIds.filter((id) => id !== userId);
    } else {
      room.mutedByUserIds = [...room.mutedByUserIds, userId];
    }
    this.save();
    return room;
  }

  inviteToRoom(roomId: string, inviterId: string, userIds: string[]): { room?: ChatRoom; systemMessage?: Message } {
    const room = this.state.rooms.find((r) => r.id === roomId);
    if (!room) return {};
    const addedNames: string[] = [];
    for (const id of userIds) {
      if (!room.memberIds.includes(id)) {
        room.memberIds.push(id);
        const u = this.state.users.find((user) => user.id === id);
        if (u) addedNames.push(u.name);
      }
    }
    if (addedNames.length === 0) return { room };
    if (room.type === 'direct' && room.memberIds.length > 2) {
      room.type = 'group';
      room.name = room.memberIds
        .map((id) => this.state.users.find((u) => u.id === id)?.name ?? '')
        .filter(Boolean)
        .join(', ');
    }
    const now = new Date().toISOString();
    room.updatedAt = now;
    const inviter = this.state.users.find((u) => u.id === inviterId);
    const systemMessage: Message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: 'u-bot',
      type: 'system',
      content: `${inviter?.name ?? '동료'}님이 ${addedNames.join(', ')}님을 초대했습니다.`,
      replyToId: null,
      reactions: {},
      readBy: [inviterId],
      createdAt: now,
    };
    this.state.messages.push(systemMessage);
    this.save();
    return { room, systemMessage };
  }

  addMessage(input: {
    roomId: string;
    senderId: string;
    type: Message['type'];
    content: string;
    replyToId?: string | null;
    emoticonId?: string;
    poll?: PollData;
    scheduleCard?: ScheduleCardData;
    drawCard?: DrawCardData;
    file?: FileAttachment;
    voice?: VoiceAttachment;
    integrationAlert?: IntegrationActionSummary;
    mentions?: string[];
    forwardedFrom?: ForwardedMeta | null;
    viewOnce?: boolean;
  }): { message?: Message; room?: ChatRoom; error?: string } {
    const room = this.state.rooms.find((r) => r.id === input.roomId);
    if (!room) return { error: '채팅방을 찾을 수 없습니다.' };
    if (!room.memberIds.includes(input.senderId) && input.senderId !== 'u-bot') {
      return { error: '채팅방 멤버가 아닙니다.' };
    }

    const roomMembers = room.memberIds
      .map((id) => this.state.users.find((u) => u.id === id))
      .filter((u): u is StoredUser => Boolean(u));
    const computedMentions =
      input.mentions ??
      (input.type === 'text' ? extractMentionUserIds(input.content, roomMembers) : []);

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const expiresAt =
      room.disappearingSeconds && room.disappearingSeconds > 0 && input.type !== 'system'
        ? new Date(nowMs + room.disappearingSeconds * 1000).toISOString()
        : null;

    const message: Message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: input.senderId,
      type: input.type,
      content: input.content,
      replyToId: input.replyToId ?? null,
      emoticonId: input.emoticonId,
      poll: input.poll,
      scheduleCard: input.scheduleCard,
      drawCard: input.drawCard,
      file: input.file,
      voice: input.voice,
      integrationAlert: input.integrationAlert,
      reactions: {},
      readBy: [input.senderId],
      starredByUserIds: [],
      mentions: computedMentions,
      forwardedFrom: input.forwardedFrom ?? null,
      expiresAt,
      ...(input.viewOnce ? { viewOnce: true, viewedByUserIds: [] } : {}),
      createdAt: now,
    };

    this.state.messages.push(message);
    room.updatedAt = now;

    if (input.file) {
      const sharedFile: SharedFileItem = {
        id: input.file.id,
        roomId: room.id,
        uploaderId: input.senderId,
        messageId: message.id,
        filename: input.file.filename,
        mimeType: input.file.mimeType,
        size: input.file.size,
        url: input.file.url,
        isImage: input.file.isImage,
        ...(input.file.shareUrl ? { shareUrl: input.file.shareUrl } : {}),
        ...(input.file.shareExpiresAt ? { shareExpiresAt: input.file.shareExpiresAt } : {}),
        ...(input.file.isLargeFile !== undefined ? { isLargeFile: input.file.isLargeFile } : {}),
        ...(input.file.isExternalLink !== undefined ? { isExternalLink: input.file.isExternalLink } : {}),
        ...(input.file.shareProvider ? { shareProvider: input.file.shareProvider } : {}),
        ...(input.file.transferMode ? { transferMode: input.file.transferMode } : {}),
        ...(input.file.storageLocation ? { storageLocation: input.file.storageLocation } : {}),
        ...(input.file.nasFolder ? { nasFolder: input.file.nasFolder } : {}),
        ...(input.file.nasRelativePath ? { nasRelativePath: input.file.nasRelativePath } : {}),
        ...(input.file.nasExternalAccessUrl
          ? { nasExternalAccessUrl: input.file.nasExternalAccessUrl }
          : {}),
        ...(input.file.hasPasscode !== undefined ? { hasPasscode: input.file.hasPasscode } : {}),
        ...(input.file.maxDownloads !== undefined ? { maxDownloads: input.file.maxDownloads } : {}),
        ...(input.file.downloadCount !== undefined ? { downloadCount: input.file.downloadCount } : {}),
        ...(input.file.revoked !== undefined ? { revoked: input.file.revoked } : {}),
        createdAt: now,
      };
      this.state.files.unshift(sharedFile);
    }

    this.save();
    return { message, room };
  }

  getSharedFileById(fileId: string): SharedFileItem | undefined {
    return this.state.files.find((f) => f.id === fileId);
  }

  setFileShareMetadata(
    fileId: string,
    patch: {
      shareUrl: string;
      shareExpiresAt: string;
      isLargeFile?: boolean;
      isExternalLink?: boolean;
    },
  ): SharedFileItem | null {
    const f = this.state.files.find((item) => item.id === fileId);
    if (!f) return null;
    f.shareUrl = patch.shareUrl;
    f.shareExpiresAt = patch.shareExpiresAt;
    if (patch.isLargeFile !== undefined) f.isLargeFile = patch.isLargeFile;
    if (patch.isExternalLink !== undefined) f.isExternalLink = patch.isExternalLink;
    for (const m of this.state.messages) {
      if (m.file && m.file.id === fileId) {
        m.file.shareUrl = patch.shareUrl;
        m.file.shareExpiresAt = patch.shareExpiresAt;
        if (patch.isLargeFile !== undefined) m.file.isLargeFile = patch.isLargeFile;
        if (patch.isExternalLink !== undefined) m.file.isExternalLink = patch.isExternalLink;
      }
    }
    this.save();
    return f;
  }

  updateMessageVoiceAnalysis(
    messageId: string,
    patch: { transcript?: string; analysis: VoiceAnalysisResult },
  ): Message | null {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.type !== 'voice' || !msg.voice) return null;
    if (patch.transcript && patch.transcript.trim()) {
      msg.voice.transcript = patch.transcript.trim();
    }
    msg.voice.analysis = patch.analysis;
    this.save();
    return msg;
  }

  getMessageById(messageId: string): Message | undefined {
    return this.state.messages.find((m) => m.id === messageId);
  }

  getRoomById(roomId: string): ChatRoom | undefined {
    return this.state.rooms.find((r) => r.id === roomId);
  }

  markRoomRead(roomId: string, userId: string): { updatedMessageIds: string[] } {
    const updatedMessageIds: string[] = [];
    for (const msg of this.state.messages) {
      if (msg.roomId !== roomId) continue;
      if (!msg.readBy.includes(userId)) {
        msg.readBy.push(userId);
        updatedMessageIds.push(msg.id);
      }
    }
    if (updatedMessageIds.length > 0) {
      this.save();
    }
    return { updatedMessageIds };
  }

  toggleReaction(messageId: string, emoji: string, userId: string): Message | null {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.deleted) return null;
    msg.reactions = toggleReactionMap(msg.reactions, emoji, userId);
    this.save();
    return msg;
  }

  setReactionExplicit(messageId: string, emoji: string, userId: string, on: boolean): Message | null {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.deleted) return null;
    const current = msg.reactions[emoji] ?? [];
    const exists = current.includes(userId);
    if ((on && !exists) || (!on && exists)) {
      msg.reactions = toggleReactionMap(msg.reactions, emoji, userId);
      this.save();
    }
    return msg;
  }

  markMessageViewedOnce(
    messageId: string,
    userId: string,
  ): { message?: Message; room?: ChatRoom; alreadyViewed?: boolean; error?: string } {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.deleted || msg.recalled) {
      return { error: '메시지를 찾을 수 없습니다.' };
    }
    const room = this.state.rooms.find((r) => r.id === msg.roomId);
    if (!room || !room.memberIds.includes(userId)) {
      return { error: '열람 권한이 없습니다.' };
    }
    if (!msg.viewOnce) {
      return { message: msg, room };
    }
    if (msg.senderId === userId) {
      return { message: msg, room };
    }
    const viewedBy = msg.viewedByUserIds ?? [];
    if (viewedBy.includes(userId)) {
      return { alreadyViewed: true, error: '이미 1회 열람이 완료되어 보안 잠금된 메시지입니다.' };
    }
    msg.viewedByUserIds = [...viewedBy, userId];
    if (!msg.readBy.includes(userId)) {
      msg.readBy.push(userId);
    }
    this.save();
    return { message: { ...msg }, room };
  }

  markAllRoomsRead(userId: string): { updatedRoomIds: string[] } {
    const updatedRoomIds: string[] = [];
    for (const room of this.state.rooms) {
      if (!room.memberIds.includes(userId)) continue;
      const res = this.markRoomRead(room.id, userId);
      if (res.updatedMessageIds.length > 0) {
        updatedRoomIds.push(room.id);
      }
    }
    return { updatedRoomIds };
  }

  toggleScheduleRsvp(
    messageId: string,
    userId: string,
    choice: 'yes' | 'maybe' | 'no',
  ): { message?: Message; room?: ChatRoom; error?: string } {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.deleted || msg.type !== 'schedule_card' || !msg.scheduleCard) {
      return { error: '일정 공유 메시지를 찾을 수 없습니다.' };
    }
    const room = this.state.rooms.find((r) => r.id === msg.roomId);
    if (!room || !room.memberIds.includes(userId)) {
      return { error: '채팅방 멤버만 참석 여부를 응답할 수 있습니다.' };
    }
    msg.scheduleCard = toggleScheduleRsvpLists(msg.scheduleCard, userId, choice);
    this.save();
    return { message: msg, room };
  }

  deleteMessage(messageId: string, userId: string): Message | null {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.senderId !== userId) return null;
    msg.deleted = true;
    msg.content = '삭제된 메시지입니다.';
    msg.file = undefined;
    msg.voice = undefined;
    this.save();
    return msg;
  }

  recallMessage(messageId: string, userId: string): { message?: Message; error?: string } {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg) return { error: '메시지를 찾을 수 없습니다.' };
    if (msg.senderId !== userId) return { error: '본인의 메시지만 회수할 수 있습니다.' };
    if (msg.deleted || msg.recalled || msg.type === 'system') {
      return { error: '이미 삭제되었거나 회수할 수 없는 메시지입니다.' };
    }
    const sender = this.state.users.find((u) => u.id === userId);
    if (msg.type === 'text' && msg.content.trim()) {
      msg.recalledOriginalContent = msg.content;
    }
    msg.recalled = true;
    msg.type = 'text';
    msg.content = `${sender?.name ?? '사원'}님이 메시지를 회수했습니다.`;
    msg.file = undefined;
    msg.voice = undefined;
    msg.poll = undefined;
    msg.emoticonId = undefined;
    msg.editedAt = null;
    msg.mentions = [];
    this.save();
    return { message: msg };
  }

  editMessage(messageId: string, userId: string, newContent: string): { message?: Message; error?: string } {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg) return { error: '메시지를 찾을 수 없습니다.' };
    if (msg.senderId !== userId) return { error: '본인의 메시지만 수정할 수 있습니다.' };
    if (msg.deleted || msg.recalled || msg.type !== 'text') return { error: '텍스트 메시지만 수정할 수 있습니다.' };
    const trimmed = newContent.trim();
    if (!trimmed) return { error: '메시지 내용을 입력해주세요.' };

    const room = this.state.rooms.find((r) => r.id === msg.roomId);
    const roomMembers = (room?.memberIds ?? [])
      .map((id) => this.state.users.find((u) => u.id === id))
      .filter((u): u is StoredUser => Boolean(u));

    msg.content = trimmed;
    msg.editedAt = new Date().toISOString();
    msg.mentions = extractMentionUserIds(trimmed, roomMembers);
    this.save();
    return { message: msg };
  }

  toggleStarMessage(messageId: string, userId: string): Message | null {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || msg.deleted || msg.recalled) return null;
    const list = msg.starredByUserIds ?? [];
    msg.starredByUserIds = list.includes(userId)
      ? list.filter((id) => id !== userId)
      : [...list, userId];
    this.save();
    return msg;
  }

  forwardMessages(input: {
    senderId: string;
    messageIds: string[];
    targetRoomId?: string;
    targetUserId?: string;
  }): {
    room?: ChatRoom;
    roomCreated?: boolean;
    messages: Message[];
    error?: string;
  } {
    const sender = this.state.users.find((u) => u.id === input.senderId);
    if (!sender) return { messages: [], error: '사용자를 찾을 수 없습니다.' };

    let targetRoom: ChatRoom | undefined;
    let roomCreated = false;

    if (input.targetRoomId) {
      targetRoom = this.state.rooms.find((r) => r.id === input.targetRoomId);
    } else if (input.targetUserId) {
      const dm = this.createOrFindRoom({
        creatorId: input.senderId,
        memberIds: [input.targetUserId],
      });
      targetRoom = dm.room;
      roomCreated = dm.created;
    }

    if (!targetRoom) return { messages: [], error: '전달할 대상 채팅방을 찾을 수 없습니다.' };
    if (!targetRoom.memberIds.includes(input.senderId)) {
      return { messages: [], error: '대상 채팅방 멤버가 아닙니다.' };
    }

    const originals = input.messageIds
      .map((id) => this.state.messages.find((m) => m.id === id))
      .filter((m): m is Message => Boolean(m && !m.deleted && !m.recalled));

    if (originals.length === 0) {
      return { messages: [], error: '전달할 수 있는 메시지가 없습니다.' };
    }

    const createdMessages: Message[] = [];
    for (const orig of originals) {
      const origSender = this.state.users.find((u) => u.id === orig.senderId);
      const origRoom = this.state.rooms.find((r) => r.id === orig.roomId);
      const forwardType: Message['type'] =
        orig.type === 'file' ||
        orig.type === 'image' ||
        orig.type === 'emoticon' ||
        orig.type === 'voice'
          ? orig.type
          : 'text';
      const forwardContent =
        orig.type === 'poll'
          ? `[투표] ${orig.poll?.question ?? orig.content}`
          : orig.type === 'leave_alert'
            ? `[연차 알림] ${orig.content}`
            : orig.content;

      const added = this.addMessage({
        roomId: targetRoom.id,
        senderId: input.senderId,
        type: forwardType,
        content: forwardContent,
        emoticonId: orig.emoticonId,
        file: orig.file,
        voice: orig.voice,
        forwardedFrom: {
          senderName: origSender ? `${origSender.name} ${origSender.position}` : '사원',
          roomName: origRoom?.name,
          originalCreatedAt: orig.createdAt,
        },
      });
      if (added.message) {
        createdMessages.push(added.message);
      }
    }

    return { room: targetRoom, roomCreated, messages: createdMessages };
  }

  setRoomDisappearing(
    roomId: string,
    userId: string,
    disappearingSeconds: number | null,
  ): { room?: ChatRoom; systemMessage?: Message; error?: string } {
    const room = this.state.rooms.find((r) => r.id === roomId);
    if (!room) return { error: '채팅방을 찾을 수 없습니다.' };
    if (!room.memberIds.includes(userId)) {
      return { error: '채팅방 멤버만 설정할 수 있습니다.' };
    }
    const allowed =
      disappearingSeconds === 300 ||
      disappearingSeconds === 3600 ||
      disappearingSeconds === 86400 ||
      disappearingSeconds === 604800
        ? disappearingSeconds
        : null;
    room.disappearingSeconds = allowed;
    const now = new Date().toISOString();
    room.updatedAt = now;

    const actor = this.state.users.find((u) => u.id === userId);
    const label =
      allowed === 300
        ? '5분'
        : allowed === 3600
          ? '1시간'
          : allowed === 86400
            ? '24시간'
            : allowed === 604800
              ? '7일'
              : '사용 안 함';
    const systemMessage: Message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: 'u-bot',
      type: 'system',
      content: `${actor?.name ?? '사원'}님이 사라지는 메시지 타이머를 [${label}]으로 변경했습니다.`,
      replyToId: null,
      reactions: {},
      readBy: [userId],
      createdAt: now,
    };
    this.state.messages.push(systemMessage);
    this.save();
    return { room, systemMessage };
  }

  leaveRoom(roomId: string, userId: string): { room?: ChatRoom; systemMessage?: Message; error?: string } {
    const room = this.state.rooms.find((r) => r.id === roomId);
    if (!room) return { error: '채팅방을 찾을 수 없습니다.' };
    if (room.type !== 'group') {
      return { error: '그룹 채팅방만 나가기 할 수 있습니다.' };
    }
    if (!room.memberIds.includes(userId)) {
      return { error: '참여 중인 채팅방이 아닙니다.' };
    }

    const user = this.state.users.find((u) => u.id === userId);
    const previousMembers = [...room.memberIds];
    room.memberIds = room.memberIds.filter((id) => id !== userId);
    room.pinnedByUserIds = room.pinnedByUserIds.filter((id) => id !== userId);
    room.mutedByUserIds = room.mutedByUserIds.filter((id) => id !== userId);
    const now = new Date().toISOString();
    room.updatedAt = now;

    const systemMessage: Message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: 'u-bot',
      type: 'system',
      content: `${user?.name ?? '사원'}님이 채팅방에서 나갔습니다.`,
      replyToId: null,
      reactions: {},
      readBy: previousMembers,
      createdAt: now,
    };
    this.state.messages.push(systemMessage);
    this.save();
    return { room, systemMessage };
  }

  votePoll(messageId: string, optionId: string, userId: string): Message | null {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (!msg || !msg.poll) return null;
    const poll = msg.poll;
    if (!poll.allowMultiple) {
      for (const opt of poll.options) {
        opt.voterIds = opt.voterIds.filter((id) => id !== userId);
      }
    }
    const target = poll.options.find((o) => o.id === optionId);
    if (!target) return null;
    if (target.voterIds.includes(userId)) {
      target.voterIds = target.voterIds.filter((id) => id !== userId);
    } else {
      target.voterIds.push(userId);
    }
    this.save();
    return msg;
  }

  createNotice(input: {
    roomId: string;
    authorId: string;
    title: string;
    content: string;
    messageId?: string | null;
    priority?: NoticePriority;
    isUrgent?: boolean;
    pushAllMembers?: boolean;
  }): {
    notice?: Notice;
    room?: ChatRoom;
    alertMessage?: Message;
    notifications: NotificationItem[];
    pushTargetUserIds: string[];
    error?: string;
  } {
    const room = this.state.rooms.find((r) => r.id === input.roomId);
    if (!room) return { error: '채팅방을 찾을 수 없습니다.', notifications: [], pushTargetUserIds: [] };
    if (!input.content.trim()) return { error: '공지 내용을 입력해주세요.', notifications: [], pushTargetUserIds: [] };

    const priority = normalizeNoticePriority({
      priority: input.priority,
      isUrgent: input.isUrgent,
    });
    const isUrgent = priority === 'urgent' || Boolean(input.isUrgent);
    const pushAllMembers = Boolean(input.pushAllMembers || isUrgent);
    const priorityMeta = getNoticePriorityMeta(priority);

    const now = new Date().toISOString();
    for (const existing of this.state.notices) {
      if (existing.roomId === room.id) existing.pinned = false;
    }

    const notice: Notice = {
      id: `notice-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      scope: room.type === 'self' ? 'personal' : 'room',
      messageId: input.messageId ?? null,
      authorId: input.authorId,
      title: input.title.trim() || (isUrgent ? '전 회원 긴급 공지' : '채팅방 공지'),
      content: input.content.trim(),
      pinned: true,
      priority,
      isUrgent,
      pushAllMembers,
      acknowledgedBy: [input.authorId],
      updatedAt: now,
      createdAt: now,
    };
    this.state.notices.unshift(notice);
    room.activeNoticeId = notice.id;
    room.updatedAt = now;

    const author = this.state.users.find((u) => u.id === input.authorId);
    const alertMessage: Message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: input.authorId,
      type: 'notice_alert',
      content: `${priorityMeta.emergencyPrefix} ${notice.title}\n${notice.content}`,
      replyToId: input.messageId ?? null,
      noticeAlert: {
        noticeId: notice.id,
        title: notice.title,
        priority,
        isUrgent,
        pushAllMembers,
      },
      reactions: {},
      readBy: [input.authorId],
      createdAt: now,
    };
    this.state.messages.push(alertMessage);

    const recipientIds = pushAllMembers
      ? this.state.users.filter((u) => u.role !== 'bot').map((u) => u.id)
      : room.memberIds;

    const notifications: NotificationItem[] = [];
    for (const memberId of recipientIds) {
      const member = this.state.users.find((u) => u.id === memberId);
      if (!member || member.role === 'bot' || member.id === input.authorId) continue;
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: member.id,
        type: 'notice',
        title: isUrgent
          ? `[긴급재난문자] ${notice.title}`
          : `${priorityMeta.emergencyPrefix} ${room.name}`,
        body: `${author?.name ?? '동료'} (${room.name}): ${notice.content.slice(0, 80)}`,
        roomId: room.id,
        leaveId: null,
        noticeId: notice.id,
        priority: isUrgent ? 'urgent' : 'normal',
        isUrgent,
        actorId: input.authorId,
        read: false,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    const pushTargetUserIds = Array.from(
      new Set(
        this.state.users
          .filter((u) => u.role !== 'bot' && (pushAllMembers || room.memberIds.includes(u.id)))
          .map((u) => u.id),
      ),
    );

    this.save();
    return { notice, room, alertMessage, notifications, pushTargetUserIds };
  }

  acknowledgeNotice(
    noticeId: string,
    userId: string,
  ): { notice?: Notice; room?: ChatRoom; error?: string } {
    const notice = this.state.notices.find((n) => n.id === noticeId);
    if (!notice) return { error: '공지사항을 찾을 수 없습니다.' };
    const room = this.state.rooms.find((r) => r.id === notice.roomId);
    const isAllowed =
      notice.scope === 'global' ||
      notice.pushAllMembers ||
      notice.isUrgent ||
      (notice.scope === 'personal' && (notice.ownerUserId === userId || notice.authorId === userId)) ||
      Boolean(room && room.memberIds.includes(userId));
    if (!isAllowed) {
      return { error: '공지 확인 권한이 없습니다.' };
    }

    notice.acknowledgedBy = toggleNoticeAckList(notice.acknowledgedBy, userId);
    notice.updatedAt = new Date().toISOString();
    this.save();
    return { notice, room };
  }

  toggleNoticePin(
    noticeId: string,
    userId: string,
  ): { notice?: Notice; room?: ChatRoom; error?: string } {
    const notice = this.state.notices.find((n) => n.id === noticeId);
    if (!notice) return { error: '공지사항을 찾을 수 없습니다.' };
    const room = this.state.rooms.find((r) => r.id === notice.roomId);
    const user = this.state.users.find((u) => u.id === userId);
    const hasAccess =
      notice.scope === 'global' ||
      (notice.scope === 'personal' && (notice.ownerUserId === userId || notice.authorId === userId)) ||
      Boolean(room && room.memberIds.includes(userId)) ||
      user?.role === 'admin';
    if (!hasAccess) {
      return { error: '공지 고정 상태를 변경할 권한이 없습니다.' };
    }

    const nextPinned = !notice.pinned;
    if (nextPinned) {
      for (const item of this.state.notices) {
        if (item.roomId === notice.roomId && item.id !== notice.id) {
          item.pinned = false;
        }
      }
      if (room) {
        room.activeNoticeId = notice.id;
        room.updatedAt = new Date().toISOString();
      }
    } else if (room && room.activeNoticeId === notice.id) {
      const next = this.state.notices.find(
        (n) => n.id !== notice.id && n.roomId === notice.roomId && n.pinned,
      );
      room.activeNoticeId = next?.id ?? null;
      room.updatedAt = new Date().toISOString();
    }

    notice.pinned = nextPinned;
    notice.updatedAt = new Date().toISOString();
    this.save();
    return { notice, room };
  }

  deleteNotice(
    noticeId: string,
    userId: string,
  ): { deletedId?: string; roomId?: string; room?: ChatRoom; error?: string } {
    const idx = this.state.notices.findIndex((n) => n.id === noticeId);
    if (idx === -1) return { error: '공지사항을 찾을 수 없습니다.' };
    const notice = this.state.notices[idx];
    const user = this.state.users.find((u) => u.id === userId);
    const canDelete = notice.authorId === userId || user?.role === 'admin';
    if (!canDelete) {
      return { error: '작성자 또는 관리자만 공지를 삭제할 수 있습니다.' };
    }

    const room = this.state.rooms.find((r) => r.id === notice.roomId);
    this.state.notices.splice(idx, 1);

    if (room && room.activeNoticeId === notice.id) {
      const nextPinned = this.state.notices.find(
        (n) => n.roomId === room.id && n.pinned,
      );
      room.activeNoticeId = nextPinned?.id ?? null;
      room.updatedAt = new Date().toISOString();
    }

    this.save();
    return { deletedId: notice.id, roomId: notice.roomId, room };
  }

  pushNoticeUrgentBroadcast(
    noticeId: string,
    actorId: string,
  ): {
    notice?: Notice;
    room?: ChatRoom;
    notifications: NotificationItem[];
    actor?: User;
    error?: string;
  } {
    const notice = this.state.notices.find((n) => n.id === noticeId);
    if (!notice) return { error: '공지사항을 찾을 수 없습니다.', notifications: [] };
    const room = this.state.rooms.find((r) => r.id === notice.roomId);
    const actor = this.state.users.find((u) => u.id === actorId);
    if (!actor) return { error: '사용자 정보를 찾을 수 없습니다.', notifications: [] };

    const hasAccess =
      notice.scope === 'global' ||
      notice.authorId === actorId ||
      Boolean(room && room.memberIds.includes(actorId)) ||
      actor.role === 'admin';
    if (!hasAccess) {
      return { error: '긴급 재난문자 전파 권한이 없습니다.', notifications: [] };
    }

    const now = new Date().toISOString();
    notice.priority = 'urgent';
    notice.isUrgent = true;
    notice.pushAllMembers = true;
    notice.pinned = true;
    notice.acknowledgedBy = toggleNoticeAckList(notice.acknowledgedBy, actorId);
    notice.updatedAt = now;

    if (room) {
      for (const other of this.state.notices) {
        if (other.roomId === room.id && other.id !== notice.id) other.pinned = false;
      }
      room.activeNoticeId = notice.id;
      room.updatedAt = now;
    }

    const notifications: NotificationItem[] = [];
    for (const member of this.state.users) {
      if (member.role === 'bot' || member.id === actorId) continue;
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: member.id,
        type: 'notice',
        title: `[긴급재난문자] ${notice.title}`,
        body: `${actor.name} ${actor.position} (${room?.name ?? '전사 공지'}): ${notice.content.slice(0, 80)}`,
        roomId: notice.roomId,
        leaveId: null,
        noticeId: notice.id,
        priority: 'urgent',
        isUrgent: true,
        actorId,
        read: false,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    this.save();
    return { notice, room, notifications, actor: sanitizeUser(actor) };
  }

  registerLeave(input: {
    userId: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    substituteId: string | null;
    reason: string;
  }): {
    leave?: LeaveRequest;
    updatedUser?: User;
    linkedMail?: MailMessage;
    messages: Message[];
    notifications: NotificationItem[];
    updatedRooms: ChatRoom[];
    error?: string;
  } {
    const user = this.state.users.find((u) => u.id === input.userId);
    if (!user) {
      return { error: '사용자를 찾을 수 없습니다.', messages: [], notifications: [], updatedRooms: [] };
    }

    const calc = calculateLeaveDays(input.type, input.startDate, input.endDate);
    if (!calc.valid) {
      return { error: calc.error, messages: [], notifications: [], updatedRooms: [] };
    }

    const deductsBalance = input.type === '연차' || input.type === '오전반차' || input.type === '오후반차';
    const remaining = user.totalLeaveDays - user.usedLeaveDays;
    if (deductsBalance && calc.days > remaining) {
      return {
        error: `잔여 연차(${remaining}일)가 신청 일수(${calc.days}일)보다 부족합니다.`,
        messages: [],
        notifications: [],
        updatedRooms: [],
      };
    }

    const now = new Date().toISOString();
    const leave: LeaveRequest = {
      id: `leave-${crypto.randomUUID().slice(0, 8)}`,
      userId: user.id,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      daysCount: calc.days,
      substituteId: input.substituteId || null,
      reason: input.reason.trim() || '개인 사유',
      status: '승인완료',
      createdAt: now,
    };
    this.state.leaves.unshift(leave);

    if (deductsBalance) {
      user.usedLeaveDays = Number((user.usedLeaveDays + calc.days).toFixed(1));
    }

    const substituteUser = input.substituteId
      ? this.state.users.find((u) => u.id === input.substituteId) ?? null
      : null;
    const summary = buildLeaveBroadcastSummary(
      sanitizeUser(user),
      leave,
      substituteUser ? sanitizeUser(substituteUser) : null,
    );
    const notifText = formatLeaveNotificationText(summary);

    // 1. Dispatch SGW Mail linked to Leave Registration
    const allHumanIds = this.state.users.filter((u) => u.role !== 'bot').map((u) => u.id);
    const linkedMail: MailMessage = {
      id: `mail-${crypto.randomUUID().slice(0, 8)}`,
      senderId: user.id,
      recipientIds: allHumanIds,
      subject: notifText.title,
      body: `${summary.userName} ${summary.position}(${summary.department})님이 ${summary.leaveType}(${summary.daysCount}일)를 등록했습니다.\n기간: ${
        summary.startDate === summary.endDate ? summary.startDate : `${summary.startDate} ~ ${summary.endDate}`
      }\n업무 대행: ${summary.substituteName}\n사유: ${summary.reason}`,
      category: '연차알림',
      readByUserIds: [user.id],
      linkedLeaveId: leave.id,
      createdAt: now,
    };
    this.state.mails.unshift(linkedMail);

    // 2. Create NotificationItem for EVERY registered human user
    const notifications: NotificationItem[] = [];
    for (const member of this.state.users) {
      if (member.role === 'bot') continue;
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: member.id,
        type: 'leave',
        title: notifText.title,
        body: notifText.body,
        roomId: 'room-bot',
        leaveId: leave.id,
        mailId: linkedMail.id,
        actorId: user.id,
        read: member.id === user.id,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    // 3. Post Leave Alert card in Bot room AND Company room
    const messages: Message[] = [];
    const updatedRooms: ChatRoom[] = [];
    for (const targetRoomId of ['room-bot', 'room-company']) {
      const room = this.state.rooms.find((r) => r.id === targetRoomId);
      if (!room) continue;
      const msg: Message = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        roomId: room.id,
        senderId: 'u-bot',
        type: 'leave_alert',
        content: `${user.name} ${user.position}(${user.department})님이 ${input.type}(${calc.days}일)를 등록했습니다.`,
        replyToId: null,
        leaveAlert: summary,
        reactions: {},
        readBy: [user.id],
        createdAt: now,
      };
      this.state.messages.push(msg);
      room.updatedAt = now;
      messages.push(msg);
      updatedRooms.push(room);
    }

    this.save();
    return {
      leave,
      updatedUser: sanitizeUser(user),
      linkedMail,
      messages,
      notifications,
      updatedRooms,
    };
  }

  sendMail(input: {
    senderId: string;
    recipientIds: string[];
    subject: string;
    body: string;
    provider?: MailProvider;
    attachments?: MailAttachmentItem[];
    category?: MailCategory;
    inReplyToMailId?: string | null;
    syncToRoomId?: string | null;
  }): {
    mail?: MailMessage;
    alertMessage?: Message;
    botRoom?: ChatRoom;
    syncedRoomMessage?: Message;
    syncedRoom?: ChatRoom;
    notifications: NotificationItem[];
    error?: string;
  } {
    const sender = this.state.users.find((u) => u.id === input.senderId);
    if (!sender) {
      return { error: '발신자를 찾을 수 없습니다.', notifications: [] };
    }
    if (!input.subject.trim() || !input.body.trim()) {
      return { error: '메일 제목과 본문을 입력해주세요.', notifications: [] };
    }

    const targetIds =
      input.recipientIds.length > 0
        ? Array.from(new Set(input.recipientIds))
        : this.state.users.filter((u) => u.role !== 'bot' && u.id !== sender.id).map((u) => u.id);

    const provider: MailProvider = input.provider === 'bigmail' ? 'bigmail' : 'bmail';
    const senderName = `${sender.name} ${sender.position}`;
    const now = new Date().toISOString();
    const mail: MailMessage = {
      id: `${provider}-${crypto.randomUUID().slice(0, 8)}`,
      provider,
      senderId: sender.id,
      recipientIds: targetIds,
      subject: input.subject.trim(),
      body: input.body.trim(),
      attachments: input.attachments ?? [],
      category: input.category ?? '일반',
      readByUserIds: [sender.id],
      ...(input.inReplyToMailId ? { inReplyToMailId: input.inReplyToMailId } : {}),
      ...(input.syncToRoomId ? { originRoomId: input.syncToRoomId } : {}),
      createdAt: now,
    };
    const digest = buildConciseMailDigest(mail, senderName);
    mail.shortSummary = digest.shortSummary;
    this.state.mails.unshift(mail);

    const mailAlertPayload = {
      mailId: mail.id,
      provider: digest.provider,
      senderId: sender.id,
      senderName,
      senderEmail: sender.email,
      subject: mail.subject,
      preview: digest.shortSummary,
      shortSummary: digest.shortSummary,
      attachmentCount: digest.attachmentCount,
      attachmentNames: digest.attachmentNames,
      category: mail.category,
    };

    const botRoom = this.state.rooms.find((r) => r.id === 'room-bot');
    let alertMessage: Message | undefined;
    if (botRoom) {
      alertMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        roomId: botRoom.id,
        senderId: 'u-bot',
        type: 'mail_alert',
        content: `${digest.alertTitle}\n${digest.alertBody}`,
        replyToId: null,
        mailAlert: mailAlertPayload,
        reactions: {},
        readBy: [sender.id],
        createdAt: now,
      };
      this.state.messages.push(alertMessage);
      botRoom.updatedAt = now;
    }

    let syncedRoomMessage: Message | undefined;
    let syncedRoom: ChatRoom | undefined;
    if (input.syncToRoomId && input.syncToRoomId !== 'room-bot') {
      const originRoom = this.state.rooms.find(
        (r) => r.id === input.syncToRoomId && r.memberIds.includes(sender.id),
      );
      if (originRoom) {
        syncedRoomMessage = {
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          roomId: originRoom.id,
          senderId: sender.id,
          type: 'mail_alert',
          content: `${digest.alertTitle}\n${digest.alertBody}`,
          replyToId: null,
          mailAlert: mailAlertPayload,
          reactions: {},
          readBy: [sender.id],
          createdAt: now,
        };
        this.state.messages.push(syncedRoomMessage);
        originRoom.updatedAt = now;
        syncedRoom = originRoom;
      }
    }

    const notifications: NotificationItem[] = [];
    for (const rid of targetIds) {
      if (rid === sender.id) continue;
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: rid,
        type: 'mail',
        title: digest.alertTitle,
        body: digest.alertBody,
        roomId: syncedRoom?.id ?? 'room-bot',
        leaveId: null,
        mailId: mail.id,
        actorId: sender.id,
        read: false,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    this.save();
    return {
      mail,
      alertMessage,
      botRoom,
      syncedRoomMessage,
      syncedRoom,
      notifications,
    };
  }

  receiveBmailWebhook(input: {
    senderId?: string;
    senderEmail?: string;
    senderName?: string;
    recipientIds?: string[];
    recipientEmails?: string[];
    subject: string;
    preview?: string;
    body?: string;
    category?: MailCategory;
    externalMailId?: string;
  }): {
    mail?: MailMessage;
    alertMessage?: Message;
    botRoom?: ChatRoom;
    notifications: NotificationItem[];
    error?: string;
  } {
    const sender =
      (input.senderId && this.state.users.find((u) => u.id === input.senderId)) ||
      (input.senderEmail &&
        this.state.users.find(
          (u) => u.email.toLowerCase() === input.senderEmail!.trim().toLowerCase(),
        )) ||
      this.state.users.find((u) => u.role !== 'bot');

    if (!sender) {
      return { error: '발신자를 찾을 수 없습니다.', notifications: [] };
    }
    const subject = input.subject.trim();
    const bodyText = (input.body ?? input.preview ?? '').trim();
    if (!subject) {
      return { error: 'bmail 메일 제목이 필요합니다.', notifications: [] };
    }

    const resolvedRecipientIds = new Set<string>(input.recipientIds ?? []);
    for (const email of input.recipientEmails ?? []) {
      const matched = this.state.users.find(
        (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
      );
      if (matched) resolvedRecipientIds.add(matched.id);
    }

    const targetIds =
      resolvedRecipientIds.size > 0
        ? Array.from(resolvedRecipientIds)
        : this.state.users.filter((u) => u.role !== 'bot' && u.id !== sender.id).map((u) => u.id);

    const now = new Date().toISOString();
    const mailId = input.externalMailId?.trim() || `bmail-${crypto.randomUUID().slice(0, 8)}`;
    const mail: MailMessage = {
      id: mailId,
      senderId: sender.id,
      recipientIds: targetIds,
      subject,
      body: bodyText || subject,
      category: input.category ?? '일반',
      readByUserIds: [sender.id],
      createdAt: now,
    };
    this.state.mails.unshift(mail);

    const botRoom = this.state.rooms.find((r) => r.id === 'room-bot');
    let alertMessage: Message | undefined;
    const displaySenderName = input.senderName?.trim() || `${sender.name} ${sender.position}`;
    const displaySenderEmail = input.senderEmail?.trim() || sender.email;
    if (botRoom) {
      alertMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        roomId: botRoom.id,
        senderId: 'u-bot',
        type: 'mail_alert',
        content: `[bmail 도착] ${mail.subject}`,
        replyToId: null,
        mailAlert: {
          mailId: mail.id,
          senderId: sender.id,
          senderName: displaySenderName,
          senderEmail: displaySenderEmail,
          subject: mail.subject,
          preview: mail.body.slice(0, 120),
          category: mail.category,
        },
        reactions: {},
        readBy: [sender.id],
        createdAt: now,
      };
      this.state.messages.push(alertMessage);
      botRoom.updatedAt = now;
    }

    const notifications: NotificationItem[] = [];
    for (const rid of targetIds) {
      if (rid === sender.id) continue;
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: rid,
        type: 'mail',
        title: `[bmail] ${displaySenderName}`,
        body: mail.subject,
        roomId: 'room-bot',
        leaveId: null,
        mailId: mail.id,
        actorId: sender.id,
        read: false,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    this.save();
    return { mail, alertMessage, botRoom, notifications };
  }

  markMailRead(mailId: string, userId: string): MailMessage | null {
    const mail = this.state.mails.find((m) => m.id === mailId);
    if (!mail) return null;
    if (!mail.readByUserIds.includes(userId)) {
      mail.readByUserIds.push(userId);
      this.save();
    }
    return mail;
  }

  markNotificationRead(notificationId: string, userId: string): NotificationItem | null {
    const item = this.state.notifications.find((n) => n.id === notificationId && n.userId === userId);
    if (!item) return null;
    item.read = true;
    this.save();
    return item;
  }

  markAllNotificationsRead(userId: string): void {
    let changed = false;
    for (const n of this.state.notifications) {
      if (n.userId === userId && !n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  receiveSgwSedmsWebhook(input: {
    system: 'SEDMS' | 'SGW';
    menuKey: SedmsMenuKey;
    title: string;
    description?: string;
    actionLabel?: string;
    payload?: Record<string, string>;
    userId?: string;
    email?: string;
    roomId?: string;
    target?: 'self' | 'room';
  }): {
    message?: Message;
    room?: ChatRoom;
    notification?: NotificationItem;
    error?: string;
  } {
    const title = input.title.trim();
    if (!title) {
      return { error: '연동 이벤트 제목(title)이 필요합니다.' };
    }

    const targetUser =
      (input.userId && this.state.users.find((u) => u.id === input.userId && u.role !== 'bot')) ||
      (input.email &&
        this.state.users.find(
          (u) => u.email.toLowerCase() === input.email!.trim().toLowerCase() && u.role !== 'bot',
        )) ||
      undefined;

    let targetRoom: ChatRoom | undefined;
    if (input.roomId) {
      targetRoom = this.state.rooms.find((r) => r.id === input.roomId);
    } else if (targetUser && (input.target === 'self' || !input.target)) {
      targetRoom = this.ensureSelfRoom(targetUser.id).room;
    } else {
      targetRoom = this.state.rooms.find((r) => r.id === 'room-bot');
    }

    if (!targetRoom) {
      return { error: '수신할 채팅방을 찾을 수 없습니다.' };
    }

    const summary: IntegrationActionSummary = {
      system: input.system === 'SGW' ? 'SGW' : 'SEDMS',
      menuKey: input.menuKey || 'dashboard',
      title,
      description: input.description?.trim() || `${input.system} 연동 이벤트가 도착했습니다.`,
      actionLabel: input.actionLabel?.trim() || '바로 열기',
      payload: input.payload,
    };

    const now = new Date().toISOString();
    const message: Message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      roomId: targetRoom.id,
      senderId: 'u-bot',
      type: 'integration_alert',
      content: `[${summary.system} 연동] ${summary.title}`,
      replyToId: null,
      integrationAlert: summary,
      reactions: {},
      readBy: targetUser ? [] : [],
      createdAt: now,
    };
    this.state.messages.push(message);
    targetRoom.updatedAt = now;

    let notification: NotificationItem | undefined;
    if (targetUser) {
      notification = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: targetUser.id,
        type: 'system',
        title: `[${summary.system}] ${summary.title}`,
        body: summary.description,
        roomId: targetRoom.id,
        leaveId: null,
        actorId: 'u-bot',
        read: false,
        createdAt: now,
      };
      this.state.notifications.unshift(notification);
    }

    this.save();
    return { message, room: targetRoom, notification };
  }

  queryLeaves(
    requestUserId: string,
    params: { q?: string; userId?: string; from?: string; to?: string; type?: string },
  ) {
    const users = this.state.users.map(sanitizeUser);
    const currentUser = users.find((u) => u.id === requestUserId);
    const todayDate = getTodayDateString();
    const sorted = [...this.state.leaves].sort((a, b) => {
      if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
      return b.createdAt.localeCompare(a.createdAt);
    });

    if (params.q && currentUser) {
      return executeLeaveHistoryQuery(params.q, sorted, users, currentUser, todayDate, {
        forceConversationMode: true,
      });
    }

    const filtered = sorted.filter((l) => {
      if (params.userId && l.userId !== params.userId) return false;
      if (params.from && l.endDate < params.from) return false;
      if (params.to && l.startDate > params.to) return false;
      if (params.type && l.type !== params.type) return false;
      return true;
    });

    return {
      leaves: filtered,
      totalMatchedDays: Number(filtered.reduce((s, item) => s + item.daysCount, 0).toFixed(1)),
    };
  }

  getMailById(mailId: string, userId?: string): MailMessage | undefined {
    const mail = this.state.mails.find((m) => m.id === mailId);
    if (!mail) return undefined;
    if (userId && mail.senderId !== userId && !mail.recipientIds.includes(userId)) {
      return undefined;
    }
    return mail;
  }

  getMailsForUser(userId: string): MailMessage[] {
    return this.state.mails
      .filter((m) => m.senderId === userId || m.recipientIds.includes(userId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getNoticesForUser(userId: string): Notice[] {
    const userRooms = new Set(
      this.state.rooms.filter((r) => r.memberIds.includes(userId)).map((r) => r.id),
    );
    return this.state.notices
      .filter(
        (n) =>
          n.scope === 'global' ||
          (n.scope === 'personal' && (n.ownerUserId === userId || n.authorId === userId)) ||
          userRooms.has(n.roomId),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getNotificationsForUser(userId: string): NotificationItem[] {
    return this.state.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getMessagesForUser(userId: string): Message[] {
    const roomIds = new Set(
      this.state.rooms.filter((r) => r.memberIds.includes(userId)).map((r) => r.id),
    );
    return this.state.messages.filter((m) => roomIds.has(m.roomId));
  }

  createScopedNotice(input: {
    scope: 'global' | 'personal';
    authorId: string;
    title: string;
    content: string;
    pinned?: boolean;
    priority?: NoticePriority;
    isUrgent?: boolean;
    pushAllMembers?: boolean;
  }): {
    notice?: Notice;
    room?: ChatRoom;
    alertMessage?: Message;
    notifications: NotificationItem[];
    targetUserIds: string[];
    error?: string;
  } {
    const author = this.state.users.find((u) => u.id === input.authorId);
    if (!author) {
      return { error: '작성자를 찾을 수 없습니다.', notifications: [], targetUserIds: [] };
    }
    const content = input.content.trim();
    if (!content) {
      return { error: '공지 내용을 입력해주세요.', notifications: [], targetUserIds: [] };
    }

    const priority = normalizeNoticePriority({
      priority: input.priority,
      isUrgent: input.isUrgent,
    });
    const isUrgent = priority === 'urgent' || Boolean(input.isUrgent);
    const pushAllMembers =
      input.scope === 'global' && Boolean(input.pushAllMembers || isUrgent);
    const priorityMeta = getNoticePriorityMeta(priority);

    const now = new Date().toISOString();
    const selfRoom = this.ensureSelfRoom(author.id).room;
    const companyRoom = this.state.rooms.find((r) => r.id === 'room-company');
    const targetRoom = input.scope === 'global' ? companyRoom ?? selfRoom : selfRoom ?? companyRoom;
    const roomId = targetRoom?.id ?? 'room-company';

    const notice: Notice = {
      id: `notice-${crypto.randomUUID().slice(0, 8)}`,
      roomId,
      scope: input.scope,
      ...(input.scope === 'personal' ? { ownerUserId: author.id } : {}),
      messageId: null,
      authorId: author.id,
      title:
        input.title.trim() ||
        (input.scope === 'global'
          ? `${isUrgent ? '[긴급재난문자]' : '[전체 업무 공지]'} ${content.slice(0, 24)}`
          : `[개인 공지] ${content.slice(0, 24)}`),
      content,
      pinned: input.pinned ?? true,
      priority,
      isUrgent,
      pushAllMembers,
      acknowledgedBy: [author.id],
      updatedAt: now,
      createdAt: now,
    };
    this.state.notices.unshift(notice);

    let alertMessage: Message | undefined;
    if (targetRoom) {
      alertMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        roomId: targetRoom.id,
        senderId: author.id,
        type: 'notice_alert',
        content: `[${isUrgent ? '긴급재난문자' : input.scope === 'global' ? '전체 업무 공지' : '개인 공지'}] ${notice.title}\n${notice.content}`,
        replyToId: null,
        noticeAlert: {
          noticeId: notice.id,
          title: notice.title,
          priority,
          isUrgent,
          pushAllMembers,
        },
        reactions: {},
        readBy: [author.id],
        createdAt: now,
      };
      this.state.messages.push(alertMessage);
      targetRoom.updatedAt = now;
      if (input.scope === 'global') {
        targetRoom.activeNoticeId = notice.id;
      }
    }

    const notifications: NotificationItem[] = [];
    const targetUserIds =
      input.scope === 'global' || isUrgent || pushAllMembers
        ? this.state.users.filter((u) => u.role !== 'bot').map((u) => u.id)
        : [author.id];

    for (const uid of targetUserIds) {
      if ((input.scope === 'global' || isUrgent || pushAllMembers) && uid === author.id) continue;
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: uid,
        type: 'notice',
        title: isUrgent
          ? `[긴급재난문자] ${notice.title}`
          : input.scope === 'global'
            ? `${priorityMeta.emergencyPrefix} ${notice.title}`
            : `[개인 공지] ${notice.title}`,
        body: `${author.name} ${author.position}: ${notice.content.slice(0, 80)}`,
        roomId,
        leaveId: null,
        noticeId: notice.id,
        priority: isUrgent ? 'urgent' : 'normal',
        isUrgent,
        actorId: author.id,
        read: input.scope === 'personal' && !isUrgent,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    this.save();
    return {
      notice,
      room: targetRoom,
      alertMessage,
      notifications,
      targetUserIds,
    };
  }

  simulateOrReceiveMail(input: {
    provider: MailProvider;
    senderId?: string;
    senderName?: string;
    senderEmail?: string;
    recipientIds?: string[];
    subject: string;
    body: string;
    shortSummary?: string;
    attachments?: MailAttachmentItem[];
    category?: MailCategory;
  }): {
    mail?: MailMessage;
    alertMessage?: Message;
    botRoom?: ChatRoom;
    notifications: NotificationItem[];
    error?: string;
  } {
    const sender =
      (input.senderId && this.state.users.find((u) => u.id === input.senderId)) ||
      (input.senderEmail &&
        this.state.users.find((u) => u.email.toLowerCase() === input.senderEmail!.trim().toLowerCase())) ||
      this.state.users.find((u) => u.id === 'u-seoyeon') ||
      this.state.users.find((u) => u.role !== 'bot');

    if (!sender) {
      return { error: '발신자를 찾을 수 없습니다.', notifications: [] };
    }
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (!subject || !body) {
      return { error: '메일 제목과 본문을 입력해주세요.', notifications: [] };
    }

    const targetIds =
      input.recipientIds && input.recipientIds.length > 0
        ? Array.from(new Set(input.recipientIds))
        : this.state.users.filter((u) => u.role !== 'bot').map((u) => u.id);

    const now = new Date().toISOString();
    const displaySenderName = input.senderName?.trim() || `${sender.name} ${sender.position}`;
    const displaySenderEmail = input.senderEmail?.trim() || sender.email;
    const attachments = input.attachments ?? [];

    const mail: MailMessage = {
      id: `${input.provider}-${crypto.randomUUID().slice(0, 8)}`,
      provider: input.provider,
      senderId: sender.id,
      recipientIds: targetIds,
      subject,
      body,
      ...(input.shortSummary ? { shortSummary: input.shortSummary } : {}),
      attachments,
      category: input.category ?? '일반',
      readByUserIds: [sender.id],
      createdAt: now,
    };

    const digest = buildConciseMailDigest(mail, displaySenderName);
    mail.shortSummary = digest.shortSummary;
    this.state.mails.unshift(mail);

    const botRoom = this.state.rooms.find((r) => r.id === 'room-bot');
    let alertMessage: Message | undefined;
    if (botRoom) {
      alertMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        roomId: botRoom.id,
        senderId: 'u-bot',
        type: 'mail_alert',
        content: `${digest.alertTitle}\n${digest.alertBody}`,
        replyToId: null,
        mailAlert: {
          mailId: mail.id,
          provider: digest.provider,
          senderId: sender.id,
          senderName: displaySenderName,
          senderEmail: displaySenderEmail,
          subject: mail.subject,
          preview: digest.shortSummary,
          shortSummary: digest.shortSummary,
          attachmentCount: digest.attachmentCount,
          attachmentNames: digest.attachmentNames,
          category: mail.category,
        },
        reactions: {},
        readBy: [],
        createdAt: now,
      };
      this.state.messages.push(alertMessage);
      botRoom.updatedAt = now;
    }

    const notifications: NotificationItem[] = [];
    for (const rid of targetIds) {
      const notif: NotificationItem = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
        userId: rid,
        type: 'mail',
        title: digest.alertTitle,
        body: digest.alertBody,
        roomId: 'room-bot',
        leaveId: null,
        mailId: mail.id,
        actorId: sender.id,
        read: false,
        createdAt: now,
      };
      this.state.notifications.unshift(notif);
      notifications.push(notif);
    }

    this.save();
    return { mail, alertMessage, botRoom, notifications };
  }

  addExternalLargeFileLink(input: {
    fileId?: string;
    roomId: string;
    senderId: string;
    filename: string;
    externalUrl: string;
    shareUrl?: string;
    shareProvider?: ShareProvider;
    storageLocation?: StorageLocation;
    nasFolder?: string;
    nasRelativePath?: string;
    nasExternalAccessUrl?: string;
    isExternalLink?: boolean;
    sizeBytes: number;
    expiresAt: string;
    passcodeHash?: string;
    maxDownloads?: number | null;
    caption?: string;
  }): { message?: Message; room?: ChatRoom; sharedFile?: SharedFileItem; error?: string } {
    const fileId = input.fileId || `link-${crypto.randomUUID().slice(0, 8)}`;
    const hasPasscode = Boolean(input.passcodeHash);
    if (input.passcodeHash) {
      if (!this.state.sharePasscodeHashes) this.state.sharePasscodeHashes = {};
      this.state.sharePasscodeHashes[fileId] = input.passcodeHash;
    }

    const attachment: FileAttachment = {
      id: fileId,
      filename: input.filename,
      mimeType: 'application/octet-stream',
      size: input.sizeBytes,
      url: input.externalUrl,
      isImage: false,
      shareUrl: input.shareUrl || input.externalUrl,
      shareExpiresAt: input.expiresAt,
      isLargeFile: true,
      isExternalLink: input.isExternalLink ?? true,
      shareProvider: input.shareProvider ?? 'nas',
      transferMode: 'external-100gb',
      storageLocation: input.storageLocation ?? (input.nasFolder ? 'internal-nas' : 'external-cloud'),
      ...(input.nasFolder ? { nasFolder: input.nasFolder } : {}),
      ...(input.nasRelativePath ? { nasRelativePath: input.nasRelativePath } : {}),
      ...(input.nasExternalAccessUrl ? { nasExternalAccessUrl: input.nasExternalAccessUrl } : {}),
      hasPasscode,
      maxDownloads: input.maxDownloads ?? null,
      downloadCount: 0,
      revoked: false,
    };
    const defaultPrefix = input.nasFolder
      ? `[NAS 폴더 복사 · 외부 링크 공유] ${input.nasFolder}/${input.filename}`
      : `[100GB 대용량 링크 공유] ${input.filename}`;
    const added = this.addMessage({
      roomId: input.roomId,
      senderId: input.senderId,
      type: 'file',
      content: input.caption?.trim() || defaultPrefix,
      file: attachment,
    });
    if (added.error || !added.message || !added.room) {
      if (input.passcodeHash && this.state.sharePasscodeHashes) {
        delete this.state.sharePasscodeHashes[fileId];
      }
      return { error: added.error ?? '대용량 링크 공유 실패' };
    }
    const sharedFile = this.getSharedFileById(fileId);
    return { message: added.message, room: added.room, sharedFile };
  }

  registerMailNasAttachment(input: {
    fileId: string;
    senderId: string;
    filename: string;
    sizeBytes: number;
    shareUrl: string;
    expiresAt: string;
    passcodeHash?: string;
    maxDownloads?: number | null;
    shareProvider?: ShareProvider;
    storageLocation?: StorageLocation;
    nasFolder?: string;
    nasRelativePath?: string;
    nasExternalAccessUrl?: string;
    externalUrl?: string;
    isExternalLink?: boolean;
  }): SharedFileItem {
    const now = new Date().toISOString();
    const hasPasscode = Boolean(input.passcodeHash);
    if (input.passcodeHash) {
      if (!this.state.sharePasscodeHashes) this.state.sharePasscodeHashes = {};
      this.state.sharePasscodeHashes[input.fileId] = input.passcodeHash;
    }

    const sharedFile: SharedFileItem = {
      id: input.fileId,
      roomId: 'room-bot',
      uploaderId: input.senderId,
      messageId: '',
      filename: input.filename,
      mimeType: 'application/octet-stream',
      size: input.sizeBytes,
      url: input.externalUrl || input.shareUrl,
      isImage: false,
      shareUrl: input.shareUrl,
      shareExpiresAt: input.expiresAt,
      isLargeFile: true,
      isExternalLink: input.isExternalLink ?? false,
      shareProvider: input.shareProvider ?? 'nas',
      transferMode: 'external-100gb',
      storageLocation: input.storageLocation ?? 'internal-nas',
      ...(input.nasFolder ? { nasFolder: input.nasFolder } : {}),
      ...(input.nasRelativePath ? { nasRelativePath: input.nasRelativePath } : {}),
      ...(input.nasExternalAccessUrl ? { nasExternalAccessUrl: input.nasExternalAccessUrl } : {}),
      hasPasscode,
      maxDownloads: input.maxDownloads ?? null,
      downloadCount: 0,
      revoked: false,
      createdAt: now,
    };
    this.state.files.unshift(sharedFile);
    this.save();
    return sharedFile;
  }

  registerUploadedSharedFileRecord(input: SharedFileItem): SharedFileItem {
    this.state.files.unshift(input);
    this.save();
    return input;
  }

  verifyFilePasscode(
    fileId: string,
    passcode: string,
    verifier: (plain: string, storedHash: string) => boolean,
  ): boolean {
    const hash = this.state.sharePasscodeHashes?.[fileId];
    if (!hash) return true;
    return verifier(passcode, hash);
  }

  recordFileDownload(fileId: string): {
    sharedFile?: SharedFileItem;
    message?: Message;
    room?: ChatRoom;
    updatedMails: MailMessage[];
  } {
    const f = this.state.files.find((item) => item.id === fileId);
    if (!f) return { updatedMails: [] };
    f.downloadCount = (f.downloadCount ?? 0) + 1;

    let updatedMessage: Message | undefined;
    for (const m of this.state.messages) {
      if (m.file && m.file.id === fileId) {
        m.file.downloadCount = f.downloadCount;
        updatedMessage = m;
      }
    }
    const updatedMails: MailMessage[] = [];
    for (const mail of this.state.mails) {
      let touched = false;
      for (const att of mail.attachments ?? []) {
        if (att.id === fileId) {
          att.downloadCount = f.downloadCount;
          touched = true;
        }
      }
      if (touched) updatedMails.push(mail);
    }
    const room = this.state.rooms.find((r) => r.id === f.roomId);
    this.save();
    return { sharedFile: f, message: updatedMessage, room, updatedMails };
  }

  revokeSharedFile(
    fileId: string,
    actorUserId: string,
  ): {
    sharedFile?: SharedFileItem;
    message?: Message;
    room?: ChatRoom;
    updatedMails: MailMessage[];
    error?: string;
  } {
    const f = this.state.files.find((item) => item.id === fileId);
    if (!f) return { error: '공유된 파일을 찾을 수 없습니다.', updatedMails: [] };
    const actor = this.state.users.find((u) => u.id === actorUserId);
    if (!actor) return { error: '권한을 확인할 수 없습니다.', updatedMails: [] };
    if (f.uploaderId !== actorUserId && actor.role !== 'admin') {
      return { error: '업로더 또는 관리자만 공유 링크를 회수할 수 있습니다.', updatedMails: [] };
    }

    f.revoked = true;
    if (this.state.sharePasscodeHashes && this.state.sharePasscodeHashes[fileId]) {
      delete this.state.sharePasscodeHashes[fileId];
    }

    let updatedMessage: Message | undefined;
    for (const m of this.state.messages) {
      if (m.file && m.file.id === fileId) {
        m.file.revoked = true;
        updatedMessage = m;
      }
    }
    const updatedMails: MailMessage[] = [];
    for (const mail of this.state.mails) {
      let touched = false;
      for (const att of mail.attachments ?? []) {
        if (att.id === fileId) {
          att.revoked = true;
          touched = true;
        }
      }
      if (touched) updatedMails.push(mail);
    }
    const room = this.state.rooms.find((r) => r.id === f.roomId);
    this.save();
    return { sharedFile: f, message: updatedMessage, room, updatedMails };
  }

  addScheduledMessage(input: {
    roomId: string;
    senderId: string;
    content: string;
    scheduledAt: string;
  }): { item?: ScheduledMessageItem; error?: string } {
    const room = this.state.rooms.find((r) => r.id === input.roomId);
    if (!room || !room.memberIds.includes(input.senderId)) {
      return { error: '채팅방 멤버만 예약 전송을 설정할 수 있습니다.' };
    }
    const content = input.content.trim();
    if (!content) {
      return { error: '예약 전송할 메시지 내용을 입력해 주세요.' };
    }
    const ts = new Date(input.scheduledAt).getTime();
    if (Number.isNaN(ts)) {
      return { error: '올바른 예약 전송 시각을 지정해 주세요.' };
    }
    const item: ScheduledMessageItem = {
      id: `sched-${crypto.randomUUID().slice(0, 8)}`,
      roomId: room.id,
      senderId: input.senderId,
      type: 'text',
      content,
      scheduledAt: new Date(ts).toISOString(),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    if (!this.state.scheduledMessages) {
      this.state.scheduledMessages = [];
    }
    this.state.scheduledMessages.push(item);
    this.save();
    return { item };
  }

  getScheduledMessagesForUser(userId: string, roomId?: string): ScheduledMessageItem[] {
    return (this.state.scheduledMessages ?? [])
      .filter(
        (s) =>
          s.senderId === userId &&
          s.status === 'pending' &&
          (!roomId || s.roomId === roomId),
      )
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }

  cancelScheduledMessage(scheduleId: string, userId: string): ScheduledMessageItem | null {
    const target = (this.state.scheduledMessages ?? []).find(
      (s) => s.id === scheduleId && s.senderId === userId && s.status === 'pending',
    );
    if (!target) return null;
    target.status = 'cancelled';
    this.save();
    return target;
  }

  collectDueScheduledMessages(nowMs = Date.now()): {
    message: Message;
    room: ChatRoom;
    scheduledItem: ScheduledMessageItem;
  }[] {
    const list = this.state.scheduledMessages ?? [];
    const due = list.filter(
      (s) => s.status === 'pending' && new Date(s.scheduledAt).getTime() <= nowMs,
    );
    if (due.length === 0) return [];

    const delivered: {
      message: Message;
      room: ChatRoom;
      scheduledItem: ScheduledMessageItem;
    }[] = [];

    for (const item of due) {
      item.status = 'sent';
      const added = this.addMessage({
        roomId: item.roomId,
        senderId: item.senderId,
        type: 'text',
        content: `[예약 전송] ${item.content}`,
      });
      if (added.message && added.room) {
        delivered.push({
          message: added.message,
          room: added.room,
          scheduledItem: item,
        });
      }
    }

    this.save();
    return delivered;
  }

  ingestBmailLedger(
    rawItems: unknown,
    actorUserId: string,
  ): {
    inserted: number;
    touchedDates: string[];
    createdMails: MailMessage[];
    notifications: NotificationItem[];
  } {
    const normalized = normalizeBmailLedgerBatch(rawItems);
    if (!this.state.bmailLedger) this.state.bmailLedger = [];
    const existingIds = new Set(this.state.bmailLedger.map((x) => x.bmail_uid));
    let inserted = 0;
    const touchedSet = new Set<string>();
    const createdMails: MailMessage[] = [];
    const notifications: NotificationItem[] = [];

    for (const item of normalized) {
      touchedSet.add(item.mail_date);
      if (existingIds.has(item.bmail_uid)) continue;
      existingIds.add(item.bmail_uid);
      this.state.bmailLedger.unshift(item);
      inserted += 1;

      if (item.direction === 'recv') {
        const mailId = `bmail-sync-${item.bmail_uid.replace(/[^\w-]/g, '').slice(0, 24)}`;
        if (!this.state.mails.some((m) => m.id === mailId)) {
          const senderUser = this.state.users.find((u) =>
            item.sender.toLowerCase().includes(u.email.toLowerCase()),
          );
          const hasBigAtt = item.attachments.some((a) => a.size_bytes >= 10 * 1024 * 1024);
          const syncedMail: MailMessage = {
            id: mailId,
            provider: hasBigAtt ? 'bigmail' : 'bmail',
            senderId: senderUser?.id ?? actorUserId,
            recipientIds: [actorUserId],
            subject: item.subject,
            body: `${item.body_snippet}\n\n(bmail 원장 동기화 · 발신: ${item.sender})`,
            shortSummary: item.body_snippet.slice(0, 72) || item.subject,
            attachments: item.attachments.map((a, idx) => ({
              id: `bml-att-${idx}-${mailId.slice(-6)}`,
              filename: a.filename,
              size: a.size_bytes,
              mimeType: 'application/octet-stream',
            })),
            category: '일반',
            readByUserIds: item.action_status === 'need_reply' ? [] : [actorUserId],
            createdAt: item.mail_timestamp,
          };
          this.state.mails.unshift(syncedMail);
          createdMails.push(syncedMail);

          if (item.action_status === 'need_reply') {
            const notif: NotificationItem = {
              id: `notif-${crypto.randomUUID().slice(0, 8)}`,
              userId: actorUserId,
              type: 'mail',
              title: `[bmail 동기화] ${item.subject}`,
              body: item.body_snippet.slice(0, 90) || item.sender,
              roomId: 'room-bot',
              leaveId: null,
              mailId: syncedMail.id,
              actorId: syncedMail.senderId,
              read: false,
              createdAt: new Date().toISOString(),
            };
            this.state.notifications.unshift(notif);
            notifications.push(notif);
          }
        }
      }
    }

    if (this.state.bmailLedger.length > 2000) {
      this.state.bmailLedger = this.state.bmailLedger.slice(0, 2000);
    }
    this.save();
    return {
      inserted,
      touchedDates: Array.from(touchedSet),
      createdMails,
      notifications,
    };
  }

  listBmailLedger(filters?: {
    project?: string;
    direction?: string;
    q?: string;
  }): BmailLedgerItem[] {
    const list = this.state.bmailLedger ?? [];
    const proj = String(filters?.project || '').trim().toLowerCase();
    const dir = String(filters?.direction || '').trim().toLowerCase();
    const q = String(filters?.q || '').trim().toLowerCase();
    return list.filter((item) => {
      if (dir && dir !== 'all' && item.direction !== dir) return false;
      if (proj && !(item.projectCode || '').toLowerCase().includes(proj)) return false;
      if (q) {
        const hay = `${item.subject} ${item.sender} ${item.body_snippet} ${item.projectCode || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  pushBmailWeeklyLog(logDate: string, actorUserId: string): {
    ok: boolean;
    log_date: string;
    itemCount: number;
    summary: string;
  } {
    const cleanDate = (logDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const items = (this.state.bmailLedger ?? []).filter((x) => x.mail_date === cleanDate);
    if (!this.state.weeklyPushDates) this.state.weeklyPushDates = [];
    if (!this.state.weeklyPushDates.includes(cleanDate)) {
      this.state.weeklyPushDates.push(cleanDate);
    }
    const summary = `[bmail 일일 업무 집계 · ${cleanDate}] 수신 ${
      items.filter((i) => i.direction === 'recv').length
    }건 / 발신 ${items.filter((i) => i.direction === 'sent').length}건 (총 ${items.length}건)`;

    const botRoom = this.state.rooms.find((r) => r.id === 'room-bot');
    if (botRoom) {
      this.addMessage({
        roomId: botRoom.id,
        senderId: 'u-bot',
        type: 'system',
        content: `${summary} — 주간업무 보고 연동 완료`,
        mentions: [actorUserId],
      });
    }
    this.save();
    return { ok: true, log_date: cleanDate, itemCount: items.length, summary };
  }

  importRemoteBmailItems(remoteItems: BmailRemoteMailItem[], userId: string): MailMessage[] {
    const usersById: Record<string, User> = {};
    for (const u of this.state.users) usersById[u.id] = sanitizeUser(u);
    const added: MailMessage[] = [];
    for (const r of remoteItems) {
      if (this.state.mails.some((m) => m.id === r.id)) continue;
      const mapped = mapRemoteBmailItemToMailMessage(r, userId, usersById);
      this.state.mails.unshift(mapped);
      added.push(mapped);
    }
    if (added.length > 0) this.save();
    return added;
  }
}

export const store = new GroupwareStore();



