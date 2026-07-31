// ============================================================================
// api/queries/players.ts — typed Drizzle queries for the players table.
// Server-authoritative character persistence (contracts/netcode.ts §Inventory).
//
// PACKING NOTE (db/schema.ts is frozen and has no dedicated columns for gold,
// runeLoadout, realmAbilities, quests or factions): those ride inside the two
// existing JSON text columns with a versioned envelope. Readers accept both
// the envelope and the legacy plain shapes described by the column comments
// (ItemInstance[] / Record<skillId, rank>) so old rows still load.
// ============================================================================

import { eq } from "drizzle-orm";
import { players, type PlayerRow } from "@db/schema";
import { getDb } from "./connection";
import type { Equipment, ItemInstance, QuestState, RealmId, RuneLoadout, Vec3 } from "@contracts/types";
import { EQUIP_SLOTS } from "@contracts/types";
import { REALMS, HOME_REALM } from "@contracts/realms";
import type { InventorySnapshot, ProgressionSnapshot } from "@contracts/netcode";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Everything the gateway needs to hydrate a session (and welcome msg). */
export interface StoredCharacter {
  playerId: string;
  name: string;
  revision: number;
  inventory: InventorySnapshot;
  progression: ProgressionSnapshot;
  realm: RealmId;
  position: Vec3;
}

const EMPTY_RUNES: RuneLoadout = [null, null, null, null];

function emptyEquipment(): Equipment {
  return Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as Equipment;
}

// ---------------------------------------------------------------------------
// JSON column packing (versioned envelope, legacy-tolerant reads)
// ---------------------------------------------------------------------------

interface InventoryEnvelope {
  v: 1;
  gold: number;
  items: ItemInstance[];
  runeLoadout: RuneLoadout;
}

interface ProgressionEnvelope {
  v: 1;
  skills: Record<string, number>;
  realmAbilities: string[];
  quests: Record<string, QuestState>;
  factions: Record<string, number>;
}

function packInventory(inv: InventorySnapshot): string {
  const env: InventoryEnvelope = {
    v: 1,
    gold: inv.gold,
    items: inv.items,
    runeLoadout: inv.runeLoadout,
  };
  return JSON.stringify(env);
}

function unpackInventory(json: string): { gold: number; items: ItemInstance[]; runeLoadout: RuneLoadout } {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      // Legacy plain shape: ItemInstance[]
      return { gold: 0, items: parsed as ItemInstance[], runeLoadout: [...EMPTY_RUNES] };
    }
    const env = parsed as Partial<InventoryEnvelope>;
    return {
      gold: typeof env.gold === "number" ? env.gold : 0,
      items: Array.isArray(env.items) ? env.items : [],
      runeLoadout: Array.isArray(env.runeLoadout) ? (env.runeLoadout as RuneLoadout) : [...EMPTY_RUNES],
    };
  } catch {
    return { gold: 0, items: [], runeLoadout: [...EMPTY_RUNES] };
  }
}

function packProgression(p: ProgressionSnapshot): string {
  const env: ProgressionEnvelope = {
    v: 1,
    skills: p.skills,
    realmAbilities: p.realmAbilities,
    quests: p.quests,
    factions: p.factions,
  };
  return JSON.stringify(env);
}

function unpackProgression(json: string): Omit<ProgressionSnapshot, "xp" | "level" | "skillPoints"> {
  const empty = { skills: {}, realmAbilities: [], quests: {}, factions: {} };
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && "skills" in (parsed as object)) {
      const env = parsed as Partial<ProgressionEnvelope>;
      return {
        skills: env.skills ?? {},
        realmAbilities: Array.isArray(env.realmAbilities) ? env.realmAbilities : [],
        quests: env.quests ?? {},
        factions: env.factions ?? {},
      };
    }
    // Legacy plain shape: Record<skillId, rank>
    if (parsed && typeof parsed === "object" && Object.values(parsed).every((v) => typeof v === "number")) {
      return { ...empty, skills: parsed as Record<string, number> };
    }
    return empty;
  } catch {
    return empty;
  }
}

function unpackEquipment(json: string): Equipment {
  try {
    const parsed = JSON.parse(json) as Equipment;
    if (parsed && typeof parsed === "object") {
      // Fill any missing slots with null so all 9 keys exist.
      return { ...emptyEquipment(), ...parsed };
    }
  } catch {
    /* fall through */
  }
  return emptyEquipment();
}

// ---------------------------------------------------------------------------
// Row <-> character mapping
// ---------------------------------------------------------------------------

