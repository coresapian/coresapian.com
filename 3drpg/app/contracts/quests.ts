// ============================================================================
// CORESAPIAN — contracts/quests.ts
// Factions, shops, NPCs (with schedules), the 9-chapter campaign, 6 side
// quests, and branching dialogue trees. Pure data.
// ============================================================================

import type { QuestObjectiveKind, RealmId, Vec3 } from './types';

// ---------------------------------------------------------------------------
// Factions (3)
// ---------------------------------------------------------------------------

export type FactionId = 'aesir_pact' | 'dvergr_guild' | 'free_jotnar';

export interface FactionDef {
  id: FactionId;
  name: string;
  description: string;
  /** Rank titles ascending; thresholds in FACTION_RANKS. */
  ranks: string[];
}

/** Standing thresholds for ranks: [-1000, -300, 0, 300, 800, 1500]. */
export const FACTION_RANK_THRESHOLDS = [-1000, -300, 0, 300, 800, 1500] as const;

export const FACTIONS: Record<FactionId, FactionDef> = {
  aesir_pact: {
    id: 'aesir_pact',
    name: 'The Æsir Pact',
    description:
      'Oath-sworn mortals and loyal valkyries holding the realms together until the high halls wake. Honor, order, and the old sacrifices.',
    ranks: ['Forsworn', 'Doubted', 'Neutral', 'Oath-kin', 'Shield-sworn', 'Hall-champion'],
  },
  dvergr_guild: {
    id: 'dvergr_guild',
    name: 'The Dvergr Guild',
    description:
      'The forge-clans of Svartálfaheimr. They keep the old craft-laws, weigh every debt, and never forget a name — yours included.',
    ranks: ['Oath-breaker', 'Debtor', 'Neutral', 'Customer', 'Guild-friend', 'Forge-kin'],
  },
  free_jotnar: {
    id: 'free_jotnar',
    name: 'The Free Jǫtnar',
    description:
      'Giants who refuse both Þrymr’s crown and Surtr’s fire. They want the realms loosened, not burned — and they remember who helped.',
    ranks: ['Marked', 'Distrusted', 'Neutral', 'Known', 'Jǫtun-pledged', 'Blood-bonded'],
  },
};

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

export interface ShopStockEntry {
  itemId: string;
  /** Buy price in gold (≈2x sell price). */
  price: number;
  /** Undefined = infinite stock. */
  qty?: number;
}

export interface ShopDef {
  id: string;
  name: string;
  stock: ShopStockEntry[];
}

export const SHOPS: Record<string, ShopDef> = {
  shop_eira: {
    id: 'shop_eira',
    name: "Eira's Remedies",
    stock: [
      { itemId: 'con_mead_s', price: 10 },
      { itemId: 'con_tonic', price: 10 },
      { itemId: 'con_rations', price: 8 },
      { itemId: 'con_elixir', price: 16 },
      { itemId: 'con_ward', price: 28 },
      { itemId: 'mat_herb', price: 5 },
    ],
  },
  shop_bjorn: {
    id: 'shop_bjorn',
    name: "Bjorn's Smithy",
    stock: [
      { itemId: 'wpn_seax', price: 30 },
      { itemId: 'wpn_axe_skegg', price: 30 },
      { itemId: 'wpn_maul', price: 30 },
      { itemId: 'shd_linden', price: 25 },
      { itemId: 'arm_leather_cap', price: 20 },
      { itemId: 'arm_wolfhide', price: 28 },
      { itemId: 'mat_iron', price: 8 },
    ],
  },
  shop_brokkr: {
    id: 'shop_brokkr',
    name: "Brokkr's Deep Forge",
    stock: [
      { itemId: 'wpn_sword_dvergr', price: 120 },
      { itemId: 'shd_dvergr', price: 260 },
      { itemId: 'arm_dvergr_plate', price: 320 },
      { itemId: 'mat_steel', price: 25 },
      { itemId: 'mat_crystal', price: 35 },
    ],
  },
  shop_sindri: {
    id: 'shop_sindri',
    name: "Sindri's Last Counter",
    stock: [
      { itemId: 'wpn_hammer_thrym', price: 1400 },
      { itemId: 'arm_valkyr_helm', price: 1100 },
      { itemId: 'arm_aesir_greaves', price: 550 },
      { itemId: 'shd_svalinn', price: 1300 },
      { itemId: 'mat_gold', price: 80 },
    ],
  },
};

// ---------------------------------------------------------------------------
// NPCs (12) — schedules in game-hours (0..24), positions relative to realm center
// ---------------------------------------------------------------------------

export type NpcRole = 'quest' | 'shop' | 'smith' | 'seer' | 'innkeep';

export interface ScheduleBlock {
  startHour: number;
  endHour: number;
  location: Vec3;
  activity: 'sleep' | 'work' | 'shop' | 'wander' | 'pray';
}

export interface NpcDef {
  id: string;
  name: string;
  role: NpcRole;
  realm: RealmId;
  description: string;
  schedule: ScheduleBlock[];
  shopId?: string;
  dialogueTreeId?: string;
  questIds: string[];
}

