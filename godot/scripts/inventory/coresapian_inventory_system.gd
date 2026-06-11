@tool
class_name CoresapianInventorySystem
extends NodeInventories

## Server-authoritative inventory system for Coresapian.
## Clients send action requests via @rpc("any_peer") to the server.
## Server validates, mutates state, Sync* nodes broadcast changes.
## Adapted from ExpressoBits' NetworkedCharacterInventorySystem.

signal opened_station(station: CraftStation)
signal closed_station(station: CraftStation)
signal opened_inventory(inventory: Inventory)
signal closed_inventory(inventory: Inventory)
signal picked(obj: Node)

@export_group("Inventory Nodes")
@export_node_path var main_inventory_path := NodePath("Inventory")
@onready var main_inventory: GridInventory = get_node_or_null(main_inventory_path)

@export_node_path var equipment_inventory_path := NodePath("EquipmentInventory")
@onready var equipment_inventory: GridInventory = get_node_or_null(equipment_inventory_path)

@export_node_path("Hotbar") var hotbar_path := NodePath("Hotbar")
@onready var hotbar: Hotbar = get_node_or_null(hotbar_path)

@export_node_path("CraftStation") var main_station_path := NodePath("CraftStation")
@onready var main_station: CraftStation = get_node_or_null(main_station_path)

@export_node_path var interactor_path := NodePath("Interactor")
@onready var interactor: Node = get_node_or_null(interactor_path)

@export_group("Inputs")
@export var change_mouse_state: bool = true
@export var check_inputs: bool = true
@export var toggle_inventory_input: String = "toggle_inventory"
@export var exit_inventory_and_craft_panel_input: String = "escape"
@export var toggle_craft_panel_input: String = "toggle_craft_panel"

@export_group("Interact")
@export var can_interact: bool = true
@export var raycast: RayCast3D:
	set(value):
		raycast = value
@export var camera_3d: Camera3D:
	set(value):
		camera_3d = value

var opened_stations: Array[CraftStation]
var opened_inventories: Array[Inventory]

var _database: InventoryDatabase

func _ready():
	if Engine.is_editor_hint():
		return
	
	# Load the item database
	_database = load("res://resources/items/database.tres") as InventoryDatabase
	
	if is_multiplayer_authority():
		opened_inventory.connect(_update_opened_inventories)
		closed_inventory.connect(_update_opened_inventories)
		opened_station.connect(_update_opened_stations)
		closed_station.connect(_update_opened_stations)
		_update_opened_inventories(main_inventory)
	else:
		picked.connect(_on_picked)
	
	if hotbar:
		hotbar.active_slot(0)
		hotbar.active_slot(1)

func _on_picked(obj: Node):
	picked_rpc.rpc(obj.get_path())

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

# ── Inventory management ────────────────────────────────────

func is_any_station_or_inventory_opened() -> bool:
	return is_open_any_station() or is_open_main_inventory()

func _update_opened_inventories(_inventory: Inventory):
	_check_inputs()

func _update_opened_stations(_craft_station: CraftStation):
	if _craft_station:
		_craft_station.load_valid_recipes()
	_check_inputs()

func _check_inputs():
	if is_any_station_or_inventory_opened():
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	else:
		if not OS.has_feature("web"):
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func inventory_inputs():
	if Input.is_action_just_released(toggle_inventory_input):
		if not is_any_station_or_inventory_opened():
			open_main_inventory()
	if Input.is_action_just_released(exit_inventory_and_craft_panel_input):
		close_inventories()
		close_craft_stations()
	if Input.is_action_just_released(toggle_craft_panel_input):
		if not is_any_station_or_inventory_opened():
			open_main_craft_station()

# ── Picking up items ────────────────────────────────────────

func pick_to_inventory(node: Node):
	if main_inventory == null or node == null:
		return
	if !node.get("is_pickable"):
		return
	var item_id = node.item_id
	var item_properties = node.item_properties
	var amount = node.amount
	if main_inventory.add(item_id, amount, item_properties, true) == 0:
		picked.emit(node)
		node.queue_free()
		return
	push_warning("pick_to_inventory: could not add item")

# ── Transfer / Split / Drop ─────────────────────────────────

func transfer(inventory: GridInventory, origin_pos: Vector2i, destination: GridInventory, amount: int):
	var stack_index = inventory.get_stack_index_at(origin_pos)
	if stack_index == -1:
		return
	inventory.transfer(stack_index, destination, amount)

func transfer_to(inventory: GridInventory, origin_pos: Vector2i, destination: GridInventory, destination_pos: Vector2i, amount: int, is_rotated: bool):
	if multiplayer.is_server():
		inventory.transfer_to(origin_pos, destination, destination_pos, amount, is_rotated)
	else:
		transfer_to_rpc.rpc_id(1, inventory.get_path(), origin_pos, destination.get_path(), destination_pos, amount, is_rotated)

