extends CharacterBody3D

## Coresapian Player Controller — first-person movement + inventory toggle.
## Web-compatible pointer lock handling. Touch joystick support.

@export var walk_speed: float = 4.0
@export var sprint_speed: float = 6.5
@export var jump_velocity: float = 4.5
@export var mouse_sensitivity: float = 0.0022
@export var touch_sensitivity: float = 0.004
@export var gravity: float = 9.8

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var interaction_ray: RayCast3D = $Head/InteractionRay
@onready var inventory_system: CoresapianInventorySystem = $CharacterInventorySystem

var _pitch: float = 0.0
var _is_web: bool = false
var _is_touchscreen: bool = false
var _touch_look_index: int = -1
var _touch_look_start: Vector2 = Vector2.ZERO

func _ready() -> void:
	print("[Player] _ready — enabling camera")
	_is_web = OS.has_feature("web")
	_is_touchscreen = DisplayServer.is_touchscreen_available()
	_ensure_input_map()

	# Wire the inventory system's raycast and camera references
	if inventory_system:
		inventory_system.raycast = interaction_ray
		inventory_system.camera_3d = camera
		# Wire the interactor's raycast too
		var interactor_node = inventory_system.get_node_or_null("Interactor")
		if interactor_node:
			interactor_node.raycast = interaction_ray
			interactor_node.camera = camera
		# Set server authority on all sync nodes
		_setup_inventory_authority()
		print("[Player] Inventory system wired up")

	if _is_touchscreen:
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	else:
		if not _is_web:
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)

func _input(event: InputEvent) -> void:
	# Web click-to-capture (desktop only — touchscreen uses joystick)
	if not _is_touchscreen and _is_web \
			and event is InputEventMouseButton \
			and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT \
			and Input.get_mouse_mode() != Input.MOUSE_MODE_CAPTURED:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
		get_viewport().set_input_as_handled()
		print("[Player] Pointer captured via click")
		return

	# Touch look: right-side drag controls camera
	if _is_touchscreen and event is InputEventScreenTouch:
		if event.pressed and _touch_look_index == -1:
			var screen_center_x: float = get_viewport().get_visible_rect().size.x / 2.0
			if event.position.x > screen_center_x:
				_touch_look_index = event.index
				_touch_look_start = event.position
				get_viewport().set_input_as_handled()
		elif not event.pressed and event.index == _touch_look_index:
			_touch_look_index = -1
			get_viewport().set_input_as_handled()

	if _is_touchscreen and event is InputEventScreenDrag:
		if event.index == _touch_look_index:
			var delta: Vector2 = event.relative
			rotate_y(-delta.x * touch_sensitivity)
			_pitch = clampf(_pitch - delta.y * touch_sensitivity, deg_to_rad(-75), deg_to_rad(75))
			head.rotation.x = _pitch
			get_viewport().set_input_as_handled()

func _unhandled_input(event: InputEvent) -> void:
	if not _is_touchscreen:
		if event is InputEventMouseMotion and Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
			rotate_y(-event.relative.x * mouse_sensitivity)
			_pitch = clampf(_pitch - event.relative.y * mouse_sensitivity, deg_to_rad(-75), deg_to_rad(75))
			head.rotation.x = _pitch

		if event.is_action_pressed("ui_cancel"):
			if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
				Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
				print("[Player] Pointer released")
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

	# Movement — works with both keyboard and virtual joystick (via input actions)
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

func _setup_inventory_authority() -> void:
	# Server owns all inventory state — clients request changes via RPC.
	# Node paths match the player.tscn hierarchy (no InventoryHandler wrapper):
	#   CharacterInventorySystem/Inventory/SyncInventory
	#   CharacterInventorySystem/EquipmentInventory/SyncInventory
	#   CharacterInventorySystem/CraftStation/SyncCraftStation
	#   CharacterInventorySystem/Hotbar/SyncHotbar
	if not multiplayer or not multiplayer.is_server():
		return
	var sync_paths: Array[String] = [
		"Inventory/SyncInventory",
		"EquipmentInventory/SyncInventory",
		"CraftStation/SyncCraftStation",
		"Hotbar/SyncHotbar",
	]
	for sync_path in sync_paths:
		var sync_node: Node = inventory_system.get_node_or_null(sync_path)
		if sync_node:
			sync_node.set_multiplayer_authority(1)
			print("[Player] Set authority=1 on %s" % sync_path)
		else:
			push_warning("[Player] Sync node not found: %s" % sync_path)
	# Also set authority on the inventory system itself
	inventory_system.set_multiplayer_authority(1)

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
	_bind_key("toggle_inventory", KEY_TAB)
	_bind_key("toggle_craft_panel", KEY_C)

func _bind_key(action: StringName, keycode: Key) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	for existing in InputMap.action_get_events(action):
		if existing is InputEventKey and existing.keycode == keycode:
			return
	var event := InputEventKey.new()
	event.keycode = keycode
	InputMap.action_add_event(action, event)
