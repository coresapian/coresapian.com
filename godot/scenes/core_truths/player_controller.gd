extends CharacterBody3D

## First-person player controller with multiplayer support.
## When this node has multiplayer authority (is the local player), it reads
## input and replicates position/rotation via @rpc. Remote instances
## receive the updates and interpolate into place.

@export var walk_speed: float = 5.5
@export var sprint_speed: float = 9.0
@export var vertical_speed: float = 4.8
@export var mouse_sensitivity: float = 0.0022
@export var touch_look_sensitivity: float = 0.0045
@export var touch_move_radius: float = 88.0
@export var hover_damping: float = 6.0
@export var interaction_distance: float = 3.0

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var interact_ray: RayCast3D = $Head/InteractRay
@onready var crosshair: Label = $HUD/Crosshair
@onready var interact_label: Label = $HUD/InteractLabel
@onready var settings_menu: Control = $HUD/SettingsMenu
@onready var gear_button: Button = $HUD/GearButton
@onready var touch_controls: Control = $HUD/TouchControls
@onready var move_pad: Control = $HUD/TouchControls/MovePad
@onready var move_knob: Control = $HUD/TouchControls/MovePad/MoveKnob
@onready var look_pad: Control = $HUD/TouchControls/LookPad
@onready var rise_button: Button = $HUD/TouchControls/RiseButton
@onready var descend_button: Button = $HUD/TouchControls/DescendButton
@onready var interact_button: Button = $HUD/TouchControls/InteractButton
@onready var player_label: Label3D = $PlayerLabel

var _pitch: float = 0.0
var _touch_controls_enabled: bool = false
var _touch_move_id: int = -1
var _touch_look_id: int = -1
var _touch_move_vector: Vector2 = Vector2.ZERO
var _touch_look_previous: Vector2 = Vector2.ZERO
var _rise_requested: bool = false
var _descend_requested: bool = false

## Position that remote peers are interpolating toward.
var _sync_position := Vector3.ZERO
## Rotation Y that remote peers are interpolating toward.
var _sync_rotation_y: float = 0.0
## Pitch (head X rotation) that remote peers are interpolating toward.
var _sync_pitch: float = 0.0


func _ready() -> void:
	# Authority is determined by the node name (set by MultiplayerSpawner to the peer ID).
	# This way each peer grants authority to the correct player instance.
	var peer_id := int(name)
	set_multiplayer_authority(peer_id)

	var is_local := is_multiplayer_authority()

	_ensure_input_map()
	interact_ray.target_position = Vector3(0, 0, -interaction_distance)
	interact_label.visible = false

	# Only the local player processes input and shows HUD.
	if not is_local:
		_disable_local_features()
		return

	# Local player setup (same as original).
	_touch_controls_enabled = _should_use_touch_controls()
	touch_controls.visible = _touch_controls_enabled
	crosshair.visible = not _touch_controls_enabled
	if _touch_controls_enabled or _should_defer_mouse_capture():
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	else:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	gear_button.pressed.connect(_on_gear_button_pressed)
	settings_menu.settings_closed.connect(_on_settings_closed)
	rise_button.button_down.connect(_on_rise_button_down)
	rise_button.button_up.connect(_on_rise_button_up)
	descend_button.button_down.connect(_on_descend_button_down)
	descend_button.button_up.connect(_on_descend_button_up)
	interact_button.button_down.connect(_on_interact_button_down)
	get_viewport().size_changed.connect(_reset_touch_visuals)
	call_deferred("_reset_touch_visuals")


func _physics_process(delta: float) -> void:
	if is_multiplayer_authority():
		_process_local_input(delta)
	else:
		_interpolate_remote_state(delta)


func _process_local_input(_delta: float) -> void:
	var move_dir: Vector3 = _read_move_input()
	var speed: float = sprint_speed if Input.is_action_pressed("sprint") else walk_speed
	var current_vertical_speed: float = vertical_speed
	if Input.is_action_pressed("sprint"):
		current_vertical_speed *= 1.25

	_apply_move_velocity(move_dir, speed)
	_apply_vertical_velocity(current_vertical_speed)

	move_and_slide()
	_update_interaction_prompt()

	# Replicate transform to remote peers.
	sync_transform.rpc(global_position, global_rotation.y, _pitch)


