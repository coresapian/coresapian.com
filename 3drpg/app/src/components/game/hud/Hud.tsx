// ============================================================================
// CORESAPIAN — HUD composition (game.md S3). Etched stone backplates, runic
// glyph labels, phosphor accents. Never blocks the world: pointer-events are
// enabled only on interactive widgets.
// ============================================================================

import { useGameStore } from '@/game/store';
import { useGameHandle } from '../engineBridge';
import { useUiAux } from '../uiAux';
import BossBar from './BossBar';
import Compass from './Compass';
import Crosshair from './Crosshair';
import DamageNumbers from './DamageNumbers';
import FpsCounter from './FpsCounter';
import Hotbar from './Hotbar';
import Notifications from './Notifications';
import QuestTracker from './QuestTracker';
import RealmStatus from './RealmStatus';
import RealmTitleCard from './RealmTitleCard';
import RuneLoadout from './RuneLoadout';
import Vitals from './Vitals';
import { useEngineProbe } from './probe';

export default function Hud() {
  const game = useGameHandle();
  const bootDone = useUiAux((s) => s.bootDone);
  const dead = useGameStore((s) => s.dead);
  const probe = useEngineProbe(game, bootDone && !dead);

  if (!bootDone) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* top-center: compass + boss bar */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-3">
        <Compass probe={probe} />
        <BossBar />
      </div>

      {/* top-right: quest tracker */}
      <div className="absolute right-4 top-16">
        <QuestTracker probe={probe} />
      </div>

      {/* bottom-left: vitals */}
      <div className="absolute bottom-4 left-4">
        <Vitals />
      </div>

      {/* bottom-center: hotbar + rune loadout */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-end gap-4">
        <Hotbar />
        <RuneLoadout probe={probe} />
      </div>

      {/* bottom-right: notifications above realm status */}
      <div className="absolute bottom-20 right-4">
        <Notifications />
      </div>
      <div className="absolute bottom-4 right-4">
        <RealmStatus />
      </div>

      {/* center + free-floating layers */}
      <Crosshair probe={probe} />
      <DamageNumbers />
      <RealmTitleCard />
      <FpsCounter />
    </div>
  );
}
