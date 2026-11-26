export type UserRole = 'member' | 'admin' | 'bot';
export type PresenceStatus = 'online' | 'meeting' | 'away' | 'out' | 'offline';

export interface User {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  phone: string;
  avatarUrl: string;
  statusMessage: string;
  presenceStatus: PresenceStatus;
  role: UserRole;
  totalLeaveDays: number;
  usedLeaveDays: number;
  online: boolean;
  lastSeen: string;
  createdAt: string;
}

export type RoomType = 'direct' | 'group' | 'company' | 'bot' | 'self';

export interface ChatRoom {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  memberIds: string[];
  pinnedByUserIds: string[];
  mutedByUserIds: string[];
  activeNoticeId: string | null;
  disappearingSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageType =
  | 'text'
  | 'file'
  | 'image'
  | 'voice'
  | 'leave_alert'
  | 'mail_alert'
  | 'notice_alert'
  | 'poll'
  | 'schedule_card'
  | 'draw_card'
  | 'emoticon'
  | 'integration_alert'
  | 'system';

export interface VoiceAnalysisResult {
  summary: string;
  keywords: string[];
  actionItems: string[];
  detectedIntent?: 'leave' | 'calendar' | 'meeting_memo' | 'meeting' | 'mail' | 'notice' | 'general';
  suggestedMenuKey?: SedmsMenuKey;
  analyzedAt: string;
  engine?: 'gemini-4-hydrogen' | 'sgw-voice-engine';
}

export interface VoiceAttachment {
  durationSec: number;
  waveform: number[];
  transcript?: string;
  audioDataUrl?: string;
  mimeType?: string;
  analysis?: VoiceAnalysisResult;
}

export type ShareProvider = 'sgw-relay' | 'nas' | 's3' | 'gcs' | 'gdrive' | 'custom';
export type FileTransferMode = 'direct' | 'chunked-resumable' | 'external-100gb';

export type StorageLocation = 'internal-nas' | 'external-cloud' | 'relay';

export interface FileAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  isImage: boolean;
  shareUrl?: string;
  shareExpiresAt?: string | null;
  isLargeFile?: boolean;
  isExternalLink?: boolean;
  shareProvider?: ShareProvider;
  transferMode?: FileTransferMode;
  storageLocation?: StorageLocation;
  nasFolder?: string;
  nasRelativePath?: string;
  nasExternalAccessUrl?: string;
  hasPasscode?: boolean;
  maxDownloads?: number | null;
  downloadCount?: number;
  revoked?: boolean;
}

export interface ScheduleCardData {
  title: string;
  dateTime: string;
  location?: string;
  memo?: string;
  attendeesYes: string[];
  attendeesMaybe: string[];
  attendeesNo: string[];
}

export interface DrawCardData {
  topic: string;
  candidates: string[];
  winner: string;
  drawnAt: string;
}

export interface NasFileEntry {
  filename: string;
  folder: string;
  relativePath: string;
  size: number;
  updatedAt: string;
}

export interface NasFolderInfo {
  folder: string;
  files: NasFileEntry[];
}

export interface PollOption {
  id: string;
  text: string;
  voterIds: string[];
}

export interface PollData {
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
  closed?: boolean;
}

export interface LeaveAlertSummary {
  leaveId: string;
  userId: string;
  userName: string;
  department: string;
  position: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  daysCount: number;
  substituteName: string;
  reason: string;
}

export type MailProvider = 'bmail' | 'bigmail';

export interface MailAttachmentItem {
  id: string;
  filename: string;
  size: number;
  mimeType?: string;
  downloadUrl?: string;
  shareUrl?: string;
  shareExpiresAt?: string | null;
  isLargeFile?: boolean;
  isExternalLink?: boolean;
  shareProvider?: ShareProvider;
  storageLocation?: StorageLocation;
  nasFolder?: string;
  nasRelativePath?: string;
  nasExternalAccessUrl?: string;
  hasPasscode?: boolean;
  maxDownloads?: number | null;
  downloadCount?: number;
  revoked?: boolean;
}

