extends Control

## Coresapian Inventory UI — manages visibility, drag-drop, and inventory state.
## Uses ExpressoBits demo UI scenes as sub-components.

signal inventory_opened
signal inventory_closed

var _inventory_system: CoresapianInventorySystem = null
var _is_open: bool = false

@onready var _player_inventory_panel: Control = %PlayerGridInventoryUI
@onready var _loot_inventory_panel: Control = %LootGridInventoryUI
@onready var _player_craft_station_ui: Control = %PlayerCraftStationUI
@onready var _other_craft_station_ui: Control = %OtherCraftStationUI
@onready var _hotbar_ui: Control = $HotbarUI
@onready var _drop_area: Control = $DropArea

var _alternative_inventory: Inventory = null

func _ready() -> void:
	visible = false
	_player_inventory_panel.visible = false
	_loot_inventory_panel.visible = false
	if _drop_area:
		_drop_area.visible = false

func setup(inventory_system: CoresapianInventorySystem) -> void:
	_inventory_system = inventory_system
	
	# Wire opened/closed signals
	_inventory_system.opened_inventory.connect(_on_open_inventory)
	_inventory_system.closed_inventory.connect(_on_close_inventory)
	_inventory_system.opened_station.connect(_on_open_craft_station)
	_inventory_system.closed_station.connect(_on_close_craft_station)
	
	# Set the player inventory on the UI panel
	if _player_inventory_panel:
		_player_inventory_panel.inventory = inventory_system.main_inventory
	
	# Setup hotbar
	if _hotbar_ui and _hotbar_ui.has_method("set_hotbar"):
		_hotbar_ui.set_hotbar(inventory_system.hotbar)
	
	print("[InventoryUI] Setup complete")

func toggle() -> void:
	if _is_open:
		close()
	else:
		open()

func open() -> void:
	if _is_open or _inventory_system == null:
		return
	_is_open = true
	_inventory_system.open_main_inventory()
	inventory_opened.emit()

func close() -> void:
	if not _is_open:
		return
	_is_open = false
	_inventory_system.close_inventories()
	_inventory_system.close_craft_stations()
	inventory_closed.emit()

func is_open() -> bool:
	return _is_open

func _on_open_inventory(inventory: Inventory) -> void:
	if _inventory_system.main_inventory != inventory:
		if _loot_inventory_panel:
			_loot_inventory_panel.inventory = inventory
			_loot_inventory_panel.visible = true
			_alternative_inventory = inventory
	else:
		if _player_inventory_panel:
			_player_inventory_panel.visible = true
		if _drop_area:
			_drop_area.visible = true
		if _hotbar_ui:
			_hotbar_ui.visible = false

func _on_close_inventory(inventory: Inventory) -> void:
	if _inventory_system.main_inventory != inventory:
		_alternative_inventory = null
	_close_player_inventory()

func _close_player_inventory() -> void:
	if _player_inventory_panel:
		_player_inventory_panel.visible = false
	if _loot_inventory_panel:
		_loot_inventory_panel.visible = false
	if _drop_area:
		_drop_area.visible = false
	if _hotbar_ui:
		_hotbar_ui.visible = true

func _on_open_craft_station(craft_station: CraftStation) -> void:
	if craft_station == _inventory_system.main_station:
		if _player_craft_station_ui:
			_player_craft_station_ui.open(craft_station)
	else:
		if _other_craft_station_ui:
			_other_craft_station_ui.open(craft_station)
	if _player_inventory_panel:
		_player_inventory_panel.visible = true
	if _hotbar_ui:
		_hotbar_ui.visible = false

func _on_close_craft_station(craft_station: CraftStation) -> void:
	if craft_station == _inventory_system.main_station:
		if _player_craft_station_ui:
			_player_craft_station_ui.close()
	else:
		if _other_craft_station_ui:
			_other_craft_station_ui.close()
		_alternative_inventory = null
	if _hotbar_ui:
		_hotbar_ui.visible = true
	_close_player_inventory()
