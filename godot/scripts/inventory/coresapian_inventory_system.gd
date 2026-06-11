@tool
class_name CoresapianInventorySystem
extends CharacterInventorySystem

## Server-authoritative inventory system for Coresapian.
## Clients send action requests via @rpc("any_peer") to the server.
## Server validates, mutates state, Sync* nodes broadcast changes.
## Follows the NetworkedCharacterInventorySystem pattern from the addon.

const DROPPED_ITEM_3D_PATH := "res://addons/inventory-system-demos/fps/dropped_items/dropped_item.tscn"

var _database: InventoryDatabase


func _ready():
	if Engine.is_editor_hint():
		return

	# Load the item database
	_database = load("res://resources/items/database.tres") as InventoryDatabase

	# The base class _ready() connects mouse signals and activates hotbar slots 0-1.
	# We need to override the mouse signal wiring and activate all 8 hotbar slots.
	super._ready()

	# Disconnect base class mouse-state connections so our _check_inputs override is used.
	if change_mouse_state:
		if opened_inventory.is_connected(_update_opened_inventories):
			opened_inventory.disconnect(_update_opened_inventories)
		if closed_inventory.is_connected(_update_opened_inventories):
			closed_inventory.disconnect(_update_opened_inventories)
		if opened_station.is_connected(_update_opened_stations):
			opened_station.disconnect(_update_opened_stations)
		if closed_station.is_connected(_update_opened_stations):
			closed_station.disconnect(_update_opened_stations)

	# Reconnect with our own _check_inputs override
	if is_multiplayer_authority():
		opened_inventory.connect(_update_opened_inventories)
		closed_inventory.connect(_update_opened_inventories)
		opened_station.connect(_update_opened_stations)
		closed_station.connect(_update_opened_stations)
		_update_opened_inventories(main_inventory)
	else:
		picked.connect(_on_picked)

	# Activate all 8 hotbar slots (base only does 0-1)
	if hotbar:
		for i in range(8):
			hotbar.active_slot(i)

	# Wire drop signal to spawn DroppedItem3D scenes
	if main_inventory:
		if not main_inventory.request_drop_item.is_connected(_on_request_drop_item):
			main_inventory.request_drop_item.connect(_on_request_drop_item)
	if equipment_inventory:
		if not equipment_inventory.request_drop_item.is_connected(_on_request_drop_item):
			equipment_inventory.request_drop_item.connect(_on_request_drop_item)


func _on_picked(obj: Node):
	picked_rpc.rpc(obj.get_path())


# ── Input overrides ─────────────────────────────────────────

func _check_inputs():
	if is_any_station_or_inventory_opened():
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	else:
		if not OS.has_feature("web"):
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
	if not can_interact:
		return
	if interactor and is_multiplayer_authority():
		interactor.try_interact()


# ── Open / Close inventories ────────────────────────────────

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


# ── Open / Close craft stations ─────────────────────────────

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


# ── Picking up items ────────────────────────────────────────

func pick_to_inventory(node: Node):
	if multiplayer.is_server():
		super.pick_to_inventory(node)
	else:
		pick_to_inventory_rpc.rpc_id(1, node.get_path())


# ── Transfer / Split / Sort / Drop / Equip / Rotate ─────────

func transfer_to(inventory: GridInventory, origin_pos: Vector2i, destination: GridInventory, destination_pos: Vector2i, amount: int, is_rotated: bool):
	if multiplayer.is_server():
		super.transfer_to(inventory, origin_pos, destination, destination_pos, amount, is_rotated)
	else:
		transfer_to_rpc.rpc_id(1, inventory.get_path(), origin_pos, destination.get_path(), destination_pos, amount, is_rotated)


func rotate(stack: ItemStack, inventory: Inventory):
	if multiplayer.is_server():
		super.rotate(stack, inventory)
	else:
		var stack_index = inventory.stacks.find(stack)
		if stack_index != -1:
			rotate_rpc.rpc_id(1, stack_index, inventory.get_path())


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
		var stack_index = inventory.stacks.find(stack)
		if stack_index != -1:
			drop_rpc.rpc_id(1, stack_index, inventory.get_path())


