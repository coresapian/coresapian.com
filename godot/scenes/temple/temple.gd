extends Node3D

const PLAYER_SCENE: PackedScene = preload("res://scenes/temple/player.tscn")
const INVENTORY_UI_SCENE: PackedScene = preload("res://scenes/ui/inventory_ui.tscn")
const SPAWN_POSITION := Vector3(0, 5, 7)
const KILL_PLANE_Y := -20.0
const SKY_PANORAMA_PATH := "res://resources/fantasy_sky_background_0.jpg"
const RUNE_STONE_SCENE: PackedScene = preload("res://scenes/interactables/rune_stone.tscn")
const WATER_ORB_SCENE: PackedScene = preload("res://scenes/interactables/water_orb.tscn")

var players: Dictionary = {}

func _ready() -> void:
	# Web: disable volumetric fog (Compatibility renderer)
	if OS.has_feature("web"):
		var env: WorldEnvironment = get_node_or_null("WorldEnvironment")
		if env and env.environment:
			env.environment.volumetric_fog_enabled = false

	_setup_sky()
	_generate_temple_collision()
	_connect_kill_plane()

	# Preload critical resources in the background before spawning entities.
	var zone_paths: Array[String] = [
		"res://scenes/temple/player.tscn",
		"res://scenes/ui/inventory_ui.tscn",
		"res://scenes/interactables/rune_stone.tscn",
		"res://scenes/interactables/water_orb.tscn",
		"res://scenes/items/loot_chest.tscn",
	]
	if ResourcePreloader.is_ready() or ResourcePreloader.get_progress() == 0.0:
		ResourcePreloader.preload_zone(zone_paths)
		await ResourcePreloader.zone_ready

	# Defer spawning so physics processes the trimesh collision first
	_spawn_entities.call_deferred()

func _spawn_entities() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)

	# Spawn loot chest (needs floor collision)
	var chest_scene := ResourcePreloader.get_packed_scene("res://scenes/items/loot_chest.tscn")
	var chest = chest_scene.instantiate() if chest_scene else preload("res://scenes/items/loot_chest.tscn").instantiate()
	chest.position = _find_floor_below(Vector3(3, 5, 0))
	add_child(chest)

	# Spawn teleporters
	var rune_scene := ResourcePreloader.get_packed_scene("res://scenes/interactables/rune_stone.tscn")
	var rune_stone = rune_scene.instantiate() if rune_scene else RUNE_STONE_SCENE.instantiate()
	rune_stone.position = _find_floor_below(Vector3(-5, 5, 3))
	add_child(rune_stone)

	var orb_scene := ResourcePreloader.get_packed_scene("res://scenes/interactables/water_orb.tscn")
	var water_orb = orb_scene.instantiate() if orb_scene else WATER_ORB_SCENE.instantiate()
	water_orb.position = _find_floor_below(Vector3(5, 5, 3))
	add_child(water_orb)

	# Spawn player
	if NetworkManager.is_dedicated_server:
		pass  # server spawns on peer connect
	elif OS.has_feature("web"):
		# Web: always spawn local player for immediate visibility.
		# Server connection happens in the background via main.gd.
		_spawn_local_player()
	elif multiplayer.multiplayer_peer == null or multiplayer.multiplayer_peer is OfflineMultiplayerPeer:
		_spawn_local_player()
	elif multiplayer.is_server():
		_spawn_player(1)

# ── Multiplayer callbacks ────────────────────────────────────

func _on_peer_connected(peer_id: int) -> void:
	if not multiplayer.is_server(): return
	# Ensure the server's own player exists (server may be headless or a player client)
	if not players.has(1):
		_spawn_player(1)
	_spawn_player(peer_id)

func _on_peer_disconnected(peer_id: int) -> void:
	# Never free the local player — it holds the camera and must persist
	# across server disconnects/reconnects.
	if peer_id == 1 and players.has(1):
		var p = players[1]
		if p.name == "LocalPlayer":
			return
	if players.has(peer_id):
		players[peer_id].queue_free()
		players.erase(peer_id)

# ── Player spawning ──────────────────────────────────────────

func _spawn_player(peer_id: int) -> void:
	if players.has(peer_id): return
	var player := PLAYER_SCENE.instantiate()
	player.name = str(peer_id)
	player.set_multiplayer_authority(peer_id)
	add_child(player)
	player.global_position = _find_floor_below(SPAWN_POSITION)
	players[peer_id] = player
	if peer_id == multiplayer.get_unique_id():
		_setup_inventory_ui(player)

func _spawn_local_player() -> void:
	var player := PLAYER_SCENE.instantiate()
	player.name = "LocalPlayer"
	add_child(player)
	player.global_position = _find_floor_below(SPAWN_POSITION)
	players[1] = player
	_setup_inventory_ui(player)

# ── Inventory UI ─────────────────────────────────────────────

func _setup_inventory_ui(player: CharacterBody3D) -> void:
	var inv := player.get_node_or_null("CharacterInventorySystem") as CoresapianInventorySystem
	if not inv: return
	var canvas := CanvasLayer.new()
	canvas.name = "InventoryCanvas"
	canvas.layer = 100
	add_child(canvas)
	var ui := INVENTORY_UI_SCENE.instantiate()
	canvas.add_child(ui)
	ui.setup(inv)

# ── Sky ──────────────────────────────────────────────────────

func _setup_sky() -> void:
	var temple_node = get_node_or_null("Temple")
	if temple_node:
		_hide_skybox_recursive(temple_node)
	var env_node: WorldEnvironment = get_node_or_null("WorldEnvironment")
	if not env_node or not env_node.environment: return
	var sky_tex: Texture2D = load(SKY_PANORAMA_PATH)
	if not sky_tex: return
	var sky_mat := PanoramaSkyMaterial.new()
	sky_mat.panorama = sky_tex
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env_node.environment.sky = sky
	env_node.environment.background_mode = Environment.BG_SKY

func _hide_skybox_recursive(node: Node) -> void:
	if "skybox" in node.name.to_lower() and node.get_child_count() == 1 and node.get_child(0) is MeshInstance3D:
		node.get_child(0).visible = false
		return
	for child in node.get_children():
		_hide_skybox_recursive(child)

# ── Collision ────────────────────────────────────────────────

func _generate_temple_collision() -> void:
	var temple_node = get_node_or_null("Temple")
	if temple_node:
		_gen_collision(temple_node)

func _gen_collision(node: Node) -> void:
	if node is MeshInstance3D and node.visible and node.mesh:
		node.create_trimesh_collision()
	for child in node.get_children():
		_gen_collision(child)

# ── Kill plane ───────────────────────────────────────────────

func _connect_kill_plane() -> void:
	var kp: Area3D = get_node_or_null("KillPlane")
	if kp:
		kp.body_entered.connect(func(body):
			if body is CharacterBody3D and body.is_in_group("player"):
				body.global_position = SPAWN_POSITION
				body.velocity = Vector3.ZERO
		)

# ── Floor detection ──────────────────────────────────────────

func _find_floor_below(origin: Vector3) -> Vector3:
	var space_state := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, origin + Vector3.DOWN * 50.0, 0xFFFFFFFF, [])
	query.hit_back_faces = true
	var result := space_state.intersect_ray(query)
	if not result.is_empty():
		return Vector3(origin.x, result.position.y + 0.5, origin.z)
	return origin
