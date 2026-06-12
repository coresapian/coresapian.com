@tool
class_name CoresapianInventorySystem
extends CharacterInventorySystem

## Server-authoritative inventory for Coresapian.
## Clients request actions via RPC; server validates and mutates.
## Sync* nodes broadcast state changes.

const DROPPED_ITEM_3D_PATH := "res://scenes/items/dropped_item.tscn"

var _database: InventoryDatabase

func _ready():
	if Engine.is_editor_hint():
		return

	_database = load("res://resources/items/database.tres") as InventoryDatabase

	# Headless server: init node refs + hotbar slots, skip UI/input signals
	if DisplayServer.get_name() == "":
		main_inventory = get_node_or_null(main_inventory_path)
		equipment_inventory = get_node_or_null(equipment_inventory_path)
		hotbar = get_node_or_null(hotbar_path)
		_activate_hotbar()
		return

	super._ready()

	# Wire drop signals to spawn DroppedItem scenes
	if main_inventory and not main_inventory.request_drop_item.is_connected(_on_request_drop_item):
		main_inventory.request_drop_item.connect(_on_request_drop_item)
	if equipment_inventory and not equipment_inventory.request_drop_item.is_connected(_on_request_drop_item):
		equipment_inventory.request_drop_item.connect(_on_request_drop_item)

func _activate_hotbar() -> void:
	if hotbar:
		for i in range(8):
			hotbar.active_slot(i)

func _check_inputs():
	if is_any_station_or_inventory_opened():
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif not OS.has_feature("web"):
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _input(event: InputEvent):
	if Engine.is_editor_hint():
		return
	if check_inputs and is_multiplayer_authority():
		hot_bar_inputs(event)
		inventory_inputs()

func _physics_process(_delta: float):
	if Engine.is_editor_hint():
		return
	if can_interact and interactor and is_multiplayer_authority():
		interactor.try_interact()

# ── Open / Close ─────────────────────────────────────────────

func open_main_inventory():
	if multiplayer.is_server():
		super.open_main_inventory()
	else:
		open_main_inventory_rpc.rpc_id(1)

func open_inventory(inventory: Inventory):
	if multiplayer.is_server():
		super.open_inventory(inventory)
	else:
		open_inventory_rpc.rpc_id(1, inventory.get_path())

func add_open_inventory(inventory: Inventory):
	if multiplayer.is_server():
		add_open_inventory_rpc.rpc(inventory.get_path())
	super.add_open_inventory(inventory)

func remove_open_inventory(inventory: Inventory):
	if multiplayer.is_server():
		remove_open_inventory_rpc.rpc(inventory.get_path())
	super.remove_open_inventory(inventory)

func close_inventories():
	if multiplayer.is_server():
		super.close_inventories()
	else:
		close_inventories_rpc.rpc_id(1)

func open_main_craft_station():
	if multiplayer.is_server():
		super.open_main_craft_station()
	else:
		open_main_craft_station_rpc.rpc_id(1)

func close_craft_stations():
	if multiplayer.is_server():
		super.close_craft_stations()
	else:
		close_stations_rpc.rpc_id(1)

# ── Pick / Transfer / Split / Sort / Drop / Equip / Rotate ───

func pick_to_inventory(node: Node):
	if multiplayer.is_server():
		super.pick_to_inventory(node)
	else:
		pick_to_inventory_rpc.rpc_id(1, node.get_path())

func transfer(inventory: GridInventory, origin_pos: Vector2i, destination: GridInventory, amount: int):
	if multiplayer.is_server():
		super.transfer(inventory, origin_pos, destination, amount)
	else:
		transfer_rpc.rpc_id(1, inventory.get_path(), origin_pos, destination.get_path(), amount)

func transfer_to(inventory: GridInventory, origin_pos: Vector2i, destination: GridInventory, destination_pos: Vector2i, amount: int, is_rotated: bool):
	if multiplayer.is_server():
		super.transfer_to(inventory, origin_pos, destination, destination_pos, amount, is_rotated)
	else:
		transfer_to_rpc.rpc_id(1, inventory.get_path(), origin_pos, destination.get_path(), destination_pos, amount, is_rotated)

func rotate(stack: ItemStack, inventory: Inventory):
	if multiplayer.is_server():
		super.rotate(stack, inventory)
	else:
		var idx = inventory.stacks.find(stack)
		if idx != -1:
			rotate_rpc.rpc_id(1, idx, inventory.get_path())

func split(inventory: Inventory, stack_index: int, amount: int):
	if multiplayer.is_server():
		super.split(inventory, stack_index, amount)
	else:
		split_rpc.rpc_id(1, inventory.get_path(), stack_index, amount)

func sort(inventory: Inventory):
	if multiplayer.is_server():
		super.sort(inventory)
	else:
		sort_rpc.rpc_id(1, inventory.get_path())

