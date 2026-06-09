extends Node3D

const PLAYER_SCENE: PackedScene = preload("res://scenes/core_truths/player.tscn")
const SPAWN_POSITION := Vector3(0, 2, 7)
const KILL_PLANE_Y := -20.0

@onready var haze_spotlight_a: SpotLight3D = $HazeSpotlightA if has_node("HazeSpotlightA") else null
@onready var haze_spotlight_b: SpotLight3D = $HazeSpotlightB if has_node("HazeSpotlightB") else null
@onready var haze_spotlight_c: SpotLight3D = $HazeSpotlightC if has_node("HazeSpotlightC") else null

var _pulse_time: float = 0.0


func _ready() -> void:
	# Disable volumetric fog on Compatibility (mobile/WebGL) renderer --
	# only Forward+ and Mobile backends support it.
	if OS.has_feature("web"):
		var env: WorldEnvironment = get_node_or_null("WorldEnvironment")
		if env and env.environment:
			env.environment.volumetric_fog_enabled = false

	_generate_temple_collision()
	_connect_kill_plane()
	_setup_multiplayer_spawning()


func _process(delta: float) -> void:
	_pulse_time += delta
	if haze_spotlight_a:
		haze_spotlight_a.light_energy = 13.2 + sin(_pulse_time * 0.65) * 2.2
		haze_spotlight_a.rotation.y += delta * 0.09
	if haze_spotlight_b:
		haze_spotlight_b.light_energy = 10.5 + sin(_pulse_time * 0.72 + 1.1) * 1.6
		haze_spotlight_b.rotation.y -= delta * 0.07
	if haze_spotlight_c:
		haze_spotlight_c.light_energy = 8.3 + sin(_pulse_time * 0.58 + 2.4) * 1.1
		haze_spotlight_c.rotation.y += delta * 0.05


# ── Trimesh collision from temple model ──────────────────────────

## Walk all MeshInstance3D nodes under the temple and generate
## concave (trimesh) collision for each. This gives the player
## precise walkable surfaces — floors, steps, bridge deck, walls.
func _generate_temple_collision() -> void:
	var temple: Node = get_node_or_null("Temple")
	if not temple:
		push_error("Temple node not found — cannot generate collision!")
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


# ── Kill plane (void respawn) ────────────────────────────────────

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
		# Reset head pitch so the player isn't looking at the sky/floor on respawn.
		var head_node := body.get_node_or_null("Head")
		if head_node:
			head_node.rotation.x = 0.0
		if "_pitch" in body:
			body.set("_pitch", 0.0)


# ── Multiplayer spawning ─────────────────────────────────────────

## Set up multiplayer player spawning.
## Only the SERVER spawns players — for itself (triggered by main.gd) and for
## connecting peers. Clients receive their player via MultiplayerSpawner replication.
func _setup_multiplayer_spawning() -> void:
	var spawner: MultiplayerSpawner = $PlayerSpawner
	if not spawner:
		push_error("PlayerSpawner not found in CoreTruths scene!")
		return

	# Server listens for new peers to spawn their players.
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)


func _on_peer_connected(peer_id: int) -> void:
	if not multiplayer.is_server():
		return
	_spawn_player(peer_id)


func _on_peer_disconnected(peer_id: int) -> void:
	# Clean up the disconnected player's node on all peers.
	var spawner: MultiplayerSpawner = $PlayerSpawner
	if not spawner:
		return
	if spawner.has_node(str(peer_id)):
		var node := spawner.get_node(str(peer_id))
		node.queue_free()
		print("[CoreTruths] Cleaned up player for peer %d" % peer_id)


func _spawn_player(peer_id: int) -> void:
	var spawner: MultiplayerSpawner = $PlayerSpawner
	if not spawner:
		return
	if spawner.has_node(str(peer_id)):
		return
	var player := PLAYER_SCENE.instantiate()
	player.name = str(peer_id)
	# Start at spawn point, slightly above ground.
	player.set("global_position", SPAWN_POSITION)
	spawner.add_child(player)
	print("[CoreTruths] Spawned player for peer %d" % peer_id)
