import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Siren,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatKoreanTime } from '../shared/logic';
import { formatEmergencyDisasterNoticeText } from '../shared/noticeAlert';

export interface EmergencyAlertData {
  noticeId?: string | null;
  roomId?: string | null;
  title: string;
  body: string;
  authorName: string;
  roomName: string;
  createdAt: string;
  acknowledged?: boolean;
}

interface EmergencyAlertBannerProps {
  alert: EmergencyAlertData;
  onReplaySound: () => void;
  onStopSound: () => void;
  onOpenRoom: (roomId: string) => void;
  onAcknowledge: (noticeId: string) => Promise<void> | void;
  onClose: () => void;
}

export function EmergencyAlertBanner({
  alert,
  onReplaySound,
  onStopSound,
  onOpenRoom,
  onAcknowledge,
  onClose,
}: EmergencyAlertBannerProps) {
  const [acknowledging, setAcknowledging] = useState(false);
  const [muted, setMuted] = useState(false);

  const formatted = formatEmergencyDisasterNoticeText({
    title: alert.title,
    content: alert.body,
    senderName: alert.authorName,
    roomName: alert.roomName,
  });

  const handleAck = async () => {
    if (!alert.noticeId || acknowledging) return;
    setAcknowledging(true);
    try {
      await onAcknowledge(alert.noticeId);
      onStopSound();
    } finally {
      setAcknowledging(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="긴급재난문자 공지 알림"
      className="fixed inset-x-3 top-3 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-xl z-[70] rounded-2xl bg-red-950/95 text-white border-2 border-red-400 shadow-2xl ring-4 ring-red-500/40 overflow-hidden"
    >
      {/* Pulsing Crimson Header */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-red-700 via-red-600 to-rose-700 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-7 w-7 rounded-lg bg-white/15 flex items-center justify-center shrink-0 animate-pulse">
            <Siren className="h-4 w-4 text-amber-200" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-extrabold tracking-tight text-amber-200 truncate">
              {formatted.headerLabel}
            </div>
            <div className="text-[11px] text-red-100/90 truncate">
              {formatted.metaLine} · {formatKoreanTime(alert.createdAt)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (muted) {
                setMuted(false);
                onReplaySound();
              } else {
                setMuted(true);
                onStopSound();
              }
            }}
            aria-label={muted ? '경보음 다시 듣기' : '경보음 음소거'}
            className="h-7 px-2 rounded-lg bg-white/15 hover:bg-white/25 text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span>{muted ? '음소거됨' : '음소거'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onStopSound();
              onClose();
            }}
            aria-label="긴급 알림 닫기"
            className="h-7 w-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-extrabold text-white leading-snug">
              {formatted.headline}
            </h3>
            <p className="text-xs text-red-100/95 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
              {formatted.summaryBody}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-red-800/70">
          {!muted && (
            <button
              type="button"
              onClick={onReplaySound}
              className="h-8 px-2.5 rounded-lg bg-red-900/80 hover:bg-red-800 text-red-100 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Volume2 className="h-3.5 w-3.5" />
              <span>경보음 다시 듣기</span>
            </button>
          )}
          {alert.roomId && (
            <button
              type="button"
              onClick={() => {
                onStopSound();
                onOpenRoom(alert.roomId!);
                onClose();
              }}
              className="h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <span>해당 채팅방 이동</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {alert.noticeId && (
            <button
              type="button"
              disabled={acknowledging || Boolean(alert.acknowledged)}
              onClick={handleAck}
              className={`h-8 px-3 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors ${
                alert.acknowledged
                  ? 'bg-emerald-600/80 text-white cursor-default'
                  : 'bg-[#FEE500] hover:bg-amber-300 text-red-950'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{alert.acknowledged ? '공지 확인 완료됨' : acknowledging ? '처리 중...' : '공지 확인 완료'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onStopSound();
              onClose();
            }}
            className="h-8 px-3 rounded-lg border border-red-400/50 hover:bg-white/10 text-red-100 text-xs font-semibold cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
