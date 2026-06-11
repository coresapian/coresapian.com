extends CharacterBody3D

## Simple first-person controller. No multiplayer. Just move and look.
## Web-compatible pointer lock handling.

@export var walk_speed: float = 4.0
@export var sprint_speed: float = 6.5
@export var jump_velocity: float = 4.5
@export var mouse_sensitivity: float = 0.0022
@export var gravity: float = 9.8

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D

var _pitch: float = 0.0
var _is_web: bool = false

func _ready() -> void:
	print("[Player] _ready — enabling camera")
	_is_web = OS.has_feature("web")
	_ensure_input_map()

	if not _is_web:
		# Native: capture immediately
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	# Web: wait for user click to capture (browser requirement)

func _input(event: InputEvent) -> void:
	# Web click-to-capture: must be in _input (not _unhandled_input)
	# so it fires before any Control node can consume it.
	if _is_web \
			and event is InputEventMouseButton \
			and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT \
			and Input.get_mouse_mode() != Input.MOUSE_MODE_CAPTURED:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
		get_viewport().set_input_as_handled()
		print("[Player] Pointer captured via click")
		return

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * mouse_sensitivity)
		_pitch = clampf(_pitch - event.relative.y * mouse_sensitivity, deg_to_rad(-75), deg_to_rad(75))
		head.rotation.x = _pitch

	if event.is_action_pressed("ui_cancel"):
		# On web, the browser already released pointer lock before this fires.
		# Just set visible — don't try to recapture (that needs a click).
		if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
			Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
			print("[Player] Pointer released")
		# On native, toggle. On web, click-to-recapture (handled in _input).
		elif not _is_web:
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
			print("[Player] Pointer captured via Esc")

func _physics_process(delta: float) -> void:
	# Gravity
	if not is_on_floor():
		velocity.y -= gravity * delta

	# Jump
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	# Movement
	var move_input := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
	var move_dir := (transform.basis * Vector3(move_input.x, 0, move_input.y)).normalized()
	var speed := sprint_speed if Input.is_action_pressed("sprint") else walk_speed

	if move_dir:
		velocity.x = move_dir.x * speed
		velocity.z = move_dir.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)

	move_and_slide()

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