func _read_move_input() -> Vector3:
	var move_input := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
	if _touch_controls_enabled and _touch_move_vector != Vector2.ZERO:
		move_input = _touch_move_vector
	return (transform.basis * Vector3(move_input.x, 0, move_input.y)).normalized()


func _apply_move_velocity(move_dir: Vector3, speed: float) -> void:
	if move_dir:
		velocity.x = move_dir.x * speed
		velocity.z = move_dir.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)


func _apply_vertical_velocity(current_vertical_speed: float) -> void:
	var rise_active := _rise_requested or Input.is_action_pressed("jump") or Input.is_action_pressed("move_up")
	var descend_active := _descend_requested or Input.is_action_pressed("move_down")

	if rise_active and not descend_active:
		velocity.y = current_vertical_speed
	elif descend_active and not rise_active:
		velocity.y = -current_vertical_speed
	else:
		velocity.y = move_toward(velocity.y, 0.0, hover_damping * get_physics_process_delta_time() * current_vertical_speed)


## Called on remote peers to receive authoritative position/rotation updates.
@rpc("authority", "call_remote", "unreliable")
func sync_transform(pos: Vector3, rot_y: float, pitch: float) -> void:
	_sync_position = pos
	_sync_rotation_y = rot_y
	_sync_pitch = pitch


func _interpolate_remote_state(_delta: float) -> void:
	# Snap / lerp toward the authoritative state.
	# Using lerp for smooth movement; snap if very far away (teleport).
	var dist := global_position.distance_to(_sync_position)
	if dist > 10.0:
		global_position = _sync_position
	else:
		global_position = global_position.lerp(_sync_position, 0.25)
	global_rotation.y = lerp_angle(global_rotation.y, _sync_rotation_y, 0.25)
	_pitch = lerp_angle(_pitch, _sync_pitch, 0.25)
	head.rotation.x = _pitch


func _disable_local_features() -> void:
	# Remote player instances: disable camera, HUD, input processing.
	if camera:
		camera.current = false
		camera.enabled = false
	if head:
		head.process_mode = Node.PROCESS_MODE_DISABLED
	if $HUD:
		$HUD.visible = false
	set_process_unhandled_input(false)
	set_physics_process(true)  # Still need physics_process for interpolation
	process_mode = Node.PROCESS_MODE_INHERIT
	# Show the nametag label above the remote player.
	if player_label:
		player_label.visible = true
		player_label.text = "Player %d" % int(name)


# ── Input handling (unchanged from original) ───────────────────

func _unhandled_input(event: InputEvent) -> void:
	if _touch_controls_enabled:
		if event is InputEventScreenTouch:
			_handle_touch_press(event)
			return
		elif event is InputEventScreenDrag:
			_handle_touch_drag(event)
			return

	if _should_defer_mouse_capture() \
			and event is InputEventMouseButton \
			and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT \
			and Input.get_mouse_mode() != Input.MOUSE_MODE_CAPTURED:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
		return

	if event is InputEventMouseMotion and Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
		_apply_look_delta(event.relative, mouse_sensitivity)

	if event.is_action_pressed("ui_cancel"):
		if settings_menu and settings_menu.is_open():
			settings_menu._close()
			get_viewport().set_input_as_handled()
			return
		if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
			Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		elif not _should_defer_mouse_capture():
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)

	if event.is_action_pressed("interact"):
		_try_interact()


func _update_interaction_prompt() -> void:
	interact_ray.force_raycast_update()
	var collider := interact_ray.get_collider()
	if collider and collider is Node and (collider as Node).is_in_group("interactable"):
		interact_label.visible = true
		if collider.has_meta("interact_text"):
			interact_label.text = str(collider.get_meta("interact_text"))
		else:
			interact_label.text = "Press E to interact"
	else:
		interact_label.visible = false


func _try_interact() -> void:
	interact_ray.force_raycast_update()
	var collider := interact_ray.get_collider()
	if collider and collider is Node and (collider as Node).is_in_group("interactable"):
		var node := collider as Node

		# Browser URL takes priority — opens an iframe overlay
		if node.has_meta("browser_url"):
			var url: String = node.get_meta("browser_url")
			var title: String = node.get_meta("browser_title", "Browser")
			BrowserOverlay.open_browser(url, title)
			return

		print("Interacted with: %s" % node.name)
		if node.has_meta("on_interact_message"):
			interact_label.text = str(node.get_meta("on_interact_message"))
			interact_label.visible = true


