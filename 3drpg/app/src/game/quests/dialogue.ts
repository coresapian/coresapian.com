// ============================================================================
// CORESAPIAN — src/game/quests/dialogue.ts
// Dialogue runtime (gdd §8.4). Walks contracts/quests.ts DIALOGUE_TREES,
// evaluates choice conditions, executes effects, and drives the store
// Dialogue slice (the ONLY writer). ui renders from the slice — it never
// imports this module.
//
// ── STORE-ONLY CONTRACT WITH ui (binding conventions) ──────────────────────
// Render from `store.active = { npcId, treeId, nodeId }`:
//   • nodeId 'shop:<shopId>'        → render the shop panel from SHOPS.
//   • nodeId 'branch:<questId>'     → render QUESTS[questId].branch prompt +
//                                     options.
//   • otherwise                     → render DIALOGUE_TREES[treeId] .nodes[nodeId]
//                                     (filter choices by choice.condition).
// Input:
//   • Pick a dialogue choice  → store.advanceDialogue(choice.id)   ← the
//     runtime resolves the choice's effects and advances/closes itself.
//     (Passing a next NODE id also works as a fallback; passing a choice id
//     is unambiguous and preferred.)
//   • Pick a branch option    → store.advanceDialogue(
//                                     'branch:<questId>:<optionId>').
//   • Close / Esc             → store.closeDialogue().
// ============================================================================

import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';
import type { ServiceRegistry } from '../services';
import type { DialogueSession } from '../../../contracts/types';
import type {
  DialogueChoice,
  DialogueEffect,
  DialogueNode,
  DialogueTree,
  NpcDef,
} from '../../../contracts/quests';
import { DIALOGUE_TREES, FACTIONS, NPCS, QUESTS, SHOPS } from '../../../contracts/quests';
import { buildQuestRewardOp, submitOp } from '../rpg/ops';
import { isShopOpen } from '../rpg/shops';
import type { QuestRuntimeApi } from './runtime';

/** Sentinel nodeId prefixes (see header contract). */
export const SHOP_NODE_PREFIX = 'shop:';
export const BRANCH_NODE_PREFIX = 'branch:';

export interface DialogueRuntimeDeps {
  store: UseGameStore;
  events: GameEventBus;
  getServices(): ServiceRegistry | undefined;
  quests: QuestRuntimeApi;
}

