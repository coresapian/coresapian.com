class_name RPGItemDefinition
extends RefCounted

## Helper to read typed RPG properties from an ItemDefinition's properties dict.

enum EquipSlot { NONE, HEAD, CHEST, LEGS, FEET, WEAPON, OFFHAND, RING, AMULET }

enum Rarity { COMMON, UNCOMMON, RARE, EPIC, LEGENDARY }

static func get_damage(def: ItemDefinition) -> float:
	if def == null: return 0.0
	return def.properties.get("damage", 0.0)

static func get_defense(def: ItemDefinition) -> float:
	if def == null: return 0.0
	return def.properties.get("defense", 0.0)

static func get_heal_amount(def: ItemDefinition) -> float:
	if def == null: return 0.0
	return def.properties.get("heal_amount", 0.0)

static func get_equip_slot(def: ItemDefinition) -> int:
	if def == null: return EquipSlot.NONE
	return def.properties.get("equip_slot", EquipSlot.NONE)

static func get_level_requirement(def: ItemDefinition) -> int:
	if def == null: return 1
	return def.properties.get("level_requirement", 1)

static func get_weight(def: ItemDefinition) -> float:
	if def == null: return 0.1
	return def.properties.get("weight", 0.1)

static func get_rarity(def: ItemDefinition) -> String:
	if def == null: return "common"
	return def.properties.get("rarity", "common")

static func is_equippable(def: ItemDefinition) -> bool:
	return get_equip_slot(def) != EquipSlot.NONE

static func is_consumable(def: ItemDefinition) -> bool:
	return def != null and def.properties.get("heal_amount", 0.0) > 0.0

static func get_equip_slot_name(slot: int) -> String:
	match slot:
		EquipSlot.HEAD: return "Head"
		EquipSlot.CHEST: return "Chest"
		EquipSlot.LEGS: return "Legs"
		EquipSlot.FEET: return "Feet"
		EquipSlot.WEAPON: return "Weapon"
		EquipSlot.OFFHAND: return "Offhand"
		EquipSlot.RING: return "Ring"
		EquipSlot.AMULET: return "Amulet"
		_: return "None"