func _ensure_input_map() -> void:
	_bind_key("move_forward", KEY_W)
	_bind_key("move_forward", KEY_UP)
	_bind_key("move_backward", KEY_S)
	_bind_key("move_backward", KEY_DOWN)
	_bind_key("move_left", KEY_A)
	_bind_key("move_left", KEY_LEFT)
	_bind_key("move_right", KEY_D)
	_bind_key("move_right", KEY_RIGHT)
	_bind_key("jump", KEY_SPACE)
	_bind_key("move_up", KEY_SPACE)
	_bind_key("move_down", KEY_CTRL)
	_bind_key("move_down", KEY_C)
	_bind_key("sprint", KEY_SHIFT)
	_bind_key("interact", KEY_E)
	_bind_key("interact", KEY_F)


func _bind_key(action: StringName, keycode: Key) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)

	for existing in InputMap.action_get_events(action):
		if existing is InputEventKey and existing.keycode == keycode:
			return

	var event := InputEventKey.new()
	event.keycode = keycode
	InputMap.action_add_event(action, event)


func _should_use_touch_controls() -> bool:
	return OS.has_feature("android") \
		or OS.has_feature("ios") \
		or OS.has_feature("web_android") \
		or OS.has_feature("web_ios")


func _should_defer_mouse_capture() -> bool:
	return OS.has_feature("web") and not _touch_controls_enabled


func _handle_touch_press(event: InputEventScreenTouch) -> void:
	if event.pressed:
		if _touch_move_id == -1 and move_pad.get_global_rect().has_point(event.position):
			_touch_move_id = event.index
			_update_touch_move(event.position)
			return

		if _touch_look_id == -1 and look_pad.get_global_rect().has_point(event.position):
			_touch_look_id = event.index
			_touch_look_previous = event.position
	else:
		if event.index == _touch_move_id:
			_touch_move_id = -1
			_touch_move_vector = Vector2.ZERO
			_reset_touch_visuals()
		elif event.index == _touch_look_id:
			_touch_look_id = -1


func _handle_touch_drag(event: InputEventScreenDrag) -> void:
	if event.index == _touch_move_id:
		_update_touch_move(event.position)
	elif event.index == _touch_look_id:
		var delta := event.position - _touch_look_previous
		_touch_look_previous = event.position
		_apply_look_delta(delta, touch_look_sensitivity)


func _update_touch_move(screen_position: Vector2) -> void:
	var center := move_pad.get_global_rect().get_center()
	var delta := screen_position - center
	if delta.length() > touch_move_radius:
		delta = delta.normalized() * touch_move_radius

	_touch_move_vector = delta / touch_move_radius
	var centered_knob := (move_pad.size - move_knob.size) * 0.5
	move_knob.position = centered_knob + delta


func _reset_touch_visuals() -> void:
	move_knob.position = (move_pad.size - move_knob.size) * 0.5


func _apply_look_delta(delta: Vector2, sensitivity: float) -> void:
	rotate_y(-delta.x * sensitivity)
	_pitch = clampf(_pitch - delta.y * sensitivity, deg_to_rad(-75), deg_to_rad(75))
	head.rotation.x = _pitch


func _on_rise_button_down() -> void:
	_rise_requested = true


func _on_rise_button_up() -> void:
	_rise_requested = false


func _on_descend_button_down() -> void:
	_descend_requested = true


func _on_descend_button_up() -> void:
	_descend_requested = false


func _on_interact_button_down() -> void:
	_try_interact()


func set_mouse_sensitivity(value: float) -> void:
	mouse_sensitivity = value


func _on_gear_button_pressed() -> void:
	if settings_menu:
		settings_menu.open()


func _on_settings_closed() -> void:
	# Re-capture mouse if no other UI is stealing it.
	if not _should_defer_mouse_capture():
		if Input.get_mouse_mode() != Input.MOUSE_MODE_CAPTURED:
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
