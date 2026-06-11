class_name SyncGridInventoryCoresapian
extends Node

@export var sync_when_content_update_only := false
@export var inventory: GridInventory

func _ready():
	if Engine.is_editor_hint():
		return
	if multiplayer != null:
		multiplayer.peer_connected.connect(_on_connected)
	if inventory != null:
		setup()

func setup():
	if sync_when_content_update_only:
		inventory.contents_changed.connect(_on_contents_changed)
	else:
		inventory.stack_added.connect(_on_stack_added)
		inventory.updated_stack.connect(_on_updated_stack)
		inventory.stack_removed.connect(_on_stack_removed)

func _is_server() -> bool:
	return multiplayer != null and multiplayer.is_server()

func _on_contents_changed():
	if not _is_server():
		return
	var inv_data = inventory.serialize()
	_update_inventory_rpc.rpc(inv_data)

func _on_connected(id):
	if not _is_server():
		return
	var inv_data = inventory.serialize()
	_update_inventory_rpc.rpc_id(id, inv_data)

func _on_stack_added(stack_index: int):
	if not _is_server():
		return
	var item_id = inventory.stacks[stack_index].item_id
	var amount = inventory.stacks[stack_index].amount
	var properties = inventory.stacks[stack_index].properties
	var position = inventory.stack_positions[stack_index]
	var rotation = inventory.stack_rotations[stack_index]
	_stack_added_rpc.rpc(stack_index, item_id, amount, properties, position, rotation)

func _on_updated_stack(stack_index: int):
	if not _is_server():
		return
	_updated_slot_rpc.rpc(stack_index, inventory.stacks[stack_index].serialize())

func _on_stack_removed(stack_index: int):
	if not _is_server():
		return
	_stack_removed_rpc.rpc(stack_index)

@rpc
func _update_inventory_rpc(inv_data: Dictionary):
	if not _is_server():
		inventory.deserialize(inv_data)
		inventory.contents_changed.emit()

@rpc
func _stack_added_rpc(_stack_index: int, item_id: String, amount: int, properties: Dictionary, position: Vector2i, rotation: bool):
	if _is_server():
		return
	inventory.add_at_position(position, item_id, amount, properties, rotation)

@rpc
func _updated_slot_rpc(stack_index: int, slot_data: Array):
	if _is_server():
		return
	var stack: ItemStack = inventory.stacks[stack_index]
	stack.deserialize(slot_data)
	inventory.updated_stack.emit(stack_index)

@rpc
func _stack_removed_rpc(stack_index: int):
	if _is_server():
		return
	inventory.remove_stack(stack_index)