export const NPCS: Record<string, NpcDef> = {
  hulda: {
    id: 'hulda', name: 'Hulda the Seeress', role: 'seer', realm: 'midgard',
    description: 'A vǫlva who buried her own sight and dug it up again. She knows how your thread ends; she will not say.',
    schedule: [
      { startHour: 0, endHour: 6, location: { x: 4, y: 0, z: 6 }, activity: 'sleep' },
      { startHour: 6, endHour: 18, location: { x: 10, y: 0, z: -8 }, activity: 'pray' },
      { startHour: 18, endHour: 24, location: { x: 6, y: 0, z: 2 }, activity: 'wander' },
    ],
    dialogueTreeId: 'dt_hulda_ch1', questIds: ['q_main_1'],
  },
  eira: {
    id: 'eira', name: 'Eira the Healer', role: 'shop', realm: 'midgard',
    description: 'Leech-wife of the steading, named for the goddess of healing and living up to it.',
    schedule: [
      { startHour: 0, endHour: 7, location: { x: -8, y: 0, z: 10 }, activity: 'sleep' },
      { startHour: 7, endHour: 19, location: { x: -10, y: 0, z: 6 }, activity: 'shop' },
      { startHour: 19, endHour: 24, location: { x: -6, y: 0, z: 12 }, activity: 'wander' },
    ],
    shopId: 'shop_eira', dialogueTreeId: 'dt_eira_side', questIds: ['q_side_herbs'],
  },
  bjorn: {
    id: 'bjorn', name: 'Bjorn Ironhand', role: 'smith', realm: 'midgard',
    description: 'The steading’s smith. His left hand is iron because his right one made it.',
    schedule: [
      { startHour: 0, endHour: 6, location: { x: 12, y: 0, z: 10 }, activity: 'sleep' },
      { startHour: 6, endHour: 20, location: { x: 14, y: 0, z: 6 }, activity: 'shop' },
      { startHour: 20, endHour: 24, location: { x: 12, y: 0, z: 10 }, activity: 'sleep' },
    ],
    shopId: 'shop_bjorn', questIds: [],
  },
  kettil: {
    id: 'kettil', name: 'Kettil the Herder', role: 'quest', realm: 'midgard',
    description: 'A sheep-man down to his last nine ewes, and the wolves know the count better than he does.',
    schedule: [
      { startHour: 0, endHour: 5, location: { x: -20, y: 0, z: -14 }, activity: 'sleep' },
      { startHour: 5, endHour: 21, location: { x: -24, y: 0, z: -10 }, activity: 'work' },
      { startHour: 21, endHour: 24, location: { x: -20, y: 0, z: -14 }, activity: 'sleep' },
    ],
    dialogueTreeId: 'dt_kettil_side', questIds: ['q_side_flock'],
  },
  vigdis: {
    id: 'vigdis', name: 'Vígdís, Herald of Dellingr', role: 'quest', realm: 'alfheim',
    description: 'A ljósálfr envoy whose light has gone grey at the edges, like dawn before a storm.',
    schedule: [
      { startHour: 0, endHour: 24, location: { x: -30, y: 0, z: 20 }, activity: 'pray' },
    ],
    dialogueTreeId: 'dt_vigdis_ch2', questIds: ['q_main_2', 'q_side_skald'],
  },
  brokkr: {
    id: 'brokkr', name: 'Brokkr of the Deep Forge', role: 'smith', realm: 'svartalfheim',
    description: 'The same Brokkr who made Mjǫllnir — older, grumpier, and still owed three favors by gods.',
    schedule: [
      { startHour: 0, endHour: 4, location: { x: 20, y: 0, z: 18 }, activity: 'sleep' },
      { startHour: 4, endHour: 22, location: { x: 24, y: 0, z: 12 }, activity: 'shop' },
      { startHour: 22, endHour: 24, location: { x: 20, y: 0, z: 18 }, activity: 'sleep' },
    ],
    shopId: 'shop_brokkr', dialogueTreeId: 'dt_brokkr_ch3', questIds: ['q_main_3', 'q_side_debt'],
  },
  skadi: {
    id: 'skadi', name: 'Skaði, Huntress of the Peaks', role: 'quest', realm: 'jotunheim',
    description: 'The skiing huntress, once bride of Njǫrðr, at war with Þrymr’s court on her mountain.',
    schedule: [
      { startHour: 0, endHour: 6, location: { x: -18, y: 0, z: 24 }, activity: 'sleep' },
      { startHour: 6, endHour: 22, location: { x: -22, y: 0, z: 18 }, activity: 'work' },
      { startHour: 22, endHour: 24, location: { x: -18, y: 0, z: 24 }, activity: 'sleep' },
    ],
    dialogueTreeId: 'dt_skadi_ch4', questIds: ['q_main_4'],
  },
  verdandi: {
    id: 'verdandi', name: "Verðandi's Echo", role: 'seer', realm: 'niflheim',
    description: 'A reflection of the Norn of Becoming, left in the mist like a word in a cold room.',
    schedule: [{ startHour: 0, endHour: 24, location: { x: 8, y: 0, z: -12 }, activity: 'pray' }],
    dialogueTreeId: 'dt_verdandi_ch5', questIds: ['q_main_5'],
  },
  eldrgautr: {
    id: 'eldrgautr', name: 'Eldrgautr the Fire-sworn', role: 'quest', realm: 'muspelheim',
    description: 'A mortal priest of the flame, kept alive past his span by the fire he serves. Parts of him glow now.',
    schedule: [
      { startHour: 0, endHour: 8, location: { x: 16, y: 0, z: 20 }, activity: 'sleep' },
      { startHour: 8, endHour: 24, location: { x: 20, y: 0, z: 14 }, activity: 'pray' },
    ],
    dialogueTreeId: 'dt_eldrgautr_ch6', questIds: ['q_main_6'],
  },
  byggvir: {
    id: 'byggvir', name: 'Byggvir, Steward of Freyr', role: 'quest', realm: 'vanaheim',
    description: 'Barley-god and household spirit of the Vanir, small of stature, immense of opinion.',
    schedule: [
      { startHour: 0, endHour: 5, location: { x: -12, y: 0, z: 16 }, activity: 'sleep' },
      { startHour: 5, endHour: 23, location: { x: -16, y: 0, z: 10 }, activity: 'work' },
      { startHour: 23, endHour: 24, location: { x: -12, y: 0, z: 16 }, activity: 'sleep' },
    ],
    dialogueTreeId: 'dt_byggvir_ch7', questIds: ['q_main_7', 'q_side_root'],
  },
  modgudr: {
    id: 'modgudr', name: 'Móðguðr of Gjallarbrú', role: 'quest', realm: 'helheim',
    description: 'The battle-weary maiden who guards the gold-roofed bridge over Gjöll. She counts every crossing.',
    schedule: [{ startHour: 0, endHour: 24, location: { x: 12, y: 0, z: -18 }, activity: 'work' }],
    dialogueTreeId: 'dt_modgudr_ch8', questIds: ['q_main_8', 'q_side_mercy'],
  },
  heimdallr: {
    id: 'heimdallr', name: 'Heimdallr, Warden of Bifröst', role: 'quest', realm: 'asgard',
    description: 'The white god, nine mothers’ son, hearing the grass grow on a burning bridge. He is very tired.',
    schedule: [{ startHour: 0, endHour: 24, location: { x: -20, y: 0, z: 28 }, activity: 'work' }],
    dialogueTreeId: 'dt_heimdallr_ch9', questIds: ['q_main_9'],
  },
  sindri: {
    id: 'sindri', name: 'Sindri, Heir of the Forge', role: 'smith', realm: 'asgard',
    description: 'Brokkr’s brother, come to sell the last of the god-forged stock before the end of everything.',
    schedule: [
      { startHour: 0, endHour: 6, location: { x: 24, y: 0, z: 20 }, activity: 'sleep' },
      { startHour: 6, endHour: 22, location: { x: 28, y: 0, z: 14 }, activity: 'shop' },
      { startHour: 22, endHour: 24, location: { x: 24, y: 0, z: 20 }, activity: 'sleep' },
    ],
    shopId: 'shop_sindri', questIds: [],
  },
};

// ---------------------------------------------------------------------------
// Quests — 9 campaign chapters + 6 side quests
// ---------------------------------------------------------------------------