func split(inventory: Inventory, stack_index: int, amount: int):
	if multiplayer.is_server():
		inventory.split(stack_index, amount)
	else:
		split_rpc.rpc_id(1, inventory.get_path(), stack_index, amount)

func sort(inventory: Inventory):
	if multiplayer.is_server():
		inventory.sort()
	else:
		sort_rpc.rpc_id(1, inventory.get_path())

func drop(stack: ItemStack, inventory: Inventory):
	if multiplayer.is_server():
		var stack_index = inventory.stacks.find(stack)
		if stack_index == -1:
			return
		inventory.drop_from_inventory(stack_index, stack.amount, stack.properties)
	else:
		var stack_index = inventory.stacks.find(stack)
		if stack_index != -1:
			drop_rpc.rpc_id(1, stack_index, inventory.get_path())

func equip(stack: ItemStack, _inventory: Inventory, slot_index: int):
	if multiplayer.is_server():
		hotbar.equip(stack, slot_index)
	else:
		var stack_index = _inventory.stacks.find(stack)
		if stack_index != -1:
			equip_rpc.rpc_id(1, stack_index, _inventory.get_path(), slot_index)

func rotate(stack: ItemStack, inventory: Inventory):
	if multiplayer.is_server():
		inventory.rotate(stack)
	else:
		var stack_index = inventory.stacks.find(stack)
		if stack_index != -1:
			rotate_rpc.rpc_id(1, stack_index, inventory.get_path())

func drop_all_items():
	if main_inventory:
		main_inventory.drop_all_stacks()
	if equipment_inventory:
		equipment_inventory.drop_all_stacks()

# ── Crafting ────────────────────────────────────────────────

func craft(craft_station: CraftStation, recipe_index: int):
	if multiplayer.is_server():
		craft_station.craft(recipe_index)
	else:
		craft_rpc.rpc(craft_station.get_path(), recipe_index)

# ── Hotbar ──────────────────────────────────────────────────

func hot_bar_inputs(event: InputEvent):
	if event is InputEventMouseButton:
		if event.is_pressed():
			if event.button_index == MOUSE_BUTTON_WHEEL_UP:
				hotbar_previous_item()
			if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				hotbar_next_item()
	if event is InputEventKey:
		var input_key_event = event as InputEventKey
		if event.is_pressed() and not event.is_echo():
			if input_key_event.keycode > KEY_0 and input_key_event.keycode < KEY_9:
				hotbar_change_selection(input_key_event.keycode - KEY_1)

func hotbar_change_selection(index: int):
	if multiplayer.is_server():
		if hotbar.selection_index == index:
			index = -1
		hotbar.selection_index = index
	else:
		hotbar_change_selection_rpc.rpc_id(1, index)

func hotbar_previous_item():
	if multiplayer.is_server():
		hotbar.previous_item()
	else:
		hotbar_previous_item_rpc.rpc_id(1)

func hotbar_next_item():
	if multiplayer.is_server():
		hotbar.next_item()
	else:
		hotbar_next_item_rpc.rpc_id(1)

# ── Open / Close inventories ────────────────────────────────

func open_main_inventory():
	if multiplayer.is_server():
		open_inventory(main_inventory)
	else:
		open_main_inventory_rpc.rpc_id(1)

func open_inventory(inventory: Inventory):
	if multiplayer.is_server():
		if is_open_inventory(inventory):
			return
		add_open_inventory(inventory)
	else:
		open_inventory_rpc.rpc_id(1, inventory.get_path())

func add_open_inventory(inventory: Inventory):
	if multiplayer.is_server():
		add_open_inventory_rpc.rpc(inventory.get_path())
	super_add_open_inventory(inventory)

func super_add_open_inventory(inventory: Inventory):
	opened_inventories.append(inventory)
	opened_inventory.emit(inventory)
	if not is_open_main_inventory():
		open_main_inventory()

func remove_open_inventory(inventory: Inventory):
	if multiplayer.is_server():
		remove_open_inventory_rpc.rpc(inventory.get_path())
	var index = opened_inventories.find(inventory)
	if index != -1:
		opened_inventories.remove_at(index)
		closed_inventory.emit(inventory)

func close_inventory(inventory: Inventory):
	if main_inventory != inventory:
		inventory.get_parent().close(get_parent())
	remove_open_inventory(inventory)

func close_inventories():
	if multiplayer.is_server():
		for index in range(opened_inventories.size() - 1, -1, -1):
			close_inventory(opened_inventories[index])
	else:
		close_inventories_rpc.rpc_id(1)

func is_open_inventory(inventory: Inventory) -> bool:
	return opened_inventories.find(inventory) != -1

func is_open_any_inventory() -> bool:
	return !opened_inventories.is_empty()

func is_open_main_inventory() -> bool:
	return is_open_inventory(main_inventory)

# ── Open / Close craft stations ─────────────────────────────

