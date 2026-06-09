extends CharacterBody3D

## First-person player controller with gravity-based walking and multiplayer support.
## WASD to walk, Space to jump, Ctrl/C to crouch, Shift to sprint.
## When this node has multiplayer authority (is the local player), it reads
## input and replicates position/rotation via @rpc. Remote instances
## receive the updates and interpolate into place.

@export var walk_speed: float = 5.5
@export var sprint_speed: float = 9.0
@export var jump_velocity: float = 6.5
@export var mouse_sensitivity: float = 0.0022
@export var touch_look_sensitivity: float = 0.0045
@export var touch_move_radius: float = 88.0

## Gravity acceleration (m/s²). Godot's default matches Earth ~9.8.
@export var gravity: float = 9.8

## Crouch parameters.
@export var crouch_depth: float = 0.5
@export var crouch_speed_multiplier: float = 0.5

## Snap distance for floor detection — prevents bouncing on slopes.
@export var floor_snap_length: float = 0.3

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var crosshair: Label = $HUD/Crosshair
@onready var settings_menu: Control = $HUD/SettingsMenu
@onready var gear_button: Button = $HUD/GearButton
@onready var touch_controls: Control = $HUD/TouchControls
@onready var move_pad: Control = $HUD/TouchControls/MovePad
@onready var move_knob: Control = $HUD/TouchControls/MovePad/MoveKnob
@onready var look_pad: Control = $HUD/TouchControls/LookPad
@onready var jump_button: Button = $HUD/TouchControls/JumpButton
@onready var player_label: Label3D = $PlayerLabel
@onready var collision_shape: CollisionShape3D = $PlayerCollisionShape

var _pitch: float = 0.0
var _touch_controls_enabled: bool = false
var _touch_move_id: int = -1
var _touch_look_id: int = -1
var _touch_move_vector: Vector2 = Vector2.ZERO
var _touch_look_previous: Vector2 = Vector2.ZERO

## Crouch state.
var _is_crouching: bool = false
var _stand_height: float = 1.2
var _stand_head_y: float = 0.65
var _target_head_y: float = 0.65

## Position that remote peers are interpolating toward.
var _sync_position := Vector3.ZERO
## Rotation Y that remote peers are interpolating toward.
var _sync_rotation_y: float = 0.0
## Pitch (head X rotation) that remote peers are interpolating toward.
var _sync_pitch: float = 0.0

## Threshold tracking to avoid sending sync_transform every frame.
var _last_sent_pos := Vector3.ZERO
var _last_sent_rot_y: float = 0.0
var _last_sent_pitch: float = 0.0
const SYNC_THRESHOLD_POS := 0.01
const SYNC_THRESHOLD_ROT := 0.01


func _ready() -> void:
	# Authority is determined by the node name (set by MultiplayerSpawner to the peer ID).
	# This way each peer grants authority to the correct player instance.
	var peer_id := name.to_int()
	set_multiplayer_authority(peer_id)

	var is_local := is_multiplayer_authority()

	_ensure_input_map()

	# Only the local player processes input and shows HUD.
	if not is_local:
		_disable_local_features()
		return

	# Local player setup.
	_touch_controls_enabled = _should_use_touch_controls()
	touch_controls.visible = _touch_controls_enabled
	crosshair.visible = not _touch_controls_enabled
	if _touch_controls_enabled or _should_defer_mouse_capture():
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	else:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	gear_button.pressed.connect(_on_gear_button_pressed)
	settings_menu.settings_closed.connect(_on_settings_closed)
	if jump_button:
		jump_button.button_down.connect(_on_jump_button_down)
		jump_button.button_up.connect(_on_jump_button_up)
	get_viewport().size_changed.connect(_reset_touch_visuals)
	call_deferred("_reset_touch_visuals")

	# Set up CharacterBody3D floor properties.
	up_direction = Vector3.UP
	floor_stop_on_slope = true
	floor_snap_length = floor_snap_length


func _physics_process(delta: float) -> void:
	if is_multiplayer_authority():
		_process_local_input(delta)
	else:
		_interpolate_remote_state(delta)


