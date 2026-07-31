// ============================================================================
// CORESAPIAN — Notification toasts (game.md S3 bottom-right; store
// notifications slice, kind-styled, click to dismiss, max 4 on screen).
// ============================================================================

import type { ComponentType } from 'react';
import { AlertTriangle, Info, Moon, Package, Scroll, Star, X } from 'lucide-react';

import type { Notification, NotificationKind } from '../../../../contracts/types';
import { useGameStore } from '@/game/store';

const KIND_STYLE: Record<
  NotificationKind,
  { Icon: ComponentType<{ size?: number | string; className?: string }>; text: string; border: string }
> = {
  info: { Icon: Info, text: 'text-bone-dim', border: 'border-iron' },
  loot: { Icon: Package, text: 'text-phosphor', border: 'border-phosphor/50' },
  quest: { Icon: Scroll, text: 'text-ice', border: 'border-ice/50' },
  warning: { Icon: AlertTriangle, text: 'text-phosphor', border: 'border-phosphor/50' },
  error: { Icon: AlertTriangle, text: 'text-blood-hi', border: 'border-blood/60' },
  level: { Icon: Star, text: 'text-phosphor', border: 'border-phosphor/60' },
  event: { Icon: Moon, text: 'text-galdr', border: 'border-galdr/50' },
};

function Toast({ note }: { note: Notification }) {
  const dismissNotification = useGameStore((s) => s.dismissNotification);
  const style = KIND_STYLE[note.kind];
  const { Icon } = style;
  return (
    <button
      type="button"
      onClick={() => dismissNotification(note.id)}
      className={`panel pointer-events-auto flex w-[300px] items-center gap-2 border-l-2 px-3 py-2 text-left transition-transform duration-150 hover:-translate-x-1 ${style.border}`}
    >
      <Icon size={13} className={`flex-none ${style.text}`} />
      <span className="micro flex-1 leading-snug text-bone-dim">{note.text}</span>
      <X size={11} className="flex-none text-ash" />
    </button>
  );
}

export default function Notifications() {
  const notifications = useGameStore((s) => s.notifications);
  const visible = notifications.slice(-4);
  return (
    <div className="pointer-events-none flex flex-col items-end gap-2">
      {visible.map((n) => (
        <Toast key={n.id} note={n} />
      ))}
    </div>
  );
}