export interface ObjectiveDef {
  id: string;
  kind: QuestObjectiveKind;
  text: string;
  qty: number;
  enemyId?: string;
  itemId?: string;
  npcId?: string;
  /** Interactable id for 'interact' objectives (runestones, shrines...). */
  interactId?: string;
  /** For 'reach' objectives. */
  position?: Vec3;
}

export interface BranchOption {
  id: string;
  text: string;
  factionDelta?: { factionId: FactionId; delta: number }[];
  outcomeText: string;
  bonusXp?: number;
}

export interface BranchDef {
  id: string;
  prompt: string;
  options: BranchOption[];
}

export interface QuestRewards {
  xp: number;
  gold: number;
  items?: { itemId: string; qty: number }[];
  skillPoints?: number;
  unlockRealmAbility?: string;
  unlockRealm?: RealmId;
}

export interface QuestDef {
  id: string;
  name: string;
  type: 'main' | 'side';
  chapter?: number;
  realm: RealmId;
  giverId: string;
  level: number;
  summary: string;
  objectives: ObjectiveDef[];
  branch?: BranchDef;
  rewards: QuestRewards;
  nextQuestId?: string;
}

export const QUESTS: Record<string, QuestDef> = {
  // ------------------------------------------------------------ CHAPTER 1
  q_main_1: {
    id: 'q_main_1', name: 'Sparks of the Unraveling', type: 'main', chapter: 1,
    realm: 'midgard', giverId: 'hulda', level: 1,
    summary:
      'The dead walk out of the barrows and the Norns’ loom has gone quiet. Hulda the Seeress sends you to read the standing stones — and then into the wolf-dark where a broken chain still smokes.',
    objectives: [
      { id: 'o1', kind: 'kill', text: 'Unmake the draugr in the pine barrows', qty: 6, enemyId: 'draugr' },
      { id: 'o2', kind: 'interact', text: 'Read the three ward-stones of the steading', qty: 3, interactId: 'ward_stone' },
      { id: 'o3', kind: 'talk', text: 'Return to Hulda with what the stones said', qty: 1, npcId: 'hulda' },
      { id: 'o4', kind: 'boss', text: 'Face Fenrir at the broken chain', qty: 1, enemyId: 'boss_fenrir' },
    ],
    branch: {
      id: 'b_fenrir',
      prompt: 'Fenrir kneels, the last thread of Gleipnir smoking in his fur. Hulda’s voice in your mind: "A bound wolf is a promise kept. A dead wolf is a debt called due."',
      options: [
        {
          id: 'bind', text: 'Re-bind the Wolf with the shard of Gleipnir. (Honor the old law.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 200 }],
          outcomeText: 'You knot the shining thread around the great paw. Fenrir’s eyes say he will remember your face at the end of the world.',
          bonusXp: 100,
        },
        {
          id: 'release', text: 'Cut the last thread. Let the Wolf run. (Honor no chains.)',
          factionDelta: [{ factionId: 'free_jotnar', delta: 200 }],
          outcomeText: 'The thread parts like smoke. Fenrir does not thank you — wolves do not — but he turns from the steading, and the sheep live.',
          bonusXp: 100,
        },
      ],
    },
    rewards: {
      xp: 300, gold: 60, skillPoints: 1,
      items: [{ itemId: 'con_mead_s', qty: 2 }],
      unlockRealmAbility: 'ra_midgard', unlockRealm: 'alfheim',
    },
    nextQuestId: 'q_main_2',
  },

  // ------------------------------------------------------------ CHAPTER 2
  q_main_2: {
    id: 'q_main_2', name: 'The Dimming of Ljós', type: 'main', chapter: 2,
    realm: 'alfheim', giverId: 'vigdis', level: 4,
    summary:
      'Alfheim’s light is being drunk by something under the roots. Vígdís asks you to relight the beacon-shrines and find what gnaws the world below.',
    objectives: [
      { id: 'o1', kind: 'interact', text: 'Relight the four beacon-shrines', qty: 4, interactId: 'beacon_shrine' },
      { id: 'o2', kind: 'kill', text: 'Drive the dökkálfar from the light-groves', qty: 8, enemyId: 'dokkalf' },
      { id: 'o3', kind: 'boss', text: 'End the madness of Dáinn, the Root-Gnawed Stag', qty: 1, enemyId: 'boss_dainn' },
    ],
    branch: {
      id: 'b_dainn',
      prompt: 'Dáinn falls, and in his eye you see it: he did not go mad. He was fed the severed root — by hands that knew exactly what it would do.',
      options: [
        {
          id: 'tell_pact', text: 'Send word to the Æsir Pact: someone is feeding the Unraveling. (Order must know.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 150 }],
          outcomeText: 'Vígdís bows. "Then the hunt is on, and the high halls will hear of it."',
        },
        {
          id: 'tell_none', text: 'Keep the knowledge close. Knowledge is a weapon; weapons are not shared. (Trust no hall.)',
          factionDelta: [{ factionId: 'free_jotnar', delta: 100 }],
          outcomeText: 'You say nothing. The mist keeps your secret, for now. Secrets appreciate.',
          bonusXp: 150,
        },
      ],
    },
    rewards: {
      xp: 500, gold: 90, skillPoints: 1,
      items: [{ itemId: 'rune_eldr_bolt', qty: 1 }],
      unlockRealmAbility: 'ra_alfheim', unlockRealm: 'svartalfheim',
    },
    nextQuestId: 'q_main_3',
  },

  // ------------------------------------------------------------ CHAPTER 3
  q_main_3: {
    id: 'q_main_3', name: 'Debts of the Deep Forge', type: 'main', chapter: 3,
    realm: 'svartalfheim', giverId: 'brokkr', level: 8,
    summary:
      'Andvari’s cursed gold has surfaced in the dvergr markets, and every hand that holds it grows colder. Brokkr wants the hoard unmade — but the Guild and the Free Jǫtnar both want the gold.',
    objectives: [
      { id: 'o1', kind: 'kill', text: 'Cull the greed-mad dökkálfar of the lower galleries', qty: 8, enemyId: 'dokkalf' },
      { id: 'o2', kind: 'collect', text: 'Recover cursed gold from the veins', qty: 5, itemId: 'mat_gold' },
      { id: 'o3', kind: 'boss', text: 'Break Andvari upon his own hoard', qty: 1, enemyId: 'boss_andvari' },
    ],
    branch: {
      id: 'b_hoard',
      prompt: 'The hoard lies cooling. Brokkr extends one calloused hand. Behind you, a hooded agent of the Free Jǫtnar whispers that the gold could buy a thousand spears against Þrymr.',
      options: [
        {
          id: 'give_guild', text: 'Give the hoard to the Dvergr Guild for unmaking. (A debt is a debt.)',
          factionDelta: [{ factionId: 'dvergr_guild', delta: 300 }],
          outcomeText: 'Brokkr weighs the gold, then weighs you. "Paid," he says, which from a dvergr is a love poem.',
        },
        {
          id: 'give_jotnar', text: 'Slip the hoard to the Free Jǫtnar. (Arm the rebellion.)',
          factionDelta: [{ factionId: 'free_jotnar', delta: 300 }, { factionId: 'dvergr_guild', delta: -150 }],
          outcomeText: 'The hooded agent vanishes into the galleries. Behind you, something in Brokkr’s face calcifies.',
          bonusXp: 200,
        },
      ],
    },
    rewards: {
      xp: 800, gold: 140, skillPoints: 1,
      items: [{ itemId: 'mat_steel', qty: 4 }],
      unlockRealmAbility: 'ra_svartalfheim', unlockRealm: 'jotunheim',
    },
    nextQuestId: 'q_main_4',
  },

  // ------------------------------------------------------------ CHAPTER 4
  q_main_4: {
    id: 'q_main_4', name: "The Giant-King's Ransom", type: 'main', chapter: 4,
    realm: 'jotunheim', giverId: 'skadi', level: 12,
    summary:
      'Þrymr holds a realm-seal in his hoard of stolen things, and Skaði holds a grudge the size of a mountain. Get the seal — by the road of iron or the road of words.',
    objectives: [
      { id: 'o1', kind: 'kill', text: 'Thin the hrímþursar of the high passes', qty: 6, enemyId: 'hrimthurs' },
      { id: 'o2', kind: 'reach', text: 'Reach the gates of Utgard', qty: 1, position: { x: 100, y: 0, z: 52 } },
      { id: 'o3', kind: 'boss', text: 'Throw down Þrymr, King of the Jǫtnar', qty: 1, enemyId: 'boss_thrym' },
    ],
    branch: {
      id: 'b_thrym',
      prompt: 'Þrymr kneels in the ruin of his court. Skaði’s spear hovers. "The old law demands his head," she says. "But a living king owes; a dead king only rots."',
      options: [
        {
          id: 'spare', text: 'Spare Þrymr, bound by oath to the Free Jǫtnar. (Mercy, of a kind.)',
          factionDelta: [{ factionId: 'free_jotnar', delta: 250 }],
          outcomeText: 'Þrymr swears the oath with his teeth showing. The Free Jǫtnar gain a king-shaped weapon.',
        },
        {
          id: 'execute', text: 'Let Skaði’s spear finish it. (The old law stands.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 250 }],
          outcomeText: 'The mountain is quiet after. Skaði wipes her spear and, once, almost smiles.',
          bonusXp: 200,
        },
      ],
    },
    rewards: {
      xp: 1200, gold: 200, skillPoints: 1,
      items: [{ itemId: 'rune_iss_shard', qty: 1 }],
      unlockRealmAbility: 'ra_jotunheim', unlockRealm: 'niflheim',
    },
    nextQuestId: 'q_main_5',
  },

  // ------------------------------------------------------------ CHAPTER 5
  q_main_5: {
    id: 'q_main_5', name: 'Mist and Memory', type: 'main', chapter: 5,
    realm: 'niflheim', giverId: 'verdandi', level: 16,
    summary:
      'In Niflheim the mist eats names. Verðandi’s Echo is fading, and with her the memory of who severed the Norns’ threads. Anchor her. Learn the name.',
    objectives: [
      { id: 'o1', kind: 'collect', text: 'Gather rimefrost to anchor the Echo', qty: 6, itemId: 'mat_rime' },
      { id: 'o2', kind: 'kill', text: 'Silence the draugr choirs of the fog', qty: 10, enemyId: 'draugr' },
      { id: 'o3', kind: 'boss', text: 'Defeat Hrímgrímnir, the Rime-Eater', qty: 1, enemyId: 'boss_hrimgrimnir' },
    ],
    branch: {
      id: 'b_memory',
      prompt: 'The Echo steadies, and speaks a name — then offers you a gift: "I can take the memory of your own death from you. You will fight without fear. Or keep it. Fear is a teacher."',
      options: [
        {
          id: 'forget', text: 'Let her take the memory. (Fight unafraid.)',
          outcomeText: 'Something cold leaves the back of your neck. Your hands no longer shake. (+10% damage vs giants, permanently.)',
          bonusXp: 300,
        },
        {
          id: 'remember', text: 'Keep the memory. (Fear is a teacher.)',
          outcomeText: 'The Echo bows, and is proud, and is gone. You remember how it ends. You fight anyway. (+10% XP, permanently.)',
          bonusXp: 100,
        },
      ],
    },
    rewards: {
      xp: 1600, gold: 260, skillPoints: 1,
      items: [{ itemId: 'rune_kald_bjorg', qty: 1 }],
      unlockRealmAbility: 'ra_niflheim', unlockRealm: 'muspelheim',
    },
    nextQuestId: 'q_main_6',
  },

  // ------------------------------------------------------------ CHAPTER 6
  q_main_6: {
    id: 'q_main_6', name: 'The Fire that Devours Oaths', type: 'main', chapter: 6,
    realm: 'muspelheim', giverId: 'eldrgautr', level: 20,
    summary:
      'Logi has broken the old pact that keeps wildfire fed but fenced. Eldrgautr, dying by inches of his own devotion, asks you to carry the oath-flame to the three braziers — and decide what burns after.',
    objectives: [
      { id: 'o1', kind: 'interact', text: 'Carry the oath-flame to the three braziers', qty: 3, interactId: 'oath_brazier' },
      { id: 'o2', kind: 'kill', text: 'Quench the eldjǫtnar of the ember fields', qty: 6, enemyId: 'eldjotunn' },
      { id: 'o3', kind: 'boss', text: 'Extinguish Logi, Flame of the Third Table', qty: 1, enemyId: 'boss_logi' },
    ],
    branch: {
      id: 'b_oathflame',
      prompt: 'The oath-flame gutters in your hand. Eldrgautr kneels: "Give it to me, and I will burn another hundred years holding the fence." From the ash, the Free Jǫtnar whisper: "Let it die. Fences are for gods and kings."',
      options: [
        {
          id: 'renew', text: 'Feed the oath-flame to Eldrgautr. (The fence holds.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 200 }],
          outcomeText: 'He swallows the fire like communion. His eyes become lamps. "Go," they say, in a voice like a hearth.',
        },
        {
          id: 'quench', text: 'Quench the oath-flame. (Let the fire choose.)',
          factionDelta: [{ factionId: 'free_jotnar', delta: 250 }],
          outcomeText: 'The flame goes out gently, like an old dog sleeping. The ember fields quiet. Somewhere, Surtr turns his head.',
          bonusXp: 250,
        },
      ],
    },
    rewards: {
      xp: 2200, gold: 340, skillPoints: 1,
      items: [{ itemId: 'rune_bruni_wave', qty: 1 }],
      unlockRealmAbility: 'ra_muspelheim', unlockRealm: 'vanaheim',
    },
    nextQuestId: 'q_main_7',
  },

  // ------------------------------------------------------------ CHAPTER 7
  q_main_7: {
    id: 'q_main_7', name: 'Thrice-Burned', type: 'main', chapter: 7,
    realm: 'vanaheim', giverId: 'byggvir', level: 24,
    summary:
      'Vanaheim’s groves rot from a memory: Gullveig, the witch the Æsir burned three times, has woken angry. Byggvir wants his mistress’s realm healed — by apology or by a fourth fire.',
    objectives: [
      { id: 'o1', kind: 'collect', text: 'Gather Yggdrasill sap for the rite of unburning', qty: 4, itemId: 'mat_sap' },
      { id: 'o2', kind: 'kill', text: 'Clear the root-mad trolls from the groves', qty: 5, enemyId: 'troll' },
      { id: 'o3', kind: 'boss', text: 'Survive Gullveig-Heiðr, the Thrice-Burned', qty: 1, enemyId: 'boss_gullveig' },
    ],
    branch: {
      id: 'b_gullveig',
      prompt: 'Gullveig kneels, three burn-scars glowing like coals. "The Æsir never said sorry," she observes. "Will you?"',
      options: [
        {
          id: 'apologize', text: 'Kneel, and speak the apology the Æsir never spoke. (End the old war.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: -100 }, { factionId: 'free_jotnar', delta: 150 }],
          outcomeText: 'The words are small and the silence after is enormous. Then the groves exhale, green again. Gullveig vanishes, laughing — kindly, which is somehow worse.',
          bonusXp: 400,
        },
        {
          id: 'fourth_fire', text: 'Answer with iron. Some fires must simply be put out. (Finish the burning.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 200 }],
          outcomeText: 'It takes a long time. When it is done, Byggvir plants barley over the ash and does not look at you for a while.',
          bonusXp: 200,
        },
      ],
    },
    rewards: {
      xp: 3000, gold: 440, skillPoints: 1,
      items: [{ itemId: 'rune_laekning', qty: 1 }],
      unlockRealmAbility: 'ra_vanaheim', unlockRealm: 'helheim',
    },
    nextQuestId: 'q_main_8',
  },

  // ------------------------------------------------------------ CHAPTER 8
  q_main_8: {
    id: 'q_main_8', name: 'The Hound at the Gate', type: 'main', chapter: 8,
    realm: 'helheim', giverId: 'modgudr', level: 28,
    summary:
      'Garmr’s chain has snapped, and the dead are leaving Helheim through the gap. Móðguðr cannot leave her bridge. Someone living must go in, leash the hound, and pay the toll.',
    objectives: [
      { id: 'o1', kind: 'kill', text: 'Turn back the draugr column at Gjallarbrú', qty: 12, enemyId: 'draugr' },
      { id: 'o2', kind: 'kill', text: 'Release the drowned valkyries from their oaths', qty: 4, enemyId: 'valkyrja' },
      { id: 'o3', kind: 'boss', text: 'Leash Garmr, Hound of the Slain', qty: 1, enemyId: 'boss_garmr' },
    ],
    branch: {
      id: 'b_toll',
      prompt: 'Garmr kneels, leashed but unashamed. Hel’s voice rises from the dark hall: "A toll is owed, living one. Leave something you love — a memory, a warmth — and pass with my favor. Or keep all of yourself, and be only ever a guest here."',
      options: [
        {
          id: 'pay_toll', text: 'Pay the toll: leave a warmth in the dark. (Hel remembers her friends.)',
          outcomeText: 'You leave the smell of your mother’s hearth-fire on the bridge. It is the brightest thing in Helheim. (+Hel’s Bargain empowers: cheat death cooldown halved.)',
          bonusXp: 300,
        },
        {
          id: 'keep_all', text: 'Keep all of yourself. (Guests owe nothing.)',
          outcomeText: 'The dark hall is silent. Móðguðr nods once, the way one soldier nods to another. (+15% damage to the drowned valkyries, permanently.)',
          bonusXp: 200,
        },
      ],
    },
    rewards: {
      xp: 4000, gold: 560, skillPoints: 1,
      items: [{ itemId: 'rune_vordr', qty: 1 }],
      unlockRealmAbility: 'ra_helheim', unlockRealm: 'asgard',
    },
    nextQuestId: 'q_main_9',
  },

  // ------------------------------------------------------------ CHAPTER 9
  q_main_9: {
    id: 'q_main_9', name: 'Ragnarök, Unwritten', type: 'main', chapter: 9,
    realm: 'asgard', giverId: 'heimdallr', level: 32,
    summary:
      'The severed threads were Loki’s work — not to end the world, but to make the ending his. On the wrong-colored Bifröst, Heimdallr lifts his horn and does not blow it. "That," he says, "is your part to play."',
    objectives: [
      { id: 'o1', kind: 'kill', text: 'Break the siege of the drowned valkyries', qty: 8, enemyId: 'valkyrja' },
      { id: 'o2', kind: 'interact', text: 'Re-true the four anchors of the Bifröst', qty: 4, interactId: 'bifrost_anchor' },
      { id: 'o3', kind: 'boss', text: 'Unwrite Loki Laufeyjarson, the Unbound', qty: 1, enemyId: 'boss_loki' },
    ],
    branch: {
      id: 'b_ending',
      prompt: 'Loki kneels among his own unravelled lies, and for once tells the truth: "Kill me, and the story closes — orderly, prophesied, done. Bind me again, and the wheel turns on. Or... walk away, and let every realm choose its own ending."',
      options: [
        {
          id: 'end_story', text: 'End the story. (Finale: the ordered world.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 500 }],
          outcomeText: 'ENDING — THE QUIET LOOM: The threads are re-woven as they were. The realms sleep soundly. In Midgard, children are born who will never know how close it came. You know. That is the price of happy endings.',
          bonusXp: 1000,
        },
        {
          id: 'bind_again', text: 'Bind him again. (Finale: the wheel turns.)',
          factionDelta: [{ factionId: 'dvergr_guild', delta: 300 }],
          outcomeText: 'ENDING — THE WHEEL: Gleipnir is reforged from your nine realm-seals. Loki smiles as it closes: "Same time next age?" The world goes on, watched and watching. Some call that mercy.',
          bonusXp: 1000,
        },
        {
          id: 'walk_away', text: 'Walk away. (Finale: nine free endings.)',
          factionDelta: [{ factionId: 'free_jotnar', delta: 500 }],
          outcomeText: 'ENDING — THE UNWRITTEN: You leave the trickster kneeling in the ruin of prophecy. Behind you, nine realms argue, build, burn, heal — freely, messily, forever. The Norns, jobless, take up gardening. It suits them.',
          bonusXp: 1000,
        },
      ],
    },
    rewards: {
      xp: 6000, gold: 900, skillPoints: 1,
      items: [{ itemId: 'ring_draupnir', qty: 1 }],
      unlockRealmAbility: 'ra_asgard',
    },
  },

  // ------------------------------------------------------------ SIDE QUESTS
  q_side_flock: {
    id: 'q_side_flock', name: 'The Lost Flock', type: 'side',
    realm: 'midgard', giverId: 'kettil', level: 2,
    summary: 'Kettil’s ewes are being counted by wolves. Thin the pack and bring the flock’s bell back from the pasture.',
    objectives: [
      { id: 'o1', kind: 'kill', text: 'Cull the vargr pack', qty: 4, enemyId: 'vargr' },
      { id: 'o2', kind: 'interact', text: 'Recover the flock’s bell from the pasture', qty: 1, interactId: 'flock_bell' },
    ],
    rewards: { xp: 250, gold: 40, items: [{ itemId: 'con_rations', qty: 3 }] },
  },
  q_side_herbs: {
    id: 'q_side_herbs', name: 'Nine Herbs Charm', type: 'side',
    realm: 'midgard', giverId: 'eira', level: 2,
    summary: 'Eira is low on the nine herbs of the old charm. Gather bundles from the wet places of Midgard.',
    objectives: [{ id: 'o1', kind: 'collect', text: 'Gather nine-herb bundles', qty: 6, itemId: 'mat_herb' }],
    rewards: { xp: 200, gold: 30, items: [{ itemId: 'con_mead_s', qty: 2 }] },
  },
  q_side_skald: {
    id: 'q_side_skald', name: "The Skald's Verses", type: 'side',
    realm: 'alfheim', giverId: 'vigdis', level: 5,
    summary: 'Three verse-stones of the light-elves’ oldest poem lie scattered. Read them, and carry the poem whole.',
    objectives: [{ id: 'o1', kind: 'interact', text: 'Read the three verse-stones', qty: 3, interactId: 'verse_stone' }],
    rewards: { xp: 500, gold: 70, items: [{ itemId: 'rune_gnista', qty: 1 }] },
  },
  q_side_debt: {
    id: 'q_side_debt', name: "Andvari's Debt", type: 'side',
    realm: 'svartalfheim', giverId: 'brokkr', level: 9,
    summary: 'Cursed coins keep surfacing in the markets. Brokkr pays honest gold for dishonest gold — no questions, some judgment.',
    objectives: [{ id: 'o1', kind: 'collect', text: "Recover Andvari's gold", qty: 5, itemId: 'mat_gold' }],
    branch: {
      id: 'b_debt',
      prompt: 'Brokkr counts the coins twice. "Guild price is forty a coin. Or tell me where you really found them, and we call it a favor — and dvergr favors compound."',
      options: [
        {
          id: 'take_gold', text: 'Take the gold. (Honest trade, cold comfort.)',
          outcomeText: 'Coins change hands. The ledger closes with a sound like a small door.',
          bonusXp: 0,
        },
        {
          id: 'take_favor', text: 'Take the favor. (Dvergr favors compound.)',
          factionDelta: [{ factionId: 'dvergr_guild', delta: 200 }],
          outcomeText: 'Brokkr writes your name in a book with no title. It feels more valuable than money. It probably is.',
          bonusXp: 150,
        },
      ],
    },
    rewards: { xp: 800, gold: 200 },
  },
  q_side_root: {
    id: 'q_side_root', name: "The World-Root's Thirst", type: 'side',
    realm: 'vanaheim', giverId: 'byggvir', level: 25,
    summary: 'A surfaced root of Yggdrasill is parched and the grove around it is dying angry. Water it with sap and blood.',
    objectives: [
      { id: 'o1', kind: 'collect', text: 'Gather Yggdrasill sap', qty: 4, itemId: 'mat_sap' },
      { id: 'o2', kind: 'kill', text: 'Drive off the root-mad trolls', qty: 2, enemyId: 'troll' },
    ],
    rewards: { xp: 1200, gold: 180, items: [{ itemId: 'con_mead_l', qty: 1 }] },
  },
  q_side_mercy: {
    id: 'q_side_mercy', name: "Valkyrie's Mercy", type: 'side',
    realm: 'helheim', giverId: 'modgudr', level: 29,
    summary: 'Three drowned valkyries circle the bridge, oath-locked and suffering. Móðguðr asks the living to do what the dead cannot: end it.',
    objectives: [{ id: 'o1', kind: 'kill', text: 'Release the drowned valkyries', qty: 3, enemyId: 'valkyrja' }],
    branch: {
      id: 'b_mercy',
      prompt: 'The last valkyrie kneels, her spear dimming. "Two roads, living one. Unbind my oath and let me drift to the hall I failed. Or bind my oath to you — and I will answer one summons, one day."',
      options: [
        {
          id: 'release', text: 'Unbind her oath. (Mercy.)',
          factionDelta: [{ factionId: 'aesir_pact', delta: 150 }],
          outcomeText: 'She rises like steam off snow, and the bridge is quieter, and better.',
          bonusXp: 200,
        },
        {
          id: 'bind', text: 'Bind her oath to your wyrd. (A debt of wings.)',
          outcomeText: 'Her oath-knot settles around your wrist like a cold bracelet. One day you will call. She will come. (Future content hook.)',
          bonusXp: 100,
        },
      ],
    },
    rewards: { xp: 1500, gold: 220 },
  },
};

