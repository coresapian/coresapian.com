extends Node

## ═══════════════════════════════════════════════════════════════════
## CORESAPIAN — Main Scene Controller
##
## This IS the entry point for coresapian.com.
## main.tscn is the project's main_scene — it instantiates the temple
## (core_truths.tscn) immediately, then handles multiplayer connection
## in the background. No separate lobby scene.
##
## Flow:
##   1. Temple + player spawn immediately (no black screen)
##   2. On web: auto-join wss://coresapian.com/ws/mp in background
##   3. On dedicated server: start server, no rendering
## ═══════════════════════════════════════════════════════════════════

const PLAYER_SCENE: PackedScene = preload("res://scenes/core_truths/player.tscn")

@onready var current_scene: Node = $Temple if has_node("Temple") else null

var _offline_label: Label = null
var _player_spawned: bool = false


func _ready() -> void:
	# ── Dedicated server mode ──
	if NetworkManager.is_dedicated_server:
		_start_dedicated_server()
		_spawn_local_player()
		return

	# ── Client / Web ──
	_setup_offline_indicator()

	if OS.has_feature("editor"):
		# Solo — spawn immediately, no MP connection
		_spawn_local_player()
	else:
		# Web/native client: connect to server.
		# If connection succeeds, the SERVER spawns our player via MultiplayerSpawner.
		# If connection fails, spawn solo as fallback.
		NetworkManager.connection_failed.connect(_on_connection_failed_spawn_solo)
		NetworkManager.connection_succeeded.connect(_on_connection_succeeded_spawn_player)
		_connect_to_server()


# ── Player spawning ──────────────────────────────────────────────

func _spawn_local_player() -> void:
	if _player_spawned:
		return
	var spawner: MultiplayerSpawner = get_node_or_null("Temple/PlayerSpawner") as MultiplayerSpawner
	if not spawner:
		push_error("[Main] PlayerSpawner not found!")
		return
	var peer_id := multiplayer.get_unique_id()
	if spawner.has_node(str(peer_id)):
		_player_spawned = true
		return
	var player := PLAYER_SCENE.instantiate()
	player.name = str(peer_id)
	spawner.add_child(player)
	_player_spawned = true
	print("[Main] Spawned local player (peer %d)" % peer_id)

func _on_connection_failed_spawn_solo() -> void:
	# Connection failed — spawn solo so the user can still explore.
	_spawn_local_player()

func _on_connection_succeeded_spawn_player() -> void:
	# Connection succeeded — ensure the local player is spawned.
	# The server should have spawned via MultiplayerSpawner, but verify.
	_spawn_local_player()


# ── Multiplayer ──────────────────────────────────────────────────

func _connect_to_server() -> void:
	# Skip auto-connect in the editor to avoid spamming the production server
	# during development. The game is still fully playable solo.
	if OS.has_feature("editor"):
		print("[Main] Skipping MP auto-connect in editor mode")
		return

	var server_ip := "coresapian.com"
	var server_port := 7000
	var player_name := "Player"

	# Read window.__GAME_CONFIG on web (injects server IP / port / name)
	if OS.has_feature("web"):
		var config := _read_web_config()
		if not config.is_empty():
			if config.has("serverIp"):
				server_ip = config["serverIp"]
			if config.has("serverPort"):
				server_port = int(config["serverPort"])
			if config.has("playerName"):
				player_name = config["playerName"]

	NetworkManager.player_name = player_name
	NetworkManager.join_game(server_ip, server_port, player_name)

func _read_web_config() -> Dictionary:
	if not OS.has_feature("web"):
		return {}
	var config_str: Variant = JavaScriptBridge.eval("JSON.stringify(window.__GAME_CONFIG || {})", true)
	if config_str == null or config_str == "":
		return {}
	var parsed: Variant = JSON.parse_string(config_str)
	if not (parsed is Dictionary):
		return {}
	return parsed

func _start_dedicated_server() -> void:
	var port := 7001
	var port_override := OS.get_environment("CORESAPIAN_SERVER_PORT")
	if not port_override.is_empty():
		port = int(port_override)
	NetworkManager.start_dedicated_server(port)
	print("Dedicated server mode on port %d" % port)


# ── Offline indicator ────────────────────────────────────────────

func _setup_offline_indicator() -> void:
	var layer := CanvasLayer.new()
	layer.name = "OfflineLayer"
	layer.layer = 5
	add_child(layer)

	_offline_label = Label.new()
	_offline_label.name = "OfflineLabel"
	_offline_label.text = "⚠  Offline — exploring solo"
	_offline_label.visible = false
	# Center-top banner with fixed size
	_offline_label.anchor_left = 0.5
	_offline_label.anchor_top = 0.0
	_offline_label.anchor_right = 0.5
	_offline_label.anchor_bottom = 0.0
	_offline_label.offset_left = -180
	_offline_label.offset_top = 16
	_offline_label.offset_right = 180
	_offline_label.offset_bottom = 56
	_offline_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_offline_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_offline_label.add_theme_font_size_override("font_size", 18)
	_offline_label.add_theme_color_override("font_color", Color(1, 0.85, 0.3, 0.9))
	var stylebox := StyleBoxFlat.new()
	stylebox.bg_color = Color(0.08, 0.06, 0.02, 0.75)
	stylebox.corner_radius_top_left = 8
	stylebox.corner_radius_top_right = 8
	stylebox.corner_radius_bottom_left = 8
	stylebox.corner_radius_bottom_right = 8
	stylebox.content_margin_left = 16.0
	stylebox.content_margin_right = 16.0
	stylebox.content_margin_top = 8.0
	stylebox.content_margin_bottom = 8.0
	_offline_label.add_theme_stylebox_override("normal", stylebox)
	layer.add_child(_offline_label)

	NetworkManager.connection_failed.connect(_on_connection_failed)
	NetworkManager.connection_succeeded.connect(_on_connection_succeeded)
	NetworkManager.server_disconnected.connect(_on_server_disconnected)


func _on_connection_failed() -> void:
	if _offline_label:
		_offline_label.visible = true
		print("[Main] MP connection failed — showing offline indicator")

func _on_connection_succeeded() -> void:
	if _offline_label:
		_offline_label.visible = false

func _on_server_disconnected() -> void:
	if _offline_label:
		_offline_label.visible = true