export interface MailAlertSummary {
  mailId: string;
  provider?: MailProvider;
  senderId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  preview: string;
  shortSummary?: string;
  attachmentCount?: number;
  attachmentNames?: string[];
  category: MailCategory;
}

export type SedmsMenuKey =
  | 'dashboard'
  | 'leave'
  | 'approval'
  | 'document'
  | 'project'
  | 'project-calendar'
  | 'meeting-memo'
  | 'meeting'
  | 'attendance'
  | 'bmail'
  | 'directory';

export interface IntegrationActionSummary {
  system: 'SEDMS' | 'SGW';
  menuKey: SedmsMenuKey;
  title: string;
  description: string;
  actionLabel: string;
  payload?: Record<string, string>;
}

export interface ForwardedMeta {
  senderName: string;
  roomName?: string;
  originalCreatedAt: string;
}

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  type: MessageType;
  content: string;
  replyToId: string | null;
  file?: FileAttachment;
  voice?: VoiceAttachment;
  leaveAlert?: LeaveAlertSummary;
  mailAlert?: MailAlertSummary;
  integrationAlert?: IntegrationActionSummary;
  noticeAlert?: {
    noticeId: string;
    title: string;
    priority: NoticePriority;
    isUrgent?: boolean;
    pushAllMembers?: boolean;
  };
  poll?: PollData;
  scheduleCard?: ScheduleCardData;
  drawCard?: DrawCardData;
  emoticonId?: string;
  reactions: Record<string, string[]>;
  readBy: string[];
  deleted?: boolean;
  recalled?: boolean;
  recalledOriginalContent?: string;
  editedAt?: string | null;
  starredByUserIds?: string[];
  mentions?: string[];
  forwardedFrom?: ForwardedMeta | null;
  expiresAt?: string | null;
  viewOnce?: boolean;
  viewedByUserIds?: string[];
  createdAt: string;
}

export type NoticeScope = 'global' | 'personal' | 'room';
export type NoticePriority = 'normal' | 'important' | 'urgent';

export interface Notice {
  id: string;
  roomId: string;
  scope?: NoticeScope;
  ownerUserId?: string | null;
  messageId: string | null;
  authorId: string;
  title: string;
  content: string;
  pinned: boolean;
  priority?: NoticePriority;
  isUrgent?: boolean;
  pushAllMembers?: boolean;
  acknowledgedBy?: string[];
  updatedAt?: string;
  createdAt: string;
}

export type LeaveType = '연차' | '오전반차' | '오후반차' | '병가' | '공가';

export interface LeaveRequest {
  id: string;
  userId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  daysCount: number;
  substituteId: string | null;
  reason: string;
  status: '승인완료' | '대기';
  createdAt: string;
}

export type MailCategory = '일반' | '연차알림' | '공지' | '결재';

export interface MailMessage {
  id: string;
  provider?: MailProvider;
  senderId: string;
  recipientIds: string[];
  subject: string;
  body: string;
  shortSummary?: string;
  attachments?: MailAttachmentItem[];
  category: MailCategory;
  readByUserIds: string[];
  linkedLeaveId?: string | null;
  inReplyToMailId?: string | null;
  originRoomId?: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: 'leave' | 'notice' | 'file' | 'mail' | 'system';
  title: string;
  body: string;
  roomId: string | null;
  leaveId: string | null;
  mailId?: string | null;
  noticeId?: string | null;
  priority?: 'normal' | 'urgent';
  isUrgent?: boolean;
  actorId: string;
  read: boolean;
  createdAt: string;
}

