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
##   2. On web: auto-join wss://coresapian.com/ws/enet in background
##   3. On dedicated server: start server, no rendering
## ═══════════════════════════════════════════════════════════════════

@export var fade_in_duration: float = 1.2
@export var fade_out_duration: float = 0.8

@onready var fade_rect: ColorRect = $FadeCanvasLayer/FadeOverlay if has_node("FadeCanvasLayer/FadeOverlay") else null
@onready var current_scene: Node = $Temple if has_node("Temple") else null

var _offline_label: Label = null


func _ready() -> void:
	# ── Dedicated server mode ──
	if NetworkManager.is_dedicated_server:
		if fade_rect:
			fade_rect.visible = false
		var fade_layer = $FadeCanvasLayer if has_node("FadeCanvasLayer") else null
		if fade_layer:
			fade_layer.queue_free()
		_setup_world_signals()
		_start_dedicated_server()
		return

	# ── Client / Web ──
	_setup_world_signals()
	_setup_offline_indicator()
	_connect_to_server()

	# Fade in the temple
	if fade_rect:
		fade_rect.color = Color(0, 0, 0, 1)
		var fade_in := create_tween()
		fade_in.tween_property(fade_rect, "color:a", 0.0, fade_in_duration)


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
	_offline_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_offline_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
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
	_offline_label.position = Vector2(0, 16)
	_offline_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
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


# ── World signals ────────────────────────────────────────────────

func _setup_world_signals() -> void:
	if current_scene and current_scene.has_signal("experience_completed"):
		current_scene.experience_completed.connect(_on_experience_completed)


func _on_experience_completed() -> void:
	if NetworkManager.is_dedicated_server:
		return
	if not fade_rect:
		return
	var fade_out := create_tween()
	fade_out.tween_property(fade_rect, "color:a", 1.0, fade_out_duration)
