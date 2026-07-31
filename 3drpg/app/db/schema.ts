import {
  mysqlTable,
  varchar,
  text,
  int,
  double,
  timestamp,
} from "drizzle-orm/mysql-core";

// Server-authoritative character record. The server owns inventory/XP/equipment
// mutations (validated op/ack with `revision`); clients send intents only.
export const players = mysqlTable("players", {
  id: varchar("id", { length: 36 }).primaryKey(), // client-generated UUID (localStorage identity)
  name: varchar("name", { length: 24 }).notNull(),
  level: int("level").notNull().default(1),
  xp: int("xp").notNull().default(0),
  skillPoints: int("skill_points").notNull().default(0),
  skillsJson: text("skills_json").notNull(), // JSON: Record<skillId, rank>
  inventoryJson: text("inventory_json").notNull(), // JSON: ItemInstance[]
  equipmentJson: text("equipment_json").notNull(), // JSON: Equipment slots
  realm: varchar("realm", { length: 24 }).notNull().default("midgard"),
  posX: double("pos_x").notNull().default(0),
  posY: double("pos_y").notNull().default(0),
  posZ: double("pos_z").notNull().default(0),
  revision: int("revision").notNull().default(0), // inventory/XP op-ack revision
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
