extends Node3D

const PLAYER_SCENE: PackedScene = preload("res://scenes/temple/player.tscn")
const SPAWN_POSITION := Vector3(0, 5, 7)
const KILL_PLANE_Y := -20.0
const SKY_PANORAMA_PATH := "res://resources/fantasy_sky_background_0.jpg"

func _ready() -> void:
	print("[Temple] _ready start")

	# Disable volumetric fog on web (Compatibility renderer doesn't support it)
	if OS.has_feature("web"):
		var env: WorldEnvironment = get_node_or_null("WorldEnvironment")
		if env and env.environment:
			env.environment.volumetric_fog_enabled = false
			print("[Temple] Disabled volumetric fog for web")

	_setup_sky()
	_generate_temple_collision()
	_connect_kill_plane()
	_spawn_local_player()
	print("[Temple] _ready done — everything set up")


func _setup_sky() -> void:
	# Hide the temple's built-in skybox mesh before anything else
	var temple: Node = get_node_or_null("Temple")
	if temple:
		_hide_skybox_recursive(temple)

	# Apply panorama sky via WorldEnvironment
	var env_node: WorldEnvironment = get_node_or_null("WorldEnvironment")
	if not env_node or not env_node.environment:
		push_warning("[Temple] No WorldEnvironment found — skipping sky setup")
		return

	var sky_tex: Texture2D = load(SKY_PANORAMA_PATH)
	if not sky_tex:
		push_warning("[Temple] Failed to load sky panorama: %s" % SKY_PANORAMA_PATH)
		return

	var sky_mat := PanoramaSkyMaterial.new()
	sky_mat.panorama = sky_tex

	var sky := Sky.new()
	sky.sky_material = sky_mat

	var environment: Environment = env_node.environment
	environment.sky = sky
	environment.background_mode = Environment.BG_SKY

	print("[Temple] Fantasy sky panorama applied")


func _hide_skybox_recursive(node: Node) -> void:
	if node is MeshInstance3D:
		var name_lower: String = node.name.to_lower()
		if "skybox" in name_lower or "sky_box" in name_lower or "sky" in name_lower:
			# Only hide meshes that look like skybox spheres/cubes (not sky-related lights etc.)
			var mesh_inst: MeshInstance3D = node
			if mesh_inst.mesh and mesh_inst.mesh.get_aabb().size.length() > 50.0:
				mesh_inst.visible = false
				print("[Temple] Hidden temple skybox mesh: %s" % node.name)
	for child in node.get_children():
		_hide_skybox_recursive(child)


func _generate_temple_collision() -> void:
	var temple: Node = get_node_or_null("Temple")
	if not temple:
		push_error("[Temple] Temple node not found!")
		return
	_generate_collision_recursive(temple)
	print("[Temple] Temple trimesh collision generated.")


func _generate_collision_recursive(node: Node) -> void:
	if node is MeshInstance3D:
		var mesh_inst: MeshInstance3D = node
		# Skip hidden meshes (skybox was hidden above)
		if not mesh_inst.visible:
			return
		if mesh_inst.mesh:
			mesh_inst.create_trimesh_collision()
	for child in node.get_children():
		_generate_collision_recursive(child)


func _connect_kill_plane() -> void:
	var kill_plane: Area3D = get_node_or_null("KillPlane")
	if kill_plane:
		kill_plane.body_entered.connect(_on_kill_plane_body_entered)
		print("[Temple] Kill plane connected at Y=%.0f" % KILL_PLANE_Y)


func _on_kill_plane_body_entered(body: Node3D) -> void:
	if body is CharacterBody3D and body.is_in_group("player"):
		print("[Temple] Player fell into void — respawning.")
		body.global_position = SPAWN_POSITION
		body.velocity = Vector3.ZERO


func _spawn_local_player() -> void:
	print("[Temple] Spawning local player...")
	var player := PLAYER_SCENE.instantiate()
	player.name = "LocalPlayer"
	add_child(player)

	# Find floor below spawn point
	var spawn_pos := _find_floor_below(SPAWN_POSITION)
	player.global_position = spawn_pos
	print("[Temple] Local player spawned at %s" % spawn_pos)


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
		print("[Temple] Floor raycast hit at Y=%.3f" % floor_y)
		return Vector3(origin.x, floor_y + 0.5, origin.z)
	push_warning("[Temple] Floor raycast found nothing — using raw spawn position")
	return origin