func drop(stack: ItemStack, inventory: Inventory):
	if multiplayer.is_server():
		super.drop(stack, inventory)
	else:
		var idx = inventory.stacks.find(stack)
		if idx != -1:
			drop_rpc.rpc_id(1, idx, inventory.get_path())

func equip(stack: ItemStack, inventory: Inventory, slot_index: int):
	if multiplayer.is_server():
		super.equip(stack, inventory, slot_index)
	else:
		var idx = inventory.stacks.find(stack)
		if idx != -1:
			equip_rpc.rpc_id(1, idx, inventory.get_path(), slot_index)

func craft(craft_station: CraftStation, recipe_index: int):
	if multiplayer.is_server():
		super.craft(craft_station, recipe_index)
	else:
		craft_rpc.rpc_id(1, craft_station.get_path(), recipe_index)

# ── Hotbar ───────────────────────────────────────────────────

func hotbar_change_selection(index: int):
	if multiplayer.is_server():
		super.hotbar_change_selection(index)
	else:
		hotbar_change_selection_rpc.rpc_id(1, index)

func hotbar_previous_item():
	if multiplayer.is_server():
		super.hotbar_previous_item()
	else:
		hotbar_previous_item_rpc.rpc_id(1)

func hotbar_next_item():
	if multiplayer.is_server():
		super.hotbar_next_item()
	else:
		hotbar_next_item_rpc.rpc_id(1)

# ── Drop spawning ────────────────────────────────────────────

func _on_request_drop_item(item: String, amount: int, properties: Dictionary):
	if not multiplayer.is_server():
		return
	var path := DROPPED_ITEM_3D_PATH
	var def = _database.get_item(item) if _database else null
	if def and def.properties.has("dropped_item") and def.properties["dropped_item"]:
		path = def.properties["dropped_item"]
	var scene: PackedScene = load(path)
	if not scene:
		return
	var node = scene.instantiate()
	get_parent().get_parent().add_child(node)
	node.set("item_id", item)
	node.set("amount", amount)
	node.set("item_properties", properties)
	var player = get_parent() as Node3D
	if player:
		node.global_position = player.global_position + (-player.global_basis.z * 1.5)
		node.position.y += 0.5
	else:
		node.set("position", Vector3(0, 0.5, 0))

# ── RPCs ─────────────────────────────────────────────────────

@rpc("any_peer")
func open_main_inventory_rpc():
	super.open_main_inventory()

@rpc("any_peer")
func open_inventory_rpc(inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.open_inventory(inv)

@rpc("any_peer")
func add_open_inventory_rpc(inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.add_open_inventory(inv)

@rpc("any_peer")
func remove_open_inventory_rpc(inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.remove_open_inventory(inv)

@rpc("any_peer")
func close_inventories_rpc():
	super.close_inventories()

@rpc("any_peer")
func pick_to_inventory_rpc(node_path: NodePath):
	var node = get_node_or_null(node_path)
	if node:
		super.pick_to_inventory(node)

@rpc("any_peer")
func transfer_rpc(inventory_path: NodePath, origin_pos: Vector2i, destination_path: NodePath, amount: int):
	var inv = get_node_or_null(inventory_path)
	var dest = get_node_or_null(destination_path)
	if inv and dest:
		super.transfer(inv, origin_pos, dest, amount)

@rpc("any_peer")
func transfer_to_rpc(inventory_path: NodePath, origin_pos: Vector2i, destination_path: NodePath, destination_pos: Vector2i, amount: int, is_rotated: bool):
	var inv = get_node_or_null(inventory_path)
	var dest = get_node_or_null(destination_path)
	if inv and dest:
		super.transfer_to(inv, origin_pos, dest, destination_pos, amount, is_rotated)

@rpc("any_peer")
func split_rpc(inventory_path: NodePath, stack_index: int, amount: int):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.split(inv, stack_index, amount)

@rpc("any_peer")
func rotate_rpc(stack_index: int, inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		super.rotate(inv.stacks[stack_index], inv)

@rpc("any_peer")
func sort_rpc(inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.sort(inv)

@rpc("any_peer")
func drop_rpc(stack_index: int, inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		super.drop(inv.stacks[stack_index], inv)

@rpc("any_peer")
func equip_rpc(stack_index: int, inventory_path: NodePath, slot_index: int):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		super.equip(inv.stacks[stack_index], inv, slot_index)

@rpc("any_peer")
func hotbar_change_selection_rpc(selection_index: int):
	super.hotbar_change_selection(selection_index)

@rpc("any_peer")
func hotbar_previous_item_rpc():
	super.hotbar_previous_item()

@rpc("any_peer")
func hotbar_next_item_rpc():
	super.hotbar_next_item()

@rpc("any_peer")
func open_main_craft_station_rpc():
	super.open_main_craft_station()

@rpc("any_peer")
func close_stations_rpc():
	super.close_craft_stations()

@rpc("any_peer")
func craft_rpc(craft_station_path: NodePath, recipe_index: int):
	var station = get_node_or_null(craft_station_path)
	if station:
		station.craft(recipe_index)