export interface DialogueRuntimeApi {
  /** Open a conversation with an NPC (interactable callback). */
  openFor(npcId: string): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Generic quest-giver template (gdd §8.4) — deterministic from contracts.
// Fallback for NPCs with quests but no explicit tree. (Current roster: none —
// every quest giver ships an explicit tree; shop-only NPCs open their shop
// node directly. Kept for contract completeness.)
// ---------------------------------------------------------------------------

export function buildGenericTree(npc: NpcDef): DialogueTree {
  const nodes: Record<string, DialogueNode> = {};
  const questId = npc.questIds[0];
  const quest = questId ? QUESTS[questId] : undefined;

  const rootChoices: DialogueChoice[] = [];
  if (quest) {
    rootChoices.push({
      id: 'c_quest',
      text: `${quest.name} — ${quest.summary}`,
      next: 'offer',
      condition: {},
    });
  }
  if (npc.shopId) {
    rootChoices.push({
      id: 'c_shop',
      text: 'Show me your wares.',
      next: null,
      effects: [{ type: 'open_shop', shopId: npc.shopId }],
    });
  }
  rootChoices.push({ id: 'c_leave', text: 'Farewell.', next: null });

  nodes.root = { id: 'root', text: npc.description, choices: rootChoices };

  if (quest) {
    nodes.offer = {
      id: 'offer',
      text: quest.summary,
      choices: [
        {
          id: 'c_accept',
          text: 'I will do it. (Accept)',
          next: null,
          effects: [{ type: 'start_quest', questId: quest.id }],
        },
        { id: 'c_decline', text: 'Not now.', next: null },
      ],
    };
    nodes.progress = {
      id: 'progress',
      text: quest.objectives.map((o) => `— ${o.text} (${o.qty})`).join('\n'),
      choices: [
        {
          id: 'c_turnin',
          text: 'It is done. (Turn in)',
          next: null,
          effects: [{ type: 'advance_quest', questId: quest.id }],
        },
        { id: 'c_leave', text: 'Farewell.', next: null },
      ],
    };
  }

  return { id: `dt_generic_${npc.id}`, startNode: 'root', nodes };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function createDialogueRuntime(deps: DialogueRuntimeDeps): DialogueRuntimeApi {
  const { store, events, getServices, quests } = deps;

  /** Runtime-generated trees (generic template). Keyed by tree id. */
  const runtimeTrees = new Map<string, DialogueTree>();
  let interpreting = false;
  let prevSession: DialogueSession | null = null;
  /** Last branch-less status per quest, for auto-opening branch sessions. */
  const lastStatus = new Map<string, string>();
  let disposed = false;

  const treeFor = (treeId: string): DialogueTree | undefined =>
    DIALOGUE_TREES[treeId] ?? runtimeTrees.get(treeId);

  const nodeFor = (session: DialogueSession): DialogueNode | undefined =>
    treeFor(session.treeId)?.nodes[session.nodeId];

  // ------------------------------------------------------- condition eval

  const choiceVisible = (choice: DialogueChoice): boolean => {
    const c = choice.condition;
    if (!c) return true;
    const s = store.getState();
    if (c.questActive) {
      const st = s.quests[c.questActive]?.status;
      if (st !== 'active' && st !== 'ready_to_turn_in') return false;
    }
    if (c.questComplete && s.quests[c.questComplete]?.status !== 'completed') return false;
    if (c.minLevel !== undefined && s.level < c.minLevel) return false;
    return true;
  };

  // ---------------------------------------------------------- effect exec

  const runEffect = (session: DialogueSession, effect: DialogueEffect): boolean => {
    // Returns true when the effect itself moved the session (shop sentinel).
    const s = store.getState();
    switch (effect.type) {
      case 'start_quest':
        quests.startQuest(effect.questId);
        return false;
      case 'advance_quest':
        quests.advanceQuest(effect.questId, session.npcId);
        return false;
      case 'choose_branch':
        quests.chooseBranch(effect.questId, effect.optionId);
        return false;
      case 'give_item':
        submitOp(buildQuestRewardOp(`dialogue:${session.npcId}`, [{ itemId: effect.itemId, qty: effect.qty }], 0));
        return false;
      case 'faction': {
        s.applyFactionDelta(effect.factionId, effect.delta);
        const name = FACTIONS[effect.factionId]?.name ?? effect.factionId;
        s.notify('info', `${name} ${effect.delta >= 0 ? '+' : ''}${effect.delta}`);
        return false;
      }
      case 'open_shop': {
        if (!isShopOpen(effect.shopId)) {
          const npc = NPCS[session.npcId];
          const shop = SHOPS[effect.shopId];
          s.notify('warning', `${npc?.name ?? 'The keeper'} is asleep — ${shop?.name ?? 'the shop'} is closed.`);
          return false;
        }
        moveTo(`${SHOP_NODE_PREFIX}${effect.shopId}`);
        return true;
      }
      case 'heal': {
        const svc = getServices();
        const player = svc?.get('player');
        if (player) {
          const vit = s.vitals;
          const missing = Math.max(0, vit.maxHp - vit.hp);
          if (missing > 0) player.heal(missing);
          events.emit('play_sfx', { sfxId: 'sfx.heal' });
          const npc = NPCS[session.npcId];
          s.notify('info', `${npc?.name ?? 'The healer'} tends your wounds.`);
        }
        return false;
      }
    }
  };

  // ------------------------------------------------------- session moves

  const emitOpen = (session: DialogueSession): void => {
    events.emit('dialogue_open', {
      npcId: session.npcId,
      treeId: session.treeId,
      nodeId: session.nodeId,
    });
  };

  const moveTo = (nodeId: string): void => {
    interpreting = true;
    try {
      store.getState().advanceDialogue(nodeId);
      prevSession = store.getState().active;
    } finally {
      interpreting = false;
    }
    events.emit('dialogue_advance', { nodeId });
  };

  const close = (): void => {
    interpreting = true;
    try {
      store.getState().closeDialogue();
      prevSession = null;
    } finally {
      interpreting = false;
    }
    events.emit('dialogue_close', {});
  };

  const open = (session: DialogueSession): void => {
    interpreting = true;
    try {
      store.getState().openDialogue(session);
      prevSession = session;
    } finally {
      interpreting = false;
    }
    emitOpen(session);
  };

  /** Resolve a chosen option: effects, then advance or close. */
  const resolveChoice = (session: DialogueSession, choice: DialogueChoice): void => {
    if (!choiceVisible(choice)) {
      moveTo(session.nodeId); // condition failed: stay put (no-op render)
      return;
    }
    let moved = false;
    for (const effect of choice.effects ?? []) {
      moved = runEffect(session, effect) || moved;
    }
    if (moved) return; // an effect already re-targeted the session (shop node)
    if (choice.next) {
      moveTo(choice.next);
    } else {
      close();
    }
  };

  // ------------------------------------------------ ui-driven transitions

  const interpret = (): void => {
    if (interpreting || disposed) return;
    const active = store.getState().active;
    const prev = prevSession;
    prevSession = active;

    // Session closed by ui (Esc / close button).
    if (!active) {
      if (!prev) return; // unrelated store change; no dialogue was open
      if (nodeFor(prev)) {
        // Best-effort: a node with exactly ONE effect-bearing null-next
        // choice resolves that choice on close (covers ui implementations
        // that call closeDialogue() for terminal choices).
        const node = nodeFor(prev)!;
        const terminal = node.choices.filter((c) => c.next === null && (c.effects?.length ?? 0) > 0);
        if (terminal.length === 1 && choiceVisible(terminal[0])) {
          for (const effect of terminal[0].effects ?? []) runEffect(prev, effect);
        }
      }
      events.emit('dialogue_close', {});
      return;
    }

    // Fresh open by someone else (shouldn't happen — this module owns opens).
    if (!prev || prev.npcId !== active.npcId || prev.treeId !== active.treeId) {
      return;
    }
    if (prev.nodeId === active.nodeId) return;

    const arg = active.nodeId;
    const node = treeFor(prev.treeId)?.nodes[prev.nodeId];

    // Branch sentinel: 'branch:<questId>:<optionId>'.
    if (arg.startsWith(BRANCH_NODE_PREFIX)) {
      const parts = arg.slice(BRANCH_NODE_PREFIX.length).split(':');
      if (parts.length === 2) {
        quests.chooseBranch(parts[0], parts[1]);
        close();
        return;
      }
      return; // 'branch:<questId>' — the branch panel itself; ui renders it.
    }

    if (!node) return;

    // Preferred convention: arg is a CHOICE id of the current node.
    const byId = node.choices.find((c) => c.id === arg);
    if (byId) {
      // Restore the pre-click node, then resolve (which advances/closes).
      interpreting = true;
      try {
        store.getState().advanceDialogue(prev.nodeId);
        prevSession = store.getState().active;
      } finally {
        interpreting = false;
      }
      resolveChoice({ ...prev }, byId);
      return;
    }

    // Fallback convention: arg is the NEXT NODE id; run the matching choice.
    const byNext = node.choices.find((c) => c.next === arg);
    if (byNext) {
      interpreting = true;
      try {
        store.getState().advanceDialogue(prev.nodeId);
        prevSession = store.getState().active;
      } finally {
        interpreting = false;
      }
      resolveChoice({ ...prev }, byNext);
      return;
    }

    // Unknown target: leave as-is (ui may render its own fallback).
  };

  const unsubDialogue = store.subscribe(interpret);

  // --------------------------- auto-open branch sessions on chapter finale
  // Seed statuses so a server-restored session doesn't pop branch panels
  // on the first unrelated store change.
  for (const [questId, q] of Object.entries(store.getState().quests)) {
    lastStatus.set(questId, q.status);
  }
  const unsubQuests = store.subscribe(() => {
    if (disposed) return;
    const questsState = store.getState().quests;
    for (const [questId, q] of Object.entries(questsState)) {
      const prev = lastStatus.get(questId);
      if (prev !== q.status) {
        lastStatus.set(questId, q.status);
        if (q.status === 'ready_to_turn_in' && !store.getState().active) {
          const def = QUESTS[questId];
          if (def?.branch) {
            const giver = NPCS[def.giverId];
            open({
              npcId: def.giverId,
              treeId: giver?.dialogueTreeId ?? '',
              nodeId: `${BRANCH_NODE_PREFIX}${questId}`,
            });
          }
        }
      }
    }
  });

  // --------------------------------------------------------------- openFor

  const openFor = (npcId: string): void => {
    const npc = NPCS[npcId];
    if (!npc || disposed) return;

    // Talk objectives advance on any conversation with the target NPC.
    quests.onDialogueOpened(npcId);

    // 1. A pending branch outranks everything else.
    for (const questId of npc.questIds) {
      const def = QUESTS[questId];
      const q = store.getState().quests[questId];
      if (def?.branch && q?.status === 'ready_to_turn_in' && !q.choices[def.branch.id]) {
        open({
          npcId,
          treeId: npc.dialogueTreeId ?? '',
          nodeId: `${BRANCH_NODE_PREFIX}${questId}`,
        });
        return;
      }
    }

    // 2. Explicit tree from contracts.
    if (npc.dialogueTreeId) {
      const tree = DIALOGUE_TREES[npc.dialogueTreeId];
      if (tree) {
        open({ npcId, treeId: tree.id, nodeId: tree.startNode });
        return;
      }
    }

    // 3. Shop-only NPC (bjorn, sindri): straight to the shop panel, or a
    //    closed-shop note while the keeper sleeps.
    if (npc.shopId) {
      if (isShopOpen(npc.shopId)) {
        open({ npcId, treeId: '', nodeId: `${SHOP_NODE_PREFIX}${npc.shopId}` });
      } else {
        const shop = SHOPS[npc.shopId];
        store
          .getState()
          .notify('warning', `${npc.name} is asleep — ${shop?.name ?? 'the shop'} is closed.`);
      }
      return;
    }

    // 4. Generic quest-giver template (gdd §8.4 fallback).
    const tree = buildGenericTree(npc);
    runtimeTrees.set(tree.id, tree);
    open({ npcId, treeId: tree.id, nodeId: tree.startNode });
  };

  return {
    openFor,
    dispose() {
      disposed = true;
      unsubDialogue();
      unsubQuests();
      runtimeTrees.clear();
    },
  };
}
