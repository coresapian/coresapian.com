extends Control

## Lobby scene -- the entry point for the Coresapian multiplayer world.
## On web: auto-joins dedicated server, no UI shown.
## On native: shows Host/Join lobby.

@onready var ip_line_edit: LineEdit = $VBoxContainer/IPContainer/IPAddress
@onready var port_line_edit: LineEdit = $VBoxContainer/IPContainer/Port
@onready var name_line_edit: LineEdit = $VBoxContainer/IPContainer/PlayerName
@onready var host_button: Button = $VBoxContainer/Buttons/HostButton
@onready var join_button: Button = $VBoxContainer/Buttons/JoinButton
@onready var status_label: Label = $VBoxContainer/StatusLabel
@onready var player_list_label: Label = $VBoxContainer/PlayerList
@onready var lobby_root: Control = $VBoxContainer

var _peer_count: int = 0


func _ready() -> void:
	# Connect signals
	NetworkManager.connection_succeeded.connect(_on_connected)
	NetworkManager.connection_failed.connect(_on_connection_failed)
	NetworkManager.server_disconnected.connect(_on_server_disconnected)
	NetworkManager.player_connected.connect(_on_player_connected)
	NetworkManager.player_disconnected.connect(_on_player_disconnected)
	NetworkManager.lobby_ready.connect(_enter_game)

	# Dedicated server mode
	if OS.has_feature("dedicated_server"):
		_start_dedicated_server()
		return

	# ── WEB: hide entire lobby, auto-join server ──
	if OS.has_feature("web"):
		lobby_root.visible = false
		_load_web_config()
		_auto_join_server()
		return

	# ── NATIVE: show lobby UI ──
	port_line_edit.text = str(NetworkManager.DEFAULT_PORT)
	name_line_edit.text = NetworkManager.player_name
	host_button.pressed.connect(_on_host_pressed)
	join_button.pressed.connect(_on_join_pressed)


func _load_web_config() -> void:
	if not OS.has_feature("web"):
		return

	var config_str := JavaScriptBridge.eval("JSON.stringify(window.__GAME_CONFIG || {})", true)
	if config_str == null or config_str == "":
		return

	var config: Variant = JSON.parse_string(config_str)
	if not (config is Dictionary):
		return

	var ip_val: String = config.get("serverIp", "")
	if not ip_val.is_empty():
		ip_line_edit.text = ip_val

	var port_val: int = config.get("serverPort", 0)
	if port_val > 0:
		port_line_edit.text = str(port_val)

	var name_val: String = config.get("playerName", "")
	if not name_val.is_empty():
		name_line_edit.text = name_val
		NetworkManager.player_name = name_val


func _auto_join_server() -> void:
	var ip := ip_line_edit.text.strip_edges()
	if ip.is_empty():
		ip = "coresapian.com"
	var port := int(port_line_edit.text) if not port_line_edit.text.is_empty() else 7000
	var name := name_line_edit.text.strip_edges()
	if name.is_empty():
		name = "Player"
	NetworkManager.player_name = name
	NetworkManager.join_game(ip, port, name)


func _on_host_pressed() -> void:
	var port := int(port_line_edit.text)
	var name := name_line_edit.text.strip_edges()
	if name.is_empty():
		name = "Host"
	NetworkManager.player_name = name
	NetworkManager.host_game(port, name)
	status_label.text = "Starting server..."


func _on_join_pressed() -> void:
	var ip := ip_line_edit.text.strip_edges()
	var port := int(port_line_edit.text)
	var name := name_line_edit.text.strip_edges()
	if name.is_empty():
		name = "Player"
	if ip.is_empty():
		ip = NetworkManager.DEFAULT_SERVER_IP
	NetworkManager.player_name = name
	NetworkManager.join_game(ip, port, name)
	status_label.text = "Connecting to %s:%d..." % [ip, port]


func _start_dedicated_server() -> void:
	# Dedicated server binds on 7001 so the ENet-WS relay can listen on 7000 and bridge to us.
	var default_port := 7001
	var port_override := OS.get_environment("CORESAPIAN_SERVER_PORT")
	if not port_override.is_empty():
		default_port = int(port_override)
	var port := int(port_line_edit.text) if not port_line_edit.text.is_empty() else default_port
	NetworkManager.start_dedicated_server(port)
	print("Dedicated server mode on port %d -- no UI" % port)


func _on_connected() -> void:
	_enter_game()


func _on_connection_failed() -> void:
	if OS.has_feature("web"):
		# Fallback — load the temple single-player.
		# Use call_deferred to avoid "busy removing children" error during scene transition.
		_enter_game.call_deferred()


func _on_server_disconnected() -> void:
	if OS.has_feature("web"):
		return
	get_tree().change_scene_to_file("res://scenes/lobby.tscn")


func _on_player_connected(_peer_id: int) -> void:
	_peer_count += 1
	_refresh_player_list()
	if not NetworkManager.is_dedicated_server:
		status_label.text = "Player joined. (%d connected)" % _peer_count


func _on_player_disconnected(_peer_id: int) -> void:
	_peer_count = maxi(0, _peer_count - 1)
	_refresh_player_list()
	if not NetworkManager.is_dedicated_server:
		status_label.text = "Player left. (%d connected)" % _peer_count


func _refresh_player_list() -> void:
	player_list_label.text = "Players online: %d / %d" % [_peer_count, 16]


func _enter_game() -> void:
	get_tree().change_scene_to_file("res://scenes/main.tscn")
