import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { PRESENCE_LABELS, type PresenceStatus, type User } from '../types/client';

interface AvatarProps {
  user?: User | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showOnline?: boolean;
  onLeave?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-7 w-7 text-[11px] rounded-[10px]',
  sm: 'h-9 w-9 text-xs rounded-[13px]',
  md: 'h-11 w-11 text-sm rounded-[16px]',
  lg: 'h-14 w-14 text-base rounded-[20px]',
  xl: 'h-16 w-16 text-lg rounded-[22px]',
};

const PALETTE = [
  'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200',
];

const PRESENCE_DOT_COLORS: Record<PresenceStatus, string> = {
  online: 'bg-[#07C160]',
  meeting: 'bg-rose-500',
  away: 'bg-amber-500',
  out: 'bg-sky-500',
  offline: 'bg-neutral-400',
};

function pickColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % PALETTE.length;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function Avatar({ user, size = 'md', showOnline = false, onLeave = false }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const sizeClass = SIZE_CLASSES[size];

  if (user?.role === 'bot') {
    return (
      <div
        className={`relative shrink-0 flex items-center justify-center bg-[#075E54] text-[#FEE500] font-bold ${sizeClass}`}
        aria-label={user.name}
      >
        <BellRing className="h-4 w-4" />
      </div>
    );
  }

  const initial = user?.name ? user.name.slice(0, 1) : '?';
  const colorClass = pickColor(user?.id ?? 'default');
  const status: PresenceStatus = user?.presenceStatus ?? (user?.online ? 'online' : 'offline');

  return (
    <div className="relative inline-flex shrink-0">
      {user?.avatarUrl && !imgFailed ? (
        <img
          src={user.avatarUrl}
          alt={user.name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`${sizeClass} object-cover border border-black/5 dark:border-white/10`}
        />
      ) : (
        <div
          className={`${sizeClass} ${colorClass} flex items-center justify-center font-semibold border border-black/5 dark:border-white/10`}
        >
          {initial}
        </div>
      )}

      {onLeave ? (
        <span
          title="오늘 연차"
          className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-neutral-900 flex items-center justify-center text-[8px] font-bold text-white"
        >
          휴
        </span>
      ) : (
        showOnline && (
          <span
            title={PRESENCE_LABELS[status]}
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ${PRESENCE_DOT_COLORS[status]} ring-2 ring-white dark:ring-neutral-900`}
          />
        )
      )}
    </div>
  );
}
