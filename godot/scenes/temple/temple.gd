extends Node3D

const PLAYER_SCENE: PackedScene = preload("res://scenes/temple/player.tscn")
const INVENTORY_UI_SCENE: PackedScene = preload("res://scenes/ui/inventory_ui.tscn")
const SPAWN_POSITION := Vector3(0, 5, 7)
const KILL_PLANE_Y := -20.0
const SKY_PANORAMA_PATH := "res://resources/fantasy_sky_background_0.jpg"

## Track spawned players by peer ID
var players: Dictionary = {}

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

	# Multiplayer-aware player spawning
	if NetworkManager.is_dedicated_server:
		print("[Temple] Running as dedicated server — spawning on peer connect")
	elif multiplayer.multiplayer_peer == null or multiplayer.multiplayer_peer is OfflineMultiplayerPeer:
		# No network — spawn local player immediately
		_spawn_local_player()
	else:
		# Multiplayer client — server will spawn our player via _on_peer_connected
		# But we also need to handle the case where we connected and the server
		# doesn't know to spawn us yet. Request spawn.
		print("[Temple] Multiplayer client — my peer ID is %d" % multiplayer.get_unique_id())
		if multiplayer.is_server():
			# We're the server — spawn ourselves
			_spawn_player(1)
		# Client players get spawned when server's _on_peer_connected fires

	# Connect multiplayer signals
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)

	print("[Temple] _ready done")


func _on_peer_connected(peer_id: int) -> void:
	print("[Temple] Peer connected: %d" % peer_id)
	if not multiplayer.is_server():
		return
	# Server spawns a player for every connecting peer
	_spawn_player(peer_id)
	# Also spawn the server's own player if this is the first connection
	# (server peer is always 1)
	if not players.has(1):
		_spawn_player(1)


func _on_peer_disconnected(peer_id: int) -> void:
	print("[Temple] Peer disconnected: %d" % peer_id)
	if players.has(peer_id):
		var player: Node = players[peer_id]
		player.queue_free()
		players.erase(peer_id)


func _spawn_player(peer_id: int) -> void:
	if players.has(peer_id):
		return

	print("[Temple] Spawning player for peer %d" % peer_id)
	var player := PLAYER_SCENE.instantiate()
	player.name = str(peer_id)
	player.set_multiplayer_authority(peer_id)
	add_child(player)

	# Find floor below spawn point
	var spawn_pos := _find_floor_below(SPAWN_POSITION)
	player.global_position = spawn_pos
	print("[Temple] Player %d spawned at %s" % [peer_id, spawn_pos])

	players[peer_id] = player

	# Only setup inventory UI for the local player (this peer's player)
	if peer_id == multiplayer.get_unique_id():
		_setup_inventory_ui(player)


func _spawn_local_player() -> void:
	print("[Temple] Spawning local player (offline mode)...")
	var player := PLAYER_SCENE.instantiate()
	player.name = "LocalPlayer"
	add_child(player)

	var spawn_pos := _find_floor_below(SPAWN_POSITION)
	player.global_position = spawn_pos
	print("[Temple] Local player spawned at %s" % spawn_pos)

	players[1] = player
	_setup_inventory_ui(player)


func _setup_sky() -> void:
	var temple: Node = get_node_or_null("Temple")
	if temple:
		_hide_skybox_recursive(temple)

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
	var name_lower: String = node.name.to_lower()
	if "skybox" in name_lower:
		if node.get_child_count() == 1 and node.get_child(0) is MeshInstance3D:
			var child_mesh: MeshInstance3D = node.get_child(0)
			child_mesh.visible = false
			print("[Temple] Hidden skybox via parent container: %s -> %s" % [node.name, child_mesh.name])
			return
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


func _setup_inventory_ui(player: CharacterBody3D) -> void:
	var inv_system: CoresapianInventorySystem = player.get_node_or_null("CharacterInventorySystem")
	if not inv_system:
		push_warning("[Temple] No CharacterInventorySystem found on player — skipping inventory UI")
		return

	# Add inventory UI to a CanvasLayer
	var canvas := CanvasLayer.new()
	canvas.name = "InventoryCanvas"
	canvas.layer = 100
	add_child(canvas)

	var inv_ui := INVENTORY_UI_SCENE.instantiate()
	canvas.add_child(inv_ui)

	# Setup the UI with the player's inventory system
	inv_ui.setup(inv_system)
	print("[Temple] Inventory UI setup complete")


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