function rowToCharacter(row: PlayerRow): StoredCharacter {
  const inv = unpackInventory(row.inventoryJson);
  const prog = unpackProgression(row.skillsJson);
  return {
    playerId: row.id,
    name: row.name,
    revision: row.revision,
    inventory: {
      revision: row.revision,
      gold: inv.gold,
      items: inv.items,
      equipment: unpackEquipment(row.equipmentJson),
      runeLoadout: inv.runeLoadout,
    },
    progression: {
      xp: row.xp,
      level: row.level,
      skillPoints: row.skillPoints,
      skills: prog.skills,
      realmAbilities: prog.realmAbilities,
      quests: prog.quests,
      factions: prog.factions,
    },
    realm: (REALMS[row.realm as RealmId] ? row.realm : HOME_REALM) as RealmId,
    position: { x: row.posX, y: row.posY, z: row.posZ },
  };
}

function starterItems(): { items: ItemInstance[]; equipment: Equipment } {
  // Fresh identities get a tier-1 kit so the server-authoritative economy is
  // usable from first spawn (the protocol has no "grant" op, so starter gear
  // can only come from the server itself).
  const weapon: ItemInstance = { instanceId: crypto.randomUUID(), itemId: "wpn_seax", qty: 1, upgradeLevel: 0 };
  const shield: ItemInstance = { instanceId: crypto.randomUUID(), itemId: "shd_linden", qty: 1, upgradeLevel: 0 };
  const items: ItemInstance[] = [
    { instanceId: crypto.randomUUID(), itemId: "con_mead_s", qty: 2, upgradeLevel: 0 },
    { instanceId: crypto.randomUUID(), itemId: "con_rations", qty: 2, upgradeLevel: 0 },
    { instanceId: crypto.randomUUID(), itemId: "mat_iron", qty: 2, upgradeLevel: 0 },
    { instanceId: crypto.randomUUID(), itemId: "mat_ash", qty: 1, upgradeLevel: 0 },
    { instanceId: crypto.randomUUID(), itemId: "mat_wood", qty: 3, upgradeLevel: 0 },
    { instanceId: crypto.randomUUID(), itemId: "mat_herb", qty: 2, upgradeLevel: 0 },
  ];
  const equipment = emptyEquipment();
  equipment.weapon = weapon;
  equipment.shield = shield;
  return { items, equipment };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Load a character by playerId, creating a fresh record on first sight. */
export async function loadOrCreatePlayer(playerId: string, name: string): Promise<StoredCharacter> {
  const db = getDb();
  const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const row = rows[0];
  if (row) {
    if (row.name !== name) {
      await db.update(players).set({ name }).where(eq(players.id, playerId));
      row.name = name;
    }
    return rowToCharacter(row);
  }

  const spawn = REALMS[HOME_REALM].spawnOffset;
  const { items, equipment } = starterItems();
  const character: StoredCharacter = {
    playerId,
    name,
    revision: 0,
    inventory: { revision: 0, gold: 25, items, equipment, runeLoadout: [...EMPTY_RUNES] },
    progression: { xp: 0, level: 1, skillPoints: 0, skills: {}, realmAbilities: [], quests: {}, factions: {} },
    realm: HOME_REALM,
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
  };
  await db.insert(players).values({
    id: playerId,
    name,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skillsJson: packProgression(character.progression),
    inventoryJson: packInventory(character.inventory),
    equipmentJson: JSON.stringify(equipment),
    realm: HOME_REALM,
    posX: spawn.x,
    posY: spawn.y,
    posZ: spawn.z,
    revision: 0,
  });
  return character;
}

/** Fetch without creating (tRPC debug endpoint). */
export async function loadPlayer(playerId: string): Promise<StoredCharacter | null> {
  const db = getDb();
  const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  return rows[0] ? rowToCharacter(rows[0]) : null;
}

/** Persisted on EVERY inventory mutation (invack path). */
export async function saveInventory(playerId: string, inv: InventorySnapshot): Promise<void> {
  const db = getDb();
  await db
    .update(players)
    .set({
      inventoryJson: packInventory(inv),
      equipmentJson: JSON.stringify(inv.equipment),
      revision: inv.revision,
    })
    .where(eq(players.id, playerId));
}

/** Progression writes are debounced (30s) + flushed on disconnect. */
export async function saveProgression(playerId: string, p: ProgressionSnapshot): Promise<void> {
  const db = getDb();
  await db
    .update(players)
    .set({
      level: p.level,
      xp: p.xp,
      skillPoints: p.skillPoints,
      skillsJson: packProgression(p),
    })
    .where(eq(players.id, playerId));
}

/** Position writes are debounced (30s) + flushed on disconnect. */
export async function savePosition(playerId: string, realm: RealmId, position: Vec3): Promise<void> {
  const db = getDb();
  await db
    .update(players)
    .set({ realm, posX: position.x, posY: position.y, posZ: position.z })
    .where(eq(players.id, playerId));
}
