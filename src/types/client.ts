export * from '../shared/types';

export type ViewMode = 'app' | 'extension';
export type AppTab = 'friends' | 'chats' | 'leave' | 'files';
export type ThemeMode = 'light' | 'dark';
export type InspectorTab = 'notices' | 'files' | 'starred' | 'members';

export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: 'leave' | 'notice' | 'file' | 'mail' | 'integration' | 'system';
  priority?: 'normal' | 'urgent';
  isUrgent?: boolean;
  roomId?: string | null;
  mailId?: string | null;
  noticeId?: string | null;
  createdAt: string;
}