// ---------------------------------------------------------------------------
// Dialogue trees
// Condition/effect vocabulary is intentionally tiny and data-driven so the
// rpg-quests runtime stays generic.
// ---------------------------------------------------------------------------

export type DialogueEffect =
  | { type: 'start_quest'; questId: string }
  | { type: 'advance_quest'; questId: string }
  | { type: 'choose_branch'; questId: string; branchId: string; optionId: string }
  | { type: 'give_item'; itemId: string; qty: number }
  | { type: 'faction'; factionId: FactionId; delta: number }
  | { type: 'open_shop'; shopId: string }
  | { type: 'heal' };

export interface DialogueChoice {
  id: string;
  text: string;
  /** Next node id, or null to end the conversation (after effects run). */
  next: string | null;
  condition?: {
    questActive?: string;
    questComplete?: string;
    minLevel?: number;
  };
  effects?: DialogueEffect[];
}

export interface DialogueNode {
  id: string;
  text: string;
  choices: DialogueChoice[];
}

export interface DialogueTree {
  id: string;
  startNode: string;
  nodes: Record<string, DialogueNode>;
}

export const DIALOGUE_TREES: Record<string, DialogueTree> = {
  dt_hulda_ch1: {
    id: 'dt_hulda_ch1', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᚺ — You walk out of the mist with warm blood, and the barrows stir every time you breathe. Sit. The Norns have gone quiet, and quiet Norns are a worse omen than loud ones.',
        choices: [
          { id: 'c1', text: 'What do you mean, quiet?', next: 'n2' },
          { id: 'c2', text: 'I need no fortunes, old mother.', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Three women sit at a well beneath the world-root and spin the thread of every life. Yesterday the spinning stopped. Someone cut the loom-strings, warm-blood — and loose threads tangle. The dead walk. The wolves grow bold. The realms lean toward a war they cannot name.',
        choices: [
          { id: 'c1', text: 'Then I will find who cut them.', next: 'n4', effects: [{ type: 'start_quest', questId: 'q_main_1' }] },
          { id: 'c2', text: 'Why me?', next: 'n3' },
        ],
      },
      n3: {
        id: 'n3',
        text: 'Because your thread is already cut, and yet here you stand, breathing. The loom does not know your name. You are the one thing in nine realms that nothing has foreseen — which makes you either our ruin or our rescue.',
        choices: [
          { id: 'c1', text: 'Point me at the barrows, then.', next: 'n4', effects: [{ type: 'start_quest', questId: 'q_main_1' }] },
        ],
      },
      n4: {
        id: 'n4',
        text: 'Good. Unmake the draugr in the pine barrows, read the three ward-stones, and come back to me. And warm-blood — when you find the broken chain in the wolf-dark, remember: some things are bound for a reason. Some are bound for someone’s reason.',
        choices: [{ id: 'c1', text: 'I go. (Begin Chapter 1)', next: null }],
      },
    },
  },

  dt_vigdis_ch2: {
    id: 'dt_vigdis_ch2', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᚹ — You bring word from the middle-earth, and it is dimmer word than we hoped. Look around you, friend: this is Álfheimr at noon. It should blind you. Instead you can bear it. Something drinks the light.',
        choices: [
          { id: 'c1', text: 'Hulda sent me. The threads are cut here too.', next: 'n2' },
          { id: 'c2', text: 'What drinks it?', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Then it is true, and worse than true. The beacon-shrines keep the light moving, and three of four have failed. Relight them — and when you have, you will hear what gnaws beneath the roots. It used to be a stag. It used to be holy.',
        choices: [{ id: 'c1', text: 'I will relight them. (Begin Chapter 2)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_2' }] }],
      },
      n3: {
        id: 'n3',
        text: 'The dökkálfar say it is Dáinn, the stag of the World-Tree, and they say it the way you say a fever’s name. Something fed him a severed root of Yggdrasill. He has not slept since. Neither, now, have we.',
        choices: [{ id: 'c1', text: 'Tell me what to do. (Begin Chapter 2)', next: 'n2' }],
      },
    },
  },

  dt_brokkr_ch3: {
    id: 'dt_brokkr_ch3', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᛒ — Mind the anvil. Mind the cat. Mind, most of all, the gold — half the coin in my market is Andvari’s curse wearing a crown, and the Guild will melt the whole supply to be rid of it. You look like someone who can carry heavy things without asking why.',
        choices: [
          { id: 'c1', text: 'I am hunting the Unraveling, not gold.', next: 'n2' },
          { id: 'c2', text: 'Show me your stock, smith.', next: null, effects: [{ type: 'open_shop', shopId: 'shop_brokkr' }] },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Same coin, different face. Andvari’s hoard surfaced the week the Norns went quiet — you think that is chance? The dvergr who cursed it sits on the mother-lode in the lower galleries, fatter and madder every year. Break his grip and you break two curses at once.',
        choices: [
          { id: 'c1', text: 'Where do I sign. (Begin Chapter 3)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_3' }] },
          { id: 'c2', text: 'What is the curse, exactly?', next: 'n3' },
        ],
      },
      n3: {
        id: 'n3',
        text: 'Andvaranaut’s curse is simple as a knife: the gold is yours only while you can hold it, and no one can hold it long. It buys spears and sells friends. Decide now what you would do with a mountain of it — you will be asked, down there in the dark.',
        choices: [{ id: 'c1', text: 'Noted. (Begin Chapter 3)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_3' }] }],
      },
    },
  },

  dt_skadi_ch4: {
    id: 'dt_skadi_ch4', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᛋ — Stand where I can see you. Good. You are the threadless one the seeresses gossip about. I am Skaði, and this mountain was my father’s before Þrymr’s court fattened itself on it. I want it back. You want the realm-seal in his hoard. We can be useful to each other without being friends.',
        choices: [
          { id: 'c1', text: 'Practical. I like it.', next: 'n2' },
          { id: 'c2', text: 'Why not take it yourself?', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Two roads up the mountain, threadless. The road of iron: kill his hrímþursar in the passes, kick his gate, and take the seal from his lap. The road of words: I will get you to his hall, and you will learn why "the Æsir’s embassy" is a joke the jǫtnar tell with axes. Either road ends in his throne room. Choose your footing.',
        choices: [{ id: 'c1', text: 'Iron, then. (Begin Chapter 4)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_4' }] }],
      },
      n3: {
        id: 'n3',
        text: 'Because a jǫtunn who kills a king is a usurper, and a mortal who kills a king is a story. The Free Jǫtnar need a story right now more than they need another corpse with a claim.',
        choices: [{ id: 'c1', text: 'I will be the story. (Begin Chapter 4)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_4' }] }],
      },
    },
  },

  dt_verdandi_ch5: {
    id: 'dt_verdandi_ch5', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᚢ — ...you are becoming... I am Verðandi... what remains of her... the mist takes the rest, syllable by syllable... come closer, threadless one, while I still remember that I remember...',
        choices: [
          { id: 'c1', text: 'How do I anchor you?', next: 'n2' },
          { id: 'c2', text: 'What cut the threads?', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Rimefrost. The first frost, from before memory. Gather it and the Echo holds... and when it holds, I will tell you the name the mist is trying so hard to eat...',
        choices: [{ id: 'c1', text: 'Hold on. (Begin Chapter 5)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_5' }] }],
      },
      n3: {
        id: 'n3',
        text: '...laughter... that is all I keep... laughter and the smell of the sea... gather the frost, threadless, before even the laughter goes...',
        choices: [{ id: 'c1', text: 'I will hurry. (Begin Chapter 5)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_5' }] }],
      },
    },
  },

  dt_eldrgautr_ch6: {
    id: 'dt_eldrgautr_ch6', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᛖ — Warm yourself. Not too close — I do not entirely control where I end and the fire begins these days. You have come about the oath-flame. Everyone comes about the oath-flame, eventually. It is the only thing down here older than hunger.',
        choices: [
          { id: 'c1', text: 'Logi broke the pact. Tell me how to fence the fire again.', next: 'n2' },
          { id: 'c2', text: 'What are you, priest?', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Carry the oath-flame to the three braziers — it cannot be run with, only walked, and it will call every ember-thing for a mile. Then face Logi at the third table. And think, before you arrive, on this: a fence holds a fire. It also feeds one.',
        choices: [{ id: 'c1', text: 'I will carry it. (Begin Chapter 6)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_6' }] }],
      },
      n3: {
        id: 'n3',
        text: 'I am what happens when a man outlives his errand but not his oath. The fire keeps the shape of Eldrgautr the way embers keep the shape of a log. Soon there will be only the shape. It will still hold the fence.',
        choices: [{ id: 'c1', text: 'Then let us buy you time. (Begin Chapter 6)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_6' }] }],
      },
    },
  },

  dt_byggvir_ch7: {
    id: 'dt_byggvir_ch7', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᛒ — Yes, I am small. Yes, I grind the barley for the Lord of the Vanir. No, this is not funny anymore: the groves are dying angry, threadless, and the one who could calm them is the one they burned. Three times. In Óðinn’s own hall. You would be angry too.',
        choices: [
          { id: 'c1', text: 'Gullveig. I have heard the name.', next: 'n2' },
          { id: 'c2', text: 'What does a barley-god need from me?', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'The Æsir called her gold-lust and put her to the fire. She rose. They burned her again. She rose. A third time — and she rose, and the war between the gods began, and nobody, ever, apologized. Now she is awake and the groves remember with her. Bring sap of Yggdrasill, quiet the mad trolls, and then... we will see what you are made of.',
        choices: [{ id: 'c1', text: 'I will go to the groves. (Begin Chapter 7)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_7' }] }],
      },
      n3: {
        id: 'n3',
        text: 'A strong back, a strong stomach, and — if you have one — a strong apology. The last one is the rarest. Even the gods could not grow it.',
        choices: [{ id: 'c1', text: 'I have all three. (Begin Chapter 7)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_7' }] }],
      },
    },
  },

  dt_modgudr_ch8: {
    id: 'dt_modgudr_ch8', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᛗ — Halt. State your business on Gjallarbrú. ...Breathing. That is new. The dead have been walking OUT across my bridge for nine days, living one, and the hound that should stop them is loose on the wrong side of his chain.',
        choices: [
          { id: 'c1', text: 'I will leash Garmr.', next: 'n2' },
          { id: 'c2', text: 'Why can you not leave the bridge?', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Then take the far path past the cairns, turn back the draugr column, and loose the drowned valkyries from their oath-knots — they will only slow you otherwise. And when you stand before Hel’s hall, remember: everything here is paid for. Bring something you can afford to lose.',
        choices: [{ id: 'c1', text: 'Understood. (Begin Chapter 8)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_8' }] }],
      },
      n3: {
        id: 'n3',
        text: 'Because someone must count the crossings, threadless. I have counted for three hundred years. If I step away and the count is lost, the dead are not dead anymore — they are merely elsewhere. You would not like elsewhere.',
        choices: [{ id: 'c1', text: 'Then I go in your place. (Begin Chapter 8)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_8' }] }],
      },
    },
  },

  dt_heimdallr_ch9: {
    id: 'dt_heimdallr_ch9', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'ᚺ — I can hear the grass grow, threadless one. I can hear the sap rise in Yggdrasill and the ice creep across Ginnungagap. So believe me when I say: the loudest sound in nine realms right now is Loki, laughing, inside my own house.',
        choices: [
          { id: 'c1', text: 'Why is he doing this? Truly?', next: 'n2' },
          { id: 'c2', text: 'Blow your horn. Call the Æsir.', next: 'n3' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'He did not cut the threads to end the world. He cut them to OWN the ending — to make Ragnarök a thing that happens at his word, to him, for him. Re-true the Bifröst anchors, break his siege, and take the fight to him at the heart of the hall. And threadless — whatever he offers you at the end, remember: he is bound to tell you one truth per lie. The art is knowing which is which.',
        choices: [{ id: 'c1', text: 'It ends here. (Begin Chapter 9)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_9' }] }],
      },
      n3: {
        id: 'n3',
        text: 'Gjallarhorn sounds at the doom of the gods, not at the inconvenience of them. This is not yet Ragnarök. It is only a liar in a high seat. Go and unseat him.',
        choices: [{ id: 'c1', text: 'Very well. (Begin Chapter 9)', next: null, effects: [{ type: 'start_quest', questId: 'q_main_9' }] }],
      },
    },
  },

  dt_kettil_side: {
    id: 'dt_kettil_side', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'Nine ewes I had, stranger. NINE. The wolves have the count of them better than I do, and my bell-ewe led the rest straight into the pines. You look like someone who can argue with a wolf.',
        choices: [
          { id: 'c1', text: 'I will get your bell back.', next: null, effects: [{ type: 'start_quest', questId: 'q_side_flock' }] },
          { id: 'c2', text: 'Wolves eat sheep. It is their one idea.', next: 'n2' },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Aye, and I keep sheep. It is MY one idea. Four winters of breeding in that flock, stranger. Bring back the bell and thin the pack, and Kettil pays in honest cheese and honest coin.',
        choices: [{ id: 'c1', text: 'Done. (Accept)', next: null, effects: [{ type: 'start_quest', questId: 'q_side_flock' }] }],
      },
    },
  },

  dt_eira_side: {
    id: 'dt_eira_side', startNode: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: 'Sit, before you leak on my floor. I am Eira. If it bleeds, I mend it; if it festers, I lance it; if it is beyond both, I brew for the pain. Which are you?',
        choices: [
          { id: 'c1', text: 'Just browsing, healer.', next: null, effects: [{ type: 'open_shop', shopId: 'shop_eira' }] },
          { id: 'c2', text: 'You look like you need help yourself.', next: 'n2' },
          { id: 'c3', text: 'Mend me.', next: null, effects: [{ type: 'heal' }] },
        ],
      },
      n2: {
        id: 'n2',
        text: 'Sharp eyes. My herb-stores are thin and my knees are thinner. The nine herbs of the old charm grow in the wet places — bring me six bundles and I will keep you in mead and mercy both.',
        choices: [{ id: 'c1', text: 'Six bundles. Easy. (Accept)', next: null, effects: [{ type: 'start_quest', questId: 'q_side_herbs' }] }],
      },
    },
  },
};
