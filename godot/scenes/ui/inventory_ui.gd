extends Control

## Coresapian Inventory UI — visibility, drag-drop, context menus.
## Bridges ExpressoBits demo UI panels to CoresapianInventorySystem.

signal inventory_opened
signal inventory_closed

var _inv: CoresapianInventorySystem = null
var _is_open: bool = false
var _alt_inventory: Inventory = null

@onready var _player_panel: Control = %PlayerGridInventoryUI
@onready var _loot_panel: Control = %LootGridInventoryUI
@onready var _player_craft: Control = %PlayerCraftStationUI
@onready var _other_craft: Control = %OtherCraftStationUI
@onready var _hotbar: Control = $HotbarUI
@onready var _drop_area: Control = $DropArea
@onready var _popup: PopupMenu = $StackPopupMenu

# Context state
var _ctx_stack: ItemStack = null
var _ctx_inv: GridInventory = null

func _ready() -> void:
	visible = false
	_player_panel.visible = false
	_loot_panel.visible = false
	if _drop_area:
		_drop_area.visible = false
	if _player_craft:
		_player_craft.close()
	if _other_craft:
		_other_craft.close()

	# Wire panel signals
	for panel in [_player_panel, _loot_panel]:
		if not panel: continue
		panel.request_transfer_to.connect(_on_transfer_to)
		panel.request_fast_transfer.connect(_on_fast_transfer)
		panel.request_split.connect(_on_split)
		panel.inventory_stack_context_activated.connect(_on_context)

	# Wire drop area
	if _drop_area:
		_drop_area.request_drop.connect(func(stack, inv): _inv.drop(stack, inv) if _inv else null)

	# Wire craft UIs
	for cui in [_player_craft, _other_craft]:
		if cui:
			cui.on_craft.connect(_on_craft)

	# Wire popup
	if _popup:
		_popup.id_pressed.connect(_on_popup_id)

func setup(inventory_system: CoresapianInventorySystem) -> void:
	_inv = inventory_system
	_inv.opened_inventory.connect(_on_open_inventory)
	_inv.closed_inventory.connect(_on_close_inventory)
	_inv.opened_station.connect(_on_open_station)
	_inv.closed_station.connect(_on_close_station)
	if _player_panel:
		_player_panel.inventory = inventory_system.main_inventory
	if _hotbar and _hotbar.has_method("set_hotbar"):
		_hotbar.set_hotbar(inventory_system.hotbar)

func toggle() -> void:
	close() if _is_open else open()

func open() -> void:
	if _is_open or not _inv: return
	_is_open = true
	_inv.open_main_inventory()
	inventory_opened.emit()

func close() -> void:
	if not _is_open: return
	_is_open = false
	_inv.close_inventories()
	_inv.close_craft_stations()
	inventory_closed.emit()

# ── Open / Close handlers ────────────────────────────────────

func _on_open_inventory(inventory: Inventory) -> void:
	if _inv.main_inventory == inventory:
		# Main inventory opened — just show the player panel
		_show_player_ui(true)
	else:
		# External inventory (loot chest, etc.)
		_loot_panel.inventory = inventory
		_loot_panel.visible = true
		_alt_inventory = inventory
		_show_player_ui(true)

func _on_close_inventory(_inventory: Inventory) -> void:
	_alt_inventory = null
	_show_player_ui(false)

func _on_open_station(station: CraftStation) -> void:
	if station == _inv.main_station:
		_player_craft.open(station) if _player_craft else null
	else:
		_other_craft.open(station) if _other_craft else null
	_show_player_ui(true)

func _on_close_station(station: CraftStation) -> void:
	if station == _inv.main_station:
		_player_craft.close() if _player_craft else null
	else:
		_other_craft.close() if _other_craft else null
		_alt_inventory = null
	_show_player_ui(false)

func _show_player_ui(show: bool) -> void:
	_player_panel.visible = show
	if _drop_area: _drop_area.visible = show
	if _hotbar: _hotbar.visible = not show
	if not show:
		_loot_panel.visible = false

# ── Drag-drop / transfer handlers ────────────────────────────

func _on_transfer_to(src: GridInventory, src_pos: Vector2i, dst: GridInventory, dst_pos: Vector2i, amt: int, rotated: bool) -> void:
	if _inv: _inv.transfer_to(src, src_pos, dst, dst_pos, amt, rotated)

func _on_fast_transfer(src: GridInventory, src_pos: Vector2i, amt: int) -> void:
	if not _inv: return
	var dst: Inventory = _alt_inventory if src == _player_panel.inventory else _player_panel.inventory
	if dst: _inv.transfer(src, src_pos, dst, amt)

func _on_split(inventory: Inventory, idx: int, amt: int) -> void:
	if _inv: _inv.split(inventory, idx, amt)

func _on_craft(station: CraftStation, recipe: int) -> void:
	if _inv: _inv.craft(station, recipe)

# ── Context menu (right-click) ───────────────────────────────

func _on_context(event: InputEvent, inventory: GridInventory, stack: ItemStack) -> void:
	if not (event is InputEventMouseButton): return
	var mb := event as InputEventMouseButton
	if not _popup: return

	_ctx_stack = stack
	_ctx_inv = inventory

	_popup.clear()
	_popup.add_item("Split", 0)
	_popup.add_item("Rotate", 1)
	_popup.add_item("Drop", 2)
	_popup.add_separator()
	_popup.add_item("Sort", 3)
	_popup.set_item_disabled(0, stack.amount == 1)
	_popup.position = mb.global_position
	_popup.popup()

func _on_popup_id(id: int) -> void:
	if not _ctx_stack or not _ctx_inv or not _inv: return
	match id:
		0: # Split
			var idx = _ctx_inv.stacks.find(_ctx_stack)
			if idx != -1: _inv.split(_ctx_inv, idx, int(_ctx_stack.amount / 2.0))
		1: # Rotate
			_inv.rotate(_ctx_stack, _ctx_inv)
		2: # Drop
			_inv.drop(_ctx_stack, _ctx_inv)
		3: # Sort
			_inv.sort(_ctx_inv)