func equip(stack: ItemStack, inventory: Inventory, slot_index: int):
	if multiplayer.is_server():
		super.equip(stack, inventory, slot_index)
	else:
		var stack_index = inventory.stacks.find(stack)
		if stack_index != -1:
			equip_rpc.rpc_id(1, stack_index, inventory.get_path(), slot_index)


# ── Crafting ────────────────────────────────────────────────

func craft(craft_station: CraftStation, recipe_index: int):
	if multiplayer.is_server():
		craft_rpc(craft_station.get_path(), recipe_index)
	else:
		craft_rpc.rpc(craft_station.get_path(), recipe_index)


# ── Hotbar ──────────────────────────────────────────────────

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


# ── Drop spawning ───────────────────────────────────────────

func _on_request_drop_item(item: String, amount: int, properties: Dictionary):
	if not multiplayer.is_server():
		return
	var def = _database.get_item(item)
	if def == null:
		return
	var dropped_item_prop_name = "dropped_item"
	if not def.properties.has(dropped_item_prop_name):
		return
	var dropped_item_path = def.properties[dropped_item_prop_name]
	if dropped_item_path == null:
		return
	var packed_scene: PackedScene = load(dropped_item_path)
	if packed_scene == null:
		return
	var node = packed_scene.instantiate()
	get_parent().get_parent().add_child(node)
	node.set("item_id", item)
	node.set("amount", amount)
	node.set("item_properties", properties)
	node.position = global_position
	node.set("rotation", global_rotation)


# ── RPCs (server-side execution) ────────────────────────────

@rpc("any_peer")
func picked_rpc(obj_path: NodePath):
	var obj = get_node_or_null(obj_path)
	if obj:
		picked.emit(obj)


@rpc("any_peer")
func open_main_inventory_rpc():
	super.open_main_inventory()


@rpc
func open_inventory_rpc(inventory_path: NodePath):
	var inventory = get_node_or_null(inventory_path)
	if inventory:
		super.open_inventory(inventory)


@rpc("any_peer")
func add_open_inventory_rpc(inventory_path: NodePath):
	var inventory = get_node_or_null(inventory_path)
	if inventory:
		super.add_open_inventory(inventory)


@rpc("any_peer")
func remove_open_inventory_rpc(inventory_path: NodePath):
	var inventory = get_node_or_null(inventory_path)
	if inventory:
		super.remove_open_inventory(inventory)


@rpc
func close_inventories_rpc():
	if multiplayer.is_server():
		super.close_inventories()


@rpc
func pick_to_inventory_rpc(node_path: NodePath):
	var node = get_node_or_null(node_path)
	if node:
		super.pick_to_inventory(node)


@rpc
func transfer_to_rpc(inventory_path: NodePath, origin_pos: Vector2i, destination_path: NodePath, destination_pos: Vector2i, amount: int, is_rotated: bool):
	var inv = get_node_or_null(inventory_path)
	var dest = get_node_or_null(destination_path)
	if inv and dest:
		super.transfer_to(inv, origin_pos, dest, destination_pos, amount, is_rotated)


@rpc
func split_rpc(inventory_path: NodePath, stack_index: int, amount: int):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.split(inv, stack_index, amount)


@rpc
func rotate_rpc(stack_index: int, inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		super.rotate(inv.stacks[stack_index], inv)


@rpc
func sort_rpc(inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv:
		super.sort(inv)


@rpc
func drop_rpc(stack_index: int, inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		super.drop(inv.stacks[stack_index], inv)


@rpc
func equip_rpc(stack_index: int, inventory_path: NodePath, slot_index: int):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		super.equip(inv.stacks[stack_index], inv, slot_index)


@rpc
func hotbar_change_selection_rpc(selection_index: int):
	if not multiplayer.is_server():
		return
	super.hotbar_change_selection(selection_index)


@rpc
func hotbar_previous_item_rpc():
	if not multiplayer.is_server():
		return
	super.hotbar_previous_item()


@rpc
func hotbar_next_item_rpc():
	if not multiplayer.is_server():
		return
	super.hotbar_next_item()


@rpc
func open_main_craft_station_rpc():
	super.open_main_craft_station()


@rpc
func close_stations_rpc():
	if multiplayer.is_server():
		super.close_craft_stations()


@rpc
func craft_rpc(craft_station_path: NodePath, recipe_index: int):
	var station = get_node_or_null(craft_station_path)
	if station:
		station.craft(recipe_index)
