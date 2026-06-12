extends StaticBody3D

## Loot chest with its own GridInventory. Opens on interact.

@export var is_opened: bool = false
var inventory: GridInventory

func _ready():
	inventory = $Inventory
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

func interact(character: Node, _action_index):
	if not character or not character.has_method("open_inventory"):
		return
	if not is_opened:
		is_opened = true
		character.open_inventory(inventory)
	else:
		is_opened = false
		character.remove_open_inventory(inventory)