func open_station(station: CraftStation):
	if is_open_station(station):
		return
	add_open_station(station)

func add_open_station(station: CraftStation):
	opened_stations.append(station)
	opened_station.emit(station)

func close_station(station: CraftStation):
	if not is_open_station(station):
		return
	remove_open_station(station)

func remove_open_station(station: CraftStation):
	var index = opened_stations.find(station)
	if index != -1:
		opened_stations.remove_at(index)
		closed_station.emit(station)
		if main_station != station:
			station.get_parent().close(get_parent())

func open_main_craft_station():
	if multiplayer.is_server():
		open_station(main_station)
	else:
		open_main_craft_station_rpc.rpc_id(1)

func close_craft_stations():
	if multiplayer.is_server():
		for index in range(opened_stations.size() - 1, -1, -1):
			close_station(opened_stations[index])
	else:
		close_stations_rpc.rpc_id(1)

func is_open_station(station: CraftStation) -> bool:
	return opened_stations.find(station) != -1

func is_open_any_station() -> bool:
	return !opened_stations.is_empty()

# ── RPCs (server-side execution) ────────────────────────────

@rpc("any_peer")
func picked_rpc(obj_path: NodePath):
	var obj = get_node_or_null(obj_path)
	if obj:
		picked.emit(obj)

@rpc("any_peer")
func open_main_inventory_rpc():
	open_inventory(main_inventory)

@rpc("any_peer")
func open_inventory_rpc(inventory_path: NodePath):
	var inventory = get_node_or_null(inventory_path)
	if inventory:
		open_inventory(inventory)

@rpc("any_peer")
func add_open_inventory_rpc(inventory_path: NodePath):
	var inventory = get_node_or_null(inventory_path)
	if inventory:
		super_add_open_inventory(inventory)

@rpc("any_peer")
func remove_open_inventory_rpc(inventory_path: NodePath):
	var inventory = get_node_or_null(inventory_path)
	if inventory:
		var index = opened_inventories.find(inventory)
		if index != -1:
			opened_inventories.remove_at(index)
			closed_inventory.emit(inventory)

@rpc("any_peer")
func close_inventories_rpc():
	if multiplayer.is_server():
		for index in range(opened_inventories.size() - 1, -1, -1):
			close_inventory(opened_inventories[index])

@rpc("any_peer")
func pick_to_inventory_rpc(node_path: NodePath):
	var node = get_node_or_null(node_path)
	if node:
		pick_to_inventory(node)

@rpc
func transfer_to_rpc(inventory_path: NodePath, origin_pos: Vector2i, destination_path: NodePath, destination_pos: Vector2i, amount: int, is_rotated: bool):
	var inv = get_node_or_null(inventory_path)
	var dest = get_node_or_null(destination_path)
	if inv and dest:
		inv.transfer_to(origin_pos, dest, destination_pos, amount, is_rotated)

@rpc
func split_rpc(inventory_path: NodePath, stack_index: int, amount: int):
	var inv = get_node_or_null(inventory_path)
	if inv:
		inv.split(stack_index, amount)

@rpc
func rotate_rpc(stack_index: int, inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		inv.rotate(inv.stacks[stack_index])

@rpc
func sort_rpc(inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv:
		inv.sort()

@rpc
func drop_rpc(stack_index: int, inventory_path: NodePath):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		inv.drop_from_inventory(stack_index, inv.stacks[stack_index].amount, inv.stacks[stack_index].properties)

@rpc
func equip_rpc(stack_index: int, inventory_path: NodePath, slot_index: int):
	var inv = get_node_or_null(inventory_path)
	if inv and stack_index < inv.stacks.size():
		hotbar.equip(inv.stacks[stack_index], slot_index)

@rpc
func hotbar_change_selection_rpc(selection_index: int):
	if not multiplayer.is_server():
		return
	if hotbar.selection_index == selection_index:
		selection_index = -1
	hotbar.selection_index = selection_index

@rpc
func hotbar_previous_item_rpc():
	if not multiplayer.is_server():
		return
	hotbar.previous_item()

@rpc
func hotbar_next_item_rpc():
	if not multiplayer.is_server():
		return
	hotbar.next_item()

@rpc
func open_main_craft_station_rpc():
	open_station(main_station)

@rpc("any_peer")
func add_open_station_rpc(station_path: NodePath):
	var station = get_node_or_null(station_path)
	if station:
		add_open_station(station)

@rpc("any_peer")
func remove_open_station_rpc(station_path: NodePath):
	var station = get_node_or_null(station_path)
	if station:
		remove_open_station(station)

@rpc
func close_stations_rpc():
	if multiplayer.is_server():
		for index in range(opened_stations.size() - 1, -1, -1):
			close_station(opened_stations[index])

@rpc
func craft_rpc(craft_station_path: NodePath, recipe_index: int):
	var station = get_node_or_null(craft_station_path)
	if station:
		station.craft(recipe_index)
