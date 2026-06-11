extends Node3D

## Loot chest with its own GridInventory that can be opened by the player.

@export var is_opened: bool = false
var inventory: GridInventory


func _ready():
	inventory = $Inventory
	# Add test items directly (LootGenerator requires editor-only resources)
	if inventory:
		inventory.add("health_potion", 3)
		inventory.add("iron_ore", 5)
		inventory.add("bread", 2)


func get_interact_actions(_interactor) -> Array:
	var action = InteractAction.new()
	action.code = 0
	action.input = "interact"
	action.description = "Open Chest" if not is_opened else "Close Chest"
	return [action]


func interact(character, _action_index):
	var inv_system = character.get_node_or_null("CharacterInventorySystem")
	if inv_system:
		if not is_opened:
			is_opened = true
			inv_system.open_inventory(inventory)
		else:
			is_opened = false
			inv_system.remove_open_inventory(inventory)
