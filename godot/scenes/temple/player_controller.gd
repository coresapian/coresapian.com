extends CharacterBody3D

## Coresapian Player Controller — first-person movement + inventory toggle.
## Web-compatible pointer lock. Touch joystick support.

@export var walk_speed: float = 4.0
@export var sprint_speed: float = 6.5
@export var jump_velocity: float = 4.5
@export var mouse_sensitivity: float = 0.0022
@export var touch_sensitivity: float = 0.004
@export var gravity: float = 9.8

func set_mouse_sensitivity(value: float) -> void:
	mouse_sensitivity = value

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var interaction_ray: RayCast3D = $Head/InteractionRay
@onready var inventory_system: CoresapianInventorySystem = $CharacterInventorySystem

var _pitch: float = 0.0
var _is_web: bool = false
var _is_touchscreen: bool = false
var _touch_look_index: int = -1

func _ready() -> void:
	_is_web = OS.has_feature("web")
	_is_touchscreen = DisplayServer.is_touchscreen_available()
	_ensure_input_map()

	camera.current = true

	if inventory_system:
		inventory_system.raycast = interaction_ray
		inventory_system.camera_3d = camera
		_setup_inventory_authority()

	# On web, pointer lock only works from user gestures.
	# The inventory base class _ready() sets CAPTURED prematurely — override it.
	if _is_web or _is_touchscreen:
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	else:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)

func _input(event: InputEvent) -> void:
	# Web desktop: click to capture pointer
	if _is_web and not _is_touchscreen \
			and event is InputEventMouseButton \
			and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT:
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
		get_viewport().set_input_as_handled()
		return

	# Touch: right-half drag = camera look
	if _is_touchscreen and event is InputEventScreenTouch:
		if event.pressed and _touch_look_index == -1:
			var center_x = get_viewport().get_visible_rect().size.x / 2.0
			if event.position.x > center_x:
				_touch_look_index = event.index
				get_viewport().set_input_as_handled()
		elif not event.pressed and event.index == _touch_look_index:
			_touch_look_index = -1
			get_viewport().set_input_as_handled()

	if _is_touchscreen and event is InputEventScreenDrag and event.index == _touch_look_index:
		rotate_y(-event.relative.x * touch_sensitivity)
		_pitch = clampf(_pitch - event.relative.y * touch_sensitivity, deg_to_rad(-75), deg_to_rad(75))
		head.rotation.x = _pitch
		get_viewport().set_input_as_handled()

func _unhandled_input(event: InputEvent) -> void:
	if _is_touchscreen:
		return
	if event is InputEventMouseMotion and Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * mouse_sensitivity)
		_pitch = clampf(_pitch - event.relative.y * mouse_sensitivity, deg_to_rad(-75), deg_to_rad(75))
		head.rotation.x = _pitch
	if event.is_action_pressed("ui_cancel"):
		if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
			Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		elif not _is_web:
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	var move_input := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
	var move_dir := (transform.basis * Vector3(move_input.x, 0, move_input.y)).normalized()
	var speed := sprint_speed if Input.is_action_pressed("sprint") else walk_speed
	velocity.x = move_dir.x * speed if move_dir else move_toward(velocity.x, 0.0, speed)
	velocity.z = move_dir.z * speed if move_dir else move_toward(velocity.z, 0.0, speed)
	move_and_slide()

func _setup_inventory_authority() -> void:
	var peer_id := multiplayer.get_unique_id()
	set_multiplayer_authority(peer_id)
	# Server owns all inventory sync nodes
	var sync_paths := [
		"Inventory/SyncInventory",
		"EquipmentInventory/SyncInventory",
		"CraftStation/SyncCraftStation",
		"Hotbar/SyncHotbar",
	]
	for path in sync_paths:
		var node = inventory_system.get_node_or_null(path)
		if node:
			node.set_multiplayer_authority(1)
	inventory_system.set_multiplayer_authority(1)

func _ensure_input_map() -> void:
	var bindings := {
		"move_forward": [KEY_W, KEY_UP],
		"move_backward": [KEY_S, KEY_DOWN],
		"move_left": [KEY_A, KEY_LEFT],
		"move_right": [KEY_D, KEY_RIGHT],
		"jump": [KEY_SPACE],
		"sprint": [KEY_SHIFT],
		"toggle_inventory": [KEY_TAB],
		"toggle_craft_panel": [KEY_C],
		"interact": [KEY_E],
	}
	for action in bindings:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for keycode in bindings[action]:
			var exists = false
			for ev in InputMap.action_get_events(action):
				if ev is InputEventKey and ev.keycode == keycode:
					exists = true
					break
			if not exists:
				var event := InputEventKey.new()
				event.keycode = keycode
				InputMap.action_add_event(action, event)