func _process_local_input(delta: float) -> void:
	# ── Gravity ──
	if not is_on_floor():
		velocity.y -= gravity * delta

	# ── Jump ──
	var jump_requested := Input.is_action_just_pressed("jump") or _touch_jump_requested
	_touch_jump_requested = false
	if jump_requested and is_on_floor():
		velocity.y = jump_velocity

	# ── Crouch ──
	_update_crouch(delta)

	# ── Horizontal movement ──
	var move_dir: Vector3 = _read_move_input()
	# TODO (L6): No sprint touch button exists yet — sprint is keyboard-only on mobile.
	var speed: float = sprint_speed if Input.is_action_pressed("sprint") else walk_speed
	if _is_crouching:
		speed *= crouch_speed_multiplier

	_apply_move_velocity(move_dir, speed)

	move_and_slide()

	# Replicate transform to remote peers (only when connected and changed beyond threshold).
	if multiplayer.has_multiplayer_peer() and multiplayer.get_peers().size() > 0:
		var pos_delta := global_position.distance_to(_last_sent_pos)
		var rot_delta := absf(global_rotation.y - _last_sent_rot_y)
		var pitch_delta := absf(_pitch - _last_sent_pitch)
		if pos_delta > SYNC_THRESHOLD_POS or rot_delta > SYNC_THRESHOLD_ROT or pitch_delta > SYNC_THRESHOLD_ROT:
			sync_transform.rpc(global_position, global_rotation.y, _pitch)
			_last_sent_pos = global_position
			_last_sent_rot_y = global_rotation.y
			_last_sent_pitch = _pitch


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


# ── Crouch ───────────────────────────────────────────────────────

var _touch_jump_requested: bool = false

func _update_crouch(delta: float) -> void:
	var crouch_held := Input.is_action_pressed("move_down")
	if crouch_held and not _is_crouching:
		_is_crouching = true
		_target_head_y = _stand_head_y - crouch_depth
		if collision_shape and collision_shape.shape:
			collision_shape.shape.height = _stand_height - crouch_depth
			collision_shape.position.y = -crouch_depth * 0.5
	elif not crouch_held and _is_crouching:
		# Only uncrouch if there's room above — raycast from head upward.
		var can_stand := true
		if collision_shape and collision_shape.shape:
			var space_state := get_world_3d().direct_space_state
			var ray_origin := head.global_position
			var ray_target := ray_origin + Vector3.UP * crouch_depth
			var ray_query := PhysicsRayQueryParameters3D.create(ray_origin, ray_target, collision_mask, [self])
			var ray_result := space_state.intersect_ray(ray_query)
			can_stand = ray_result.is_empty()
		if can_stand:
			_is_crouching = false
			_target_head_y = _stand_head_y
			if collision_shape and collision_shape.shape:
				collision_shape.shape.height = _stand_height
				collision_shape.position.y = 0.0

	# Smoothly lerp head to target height.
	head.position.y = lerp(head.position.y, _target_head_y, 10.0 * delta)


# ── Remote sync ──────────────────────────────────────────────────

## Called on remote peers to receive authoritative position/rotation updates.
@rpc("authority", "call_remote", "unreliable")
func sync_transform(pos: Vector3, rot_y: float, pitch: float) -> void:
	_sync_position = pos
	_sync_rotation_y = rot_y
	_sync_pitch = pitch


func _interpolate_remote_state(delta: float) -> void:
	# Snap / lerp toward the authoritative state.
	# Using delta-based lerp for consistent convergence regardless of framerate.
	var weight := 1.0 - pow(0.001, delta)
	var dist := global_position.distance_to(_sync_position)
	if dist > 10.0:
		global_position = _sync_position
	else:
		global_position = global_position.lerp(_sync_position, weight)
	global_rotation.y = lerp_angle(global_rotation.y, _sync_rotation_y, weight)
	_pitch = lerp_angle(_pitch, _sync_pitch, weight)
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


# ── Input handling ───────────────────────────────────────────────

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
	_bind_key("move_down", KEY_CTRL)
	_bind_key("move_down", KEY_C)
	_bind_key("sprint", KEY_SHIFT)


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


# ── Touch controls ───────────────────────────────────────────────

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


func _on_jump_button_down() -> void:
	_touch_jump_requested = true


func _on_jump_button_up() -> void:
	pass


func _apply_look_delta(delta: Vector2, sensitivity: float) -> void:
	rotate_y(-delta.x * sensitivity)
	_pitch = clampf(_pitch - delta.y * sensitivity, deg_to_rad(-75), deg_to_rad(75))
	head.rotation.x = _pitch


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
