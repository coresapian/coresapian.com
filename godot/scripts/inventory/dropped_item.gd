extends Node3D

## Dropped item in the 3D world that players can pick up.
## Compatible with CharacterInventorySystem.pick_to_inventory() which checks for:
##   is_pickable, item_id, amount, item_properties

@export var item_id: String = ""
@export var amount: int = 1
@export var item_properties: Dictionary = {}
@export var is_pickable: bool = true

var _time: float = 0.0
var _base_y: float = 0.0

@onready var _label: Label3D = $Label3D
@onready var _mesh: MeshInstance3D = $MeshInstance3D


func _ready() -> void:
	_base_y = position.y
	_update_label()


func _process(delta: float) -> void:
	_time += delta
	# Gentle floating animation
	position.y = _base_y + sin(_time * 2.0) * 0.08


func get_interaction_position(_collision_point: Vector3) -> Vector3:
	return position


func get_interact_actions(_interactor) -> Array:
	var action = InteractAction.new()
	action.code = 0
	action.input = "interact"
	var display_name = item_id
	if item_id != "":
		display_name = item_id.replace("_", " ").capitalize()
	action.description = "Pick up %s x%d" % [display_name, amount]
	return [action]


func interact(character: Node, _action_index) -> void:
	var inv_system = character.get_node_or_null("CharacterInventorySystem")
	if inv_system:
		inv_system.pick_to_inventory(self)


func _update_label() -> void:
	if _label:
		var display_name = item_id
		if item_id != "":
			display_name = item_id.replace("_", " ").capitalize()
		_label.text = display_name if amount <= 1 else "%s x%d" % [display_name, amount]
