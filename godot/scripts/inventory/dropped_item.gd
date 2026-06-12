extends Area3D

## Dropped item in the 3D world — pickable by players.
## The interactor passes the CoresapianInventorySystem node via node_base_to_interactions.

@export var item_id: String = ""
@export var amount: int = 1
@export var item_properties: Dictionary = {}
@export var is_pickable: bool = true

var _time: float = 0.0
var _base_y: float = 0.0

@onready var _label: Label3D = $Label3D

func _ready() -> void:
	_base_y = position.y
	_update_label()

func _process(delta: float) -> void:
	_time += delta
	position.y = _base_y + sin(_time * 2.0) * 0.08

func get_interaction_position(_collision_point: Vector3) -> Vector3:
	return position

func get_interact_actions(_interactor) -> Array:
	var action = InteractAction.new()
	action.code = 0
	action.input = "interact"
	var name = item_id.replace("_", " ").capitalize() if item_id else "Item"
	action.description = "Pick up %s x%d" % [name, amount]
	return [action]

func interact(character: Node, _action_index) -> void:
	if character and character.has_method("pick_to_inventory"):
		character.pick_to_inventory(self)

func _update_label() -> void:
	if not _label:
		return
	var name = item_id.replace("_", " ").capitalize() if item_id else "Item"
	_label.text = name if amount <= 1 else "%s x%d" % [name, amount]
