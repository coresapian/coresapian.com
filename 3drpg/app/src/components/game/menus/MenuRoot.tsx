// ============================================================================
// CORESAPIAN — menu composition: renders the active menu (store.activeMenu).
// When dead, only the death screen exists (addendum §4).
// ============================================================================

import { useGameStore } from '@/game/store';
import CraftingMenu from './CraftingMenu';
import InventoryMenu from './InventoryMenu';
import MapMenu from './MapMenu';
import PauseMenu from './PauseMenu';
import QuestsMenu from './QuestsMenu';
import SettingsMenu from './SettingsMenu';
import SkillsMenu from './SkillsMenu';

export default function MenuRoot() {
  const activeMenu = useGameStore((s) => s.activeMenu);
  const dead = useGameStore((s) => s.dead);

  if (dead) return null;

  switch (activeMenu) {
    case 'inventory':
      return <InventoryMenu />;
    case 'crafting':
      return <CraftingMenu />;
    case 'skills':
      return <SkillsMenu />;
    case 'quests':
      return <QuestsMenu />;
    case 'map':
      return <MapMenu />;
    case 'pause':
      return <PauseMenu />;
    case 'settings':
      return <SettingsMenu />;
    default:
      return null;
  }
}
