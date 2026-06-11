extends Node3D

const PLAYER_SCENE: PackedScene = preload("res://scenes/core_truths/player.tscn")
const SPAWN_POSITION := Vector3(0, 5, 7)
const KILL_PLANE_Y := -20.0

func _ready() -> void:
	print("[CoreTruths] _ready start")

	# Disable volumetric fog on web (Compatibility renderer doesn't support it)
	if OS.has_feature("web"):
		var env: WorldEnvironment = get_node_or_null("WorldEnvironment")
		if env and env.environment:
			env.environment.volumetric_fog_enabled = false
			print("[CoreTruths] Disabled volumetric fog for web")

	_generate_temple_collision()
	_connect_kill_plane()
	_spawn_local_player()
	print("[CoreTruths] _ready done — everything set up")

func _generate_temple_collision() -> void:
	var temple: Node = get_node_or_null("Temple")
	if not temple:
		push_error("[CoreTruths] Temple node not found!")
		return
	_generate_collision_recursive(temple)
	print("[CoreTruths] Temple trimesh collision generated.")

func _generate_collision_recursive(node: Node) -> void:
	if node is MeshInstance3D:
		var mesh_inst: MeshInstance3D = node
		if mesh_inst.mesh:
			mesh_inst.create_trimesh_collision()
	for child in node.get_children():
		_generate_collision_recursive(child)

func _connect_kill_plane() -> void:
	var kill_plane: Area3D = get_node_or_null("KillPlane")
	if kill_plane:
		kill_plane.body_entered.connect(_on_kill_plane_body_entered)
		print("[CoreTruths] Kill plane connected at Y=%.0f" % KILL_PLANE_Y)

func _on_kill_plane_body_entered(body: Node3D) -> void:
	if body is CharacterBody3D and body.is_in_group("player"):
		print("[CoreTruths] Player fell into void — respawning.")
		body.global_position = SPAWN_POSITION
		body.velocity = Vector3.ZERO

func _spawn_local_player() -> void:
	print("[CoreTruths] Spawning local player...")
	var player := PLAYER_SCENE.instantiate()
	player.name = "LocalPlayer"
	add_child(player)

	# Find floor below spawn point
	var spawn_pos := _find_floor_below(SPAWN_POSITION)
	player.global_position = spawn_pos
	print("[CoreTruths] Local player spawned at %s" % spawn_pos)

func _find_floor_below(origin: Vector3) -> Vector3:
	var space_state := get_world_3d().direct_space_state
	var ray_query := PhysicsRayQueryParameters3D.create(
		origin,
		origin + Vector3.DOWN * 50.0,
		0xFFFFFFFF,
		[]
	)
	ray_query.hit_back_faces = true
	var result := space_state.intersect_ray(ray_query)
	if not result.is_empty():
		var floor_y: float = result.position.y
		print("[CoreTruths] Floor raycast hit at Y=%.3f" % floor_y)
		return Vector3(origin.x, floor_y + 0.5, origin.z)
	push_warning("[CoreTruths] Floor raycast found nothing — using raw spawn position")
	return origin
