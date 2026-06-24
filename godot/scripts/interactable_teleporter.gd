extends Area3D
class_name InteractableTeleporter

## Reusable interactable that teleports the player via the FrostBridge
## transition. Requires proximity (body in Area3D) + crosshair focus
## (player's InteractionRay hits this object).
## Shows a floating Label3D prompt when active.

@export var destination_url: String = ""
@export var destination_name: String = "destination"
@export var prompt_text: String = "Press E to travel"
@export var interact_range: float = 4.0
@export var label_height: float = 2.5

var _player_in_range: bool = false
var _player_node: Node3D = null
var _prompt_label: Label3D = null

signal teleport_triggered(url: String)

func _ready() -> void:
	if not InputMap.has_action("interact"):
		InputMap.add_action("interact")
		var ev := InputEventKey.new()
		ev.keycode = KEY_E
		InputMap.action_add_event("interact", ev)

	_prompt_label = Label3D.new()
	_prompt_label.text = prompt_text
	_prompt_label.font_size = 48
	_prompt_label.outline_size = 12
	_prompt_label.outline_modulate = Color.BLACK
	_prompt_label.modulate = Color(1.0, 0.69, 0.28, 1.0)
	_prompt_label.pixel_size = 0.01
	_prompt_label.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	_prompt_label.no_depth_test = true
	_prompt_label.position = Vector3(0, label_height, 0)
	_prompt_label.visible = false
	add_child(_prompt_label)

	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _on_body_entered(body: Node3D) -> void:
	if body.is_in_group("player"):
		_player_in_range = true
		_player_node = body

func _on_body_exited(body: Node3D) -> void:
	if body.is_in_group("player"):
		_player_in_range = false
		_player_node = null
		if _prompt_label:
			_prompt_label.visible = false

func _process(_delta: float) -> void:
	if not _player_in_range or not _player_node:
		return

	var is_focused := _is_crosshair_focused()

	if _prompt_label:
		_prompt_label.visible = is_focused

	if is_focused and Input.is_action_just_pressed("interact"):
		_do_teleport()

func _is_crosshair_focused() -> bool:
	var ray: RayCast3D = _player_node.get_node_or_null("Head/InteractionRay")
	if not ray:
		var dist := global_position.distance_to(_player_node.global_position)
		return dist <= interact_range

	ray.force_raycast_update()
	var collider = ray.get_collider()
	if collider:
		var node: Node = collider
		while node:
			if node == self:
				return true
			node = node.get_parent()
	return false

func _do_teleport() -> void:
	teleport_triggered.emit(destination_url)
	if destination_url.is_empty():
		push_warning("[Teleporter] No destination_url set on %s" % name)
		return

	print("[Teleporter] %s → %s" % [name, destination_url])

	if OS.has_feature("web"):
		JavaScriptBridge.eval(
			"window.FrostBridge.travel('%s');" % destination_url, true
		)
	else:
		print("[Teleporter] (Non-web: would FrostBridge to %s)" % destination_url)

	if _prompt_label:
		_prompt_label.visible = false
