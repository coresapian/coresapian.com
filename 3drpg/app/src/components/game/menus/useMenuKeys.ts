// ============================================================================
// CORESAPIAN — ui-owned window keydown for menus (integration-addendum §4:
// ui owns Tab/K/J/M/Esc; engine must NOT bind them). Esc closes the topmost
// layer (shop → dialogue → menu → pause). pointer_lock {locked:false} opens
// pause when nothing else is open. When dead, only the death screen exists.
// ============================================================================

import { useEffect } from 'react';

import { gameEvents } from '@/game/events';
import { useGameStore } from '@/game/store';
import type { MenuId } from '../../../../contracts/types';
import { useUiAux } from '../uiAux';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useMenuKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const toggle = (menu: MenuId) => {
      const s = useGameStore.getState();
      s.setMenu(s.activeMenu === menu ? 'none' : menu);
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useGameStore.getState();
      if (s.dead) return; // only the death screen when dead

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          toggle('inventory');
          break;
        case 'i':
        case 'I':
          toggle('inventory');
          break;
        case 'k':
        case 'K':
          toggle('skills');
          break;
        case 'j':
        case 'J':
          toggle('quests');
          break;
        case 'm':
        case 'M':
          toggle('map');
          break;
        case 'Escape': {
          const aux = useUiAux.getState();
          if (aux.shopId) {
            aux.closeShop();
            break;
          }
          if (s.active) {
            s.closeDialogue();
            break;
          }
          if (s.activeMenu === 'settings') {
            s.setMenu('pause');
            break;
          }
          if (s.activeMenu !== 'none') {
            s.setMenu('none');
            break;
          }
          // When the pointer is locked the browser swallows Esc; the pause
          // path there is the pointer_lock event below.
          s.setMenu('pause');
          break;
        }
        default:
          break;
      }
    };

    // Esc while pointer-locked exits the lock → engine emits pointer_lock.
    const offPointerLock = gameEvents.on('pointer_lock', ({ locked }) => {
      if (locked) return;
      const s = useGameStore.getState();
      if (s.dead || s.activeMenu !== 'none' || s.active) return;
      if (useUiAux.getState().shopId) return;
      s.setMenu('pause');
    });

    // Dialogue opening steals focus from any menu; death clears everything.
    const offDialogue = gameEvents.on('dialogue_open', () => {
      useGameStore.getState().setMenu('none');
    });
    const offDeath = gameEvents.on('player_died', () => {
      useGameStore.getState().setMenu('none');
      useUiAux.getState().closeShop();
    });

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      offPointerLock();
      offDialogue();
      offDeath();
    };
  }, [enabled]);
}