export interface SharedFileItem {
  id: string;
  roomId: string;
  uploaderId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  isImage: boolean;
  shareUrl?: string;
  shareExpiresAt?: string | null;
  isLargeFile?: boolean;
  isExternalLink?: boolean;
  shareProvider?: ShareProvider;
  transferMode?: FileTransferMode;
  storageLocation?: StorageLocation;
  nasFolder?: string;
  nasRelativePath?: string;
  nasExternalAccessUrl?: string;
  hasPasscode?: boolean;
  maxDownloads?: number | null;
  downloadCount?: number;
  revoked?: boolean;
  createdAt: string;
}

export interface ScheduledMessageItem {
  id: string;
  roomId: string;
  senderId: string;
  type: 'text';
  content: string;
  scheduledAt: string;
  createdAt: string;
  status: 'pending' | 'sent' | 'cancelled';
}

export interface BootstrapPayload {
  currentUser: User;
  users: User[];
  rooms: ChatRoom[];
  messages: Message[];
  notices: Notice[];
  leaves: LeaveRequest[];
  mails: MailMessage[];
  notifications: NotificationItem[];
  files: SharedFileItem[];
  scheduledMessages?: ScheduledMessageItem[];
}

export interface EmoticonItem {
  id: string;
  label: string;
  emoji: string;
  caption: string;
  bg: string;
}

export const WORK_EMOTICONS: EmoticonItem[] = [
  { id: 'emo-ok', label: '확인했습니다', emoji: '👌', caption: '확인 완료!', bg: '#FEF3C7' },
  { id: 'emo-thanks', label: '감사합니다', emoji: '🙏', caption: '감사합니다!', bg: '#DBEAFE' },
  { id: 'emo-good', label: '최고예요', emoji: '👍', caption: '굿 아이디어!', bg: '#DCFCE7' },
  { id: 'emo-leave', label: '연차다녀올게요', emoji: '🌴', caption: '연차 다녀오겠습니다', bg: '#FCE7F3' },
  { id: 'emo-coffee', label: '커피타임', emoji: '☕', caption: '잠깐 커피 한잔?', bg: '#F3E8FF' },
  { id: 'emo-cheer', label: '화이팅', emoji: '🔥', caption: '오늘도 화이팅!', bg: '#FFEDD5' },
  { id: 'emo-meeting', label: '회의중', emoji: '🎧', caption: '잠시 회의 중입니다', bg: '#E0E7FF' },
  { id: 'emo-done', label: '작업완료', emoji: '✅', caption: '배포 및 처리 완료', bg: '#D1FAE5' },
];

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: '접속 중',
  meeting: '회의 중',
  away: '자리비움',
  out: '외근 중',
  offline: '오프라인',
};

export interface AuthPublicConfig {
  companyAssetName: string;
  companyDomain: string;
  emailVerificationRequired: boolean;
  kakaoOAuthConfigured: boolean;
  kakaoFreeApisConfigured: boolean;
  geminiConfigured: boolean;
  testBypassLogin?: boolean;
}

export interface KakaoFreeApiStatus {
  restApiConfigured: boolean;
  kakaoTalkLinked: boolean;
  linkedScopes: string[];
  geminiConfigured: boolean;
}

export interface EgoToolExecution {
  id: string;
  toolName: string;
  label: string;
  provider: 'KAKAO_LOCAL' | 'KAKAO_SEARCH' | 'KAKAO_TALK' | 'KAKAO_CALENDAR' | 'SGW' | 'SEDMS';
  status: 'executed' | 'needs_config' | 'error';
  summary: string;
  items?: {
    title: string;
    subtitle?: string;
    url?: string;
    meta?: string;
  }[];
}

export interface EgoRunResult {
  goal: string;
  engine: 'gemini-4-hydrogen' | 'sgw-rule-engine';
  planSteps: string[];
  toolExecutions: EgoToolExecution[];
  finalAnswer: string;
  integrationActions: IntegrationActionSummary[];
  nextSuggestions: string[];
  selfRoomMessage?: Message;
  statusSnapshot: KakaoFreeApiStatus;
}

