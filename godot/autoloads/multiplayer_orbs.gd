## Multiplayer Orbs Client (autoload)
##
## WebSocket connection to the relay server. Sends local player position at 20Hz,
## receives remote positions, spawns PlayerOrb instances with smooth interpolation.
##
## Uses raw WebSocketPeer — NOT Godot's high-level multiplayer.
## The existing NetworkManager (WebSocketMultiplayerPeer) is separate and unaffected.
extends Node

signal connected
signal disconnected
signal player_joined(id: String)
signal player_left(id: String)
signal player_count_changed(count: int)

@export var server_url: String = ""
@export var send_rate_hz: float = 20.0
@export var interpolation_speed: float = 12.0

var _socket: WebSocketPeer = null
var _connected: bool = false
var _my_id: String = ""
var _send_timer: float = 0.0
var _send_interval: float = 0.05
var _remote_players: Dictionary = {}
var _reconnect_timer: float = 0.0
var _wants_reconnect: bool = false

var _local_player: CharacterBody3D = null
var _local_head: Node3D = null

var _send_msg: Dictionary = {
	"type": "pos", "x": 0.0, "y": 0.0, "z": 0.0, "ry": 0.0, "rx": 0.0,
}

const _STALE_TIMEOUT: float = 5.0
const _RECONNECT_DELAY: float = 3.0


func _ready() -> void:
	_send_interval = 1.0 / send_rate_hz
	_socket = WebSocketPeer.new()

	if server_url == "":
		if OS.has_feature("web"):
			var js_url: Variant = JavaScriptBridge.eval("window.__MP_SERVER_URL || ''")
			if js_url != null and js_url != "":
				server_url = str(js_url)
			else:
				var host := str(JavaScriptBridge.eval("location.hostname"))
				server_url = "wss://%s/ws/mp" % host if host != "" else "ws://localhost:8082"
		else:
			server_url = "ws://localhost:8082"

	_do_connect()


func _process(delta: float) -> void:
	if _socket == null:
		return

	if _wants_reconnect:
		_reconnect_timer -= delta
		if _reconnect_timer <= 0.0:
			_wants_reconnect = false
			_do_connect()
		return

	_socket.poll()
	var state := _socket.get_ready_state()

	if not _connected and state == WebSocketPeer.STATE_OPEN:
		_connected = true
		connected.emit()

	if _connected and state == WebSocketPeer.STATE_CLOSED:
		_handle_disconnect()
		return

	if state == WebSocketPeer.STATE_CONNECTING:
		return

	while _socket.get_available_packet_count() > 0:
		_on_packet_received(_socket.get_packet().get_string_from_utf8())

	_send_timer += delta
	if _send_timer >= _send_interval:
		_send_timer = 0.0
		_send_position()

	var now := Time.get_ticks_msec() / 1000.0
	var stale: Array[String] = []

	for id in _remote_players:
		var entry: Dictionary = _remote_players[id]
		var orb: PlayerOrb = entry["orb"]
		orb.target_position = entry["target_pos"]
		orb.target_rot_y = entry["target_rot_y"]
		orb.target_rot_x = entry["target_rot_x"]
		if now - entry["last_update"] > _STALE_TIMEOUT:
			stale.append(id)

	for id in stale:
		_remove_player_orb(id)
		player_left.emit(id)
		player_count_changed.emit(get_player_count())


# ── Connection ───────────────────────────────────────────────────────

func _do_connect() -> void:
	_connected = false
	var err := _socket.connect_to_url(server_url)
	if err != OK:
		_schedule_reconnect()


func _handle_disconnect() -> void:
	_connected = false
	disconnected.emit()
	for id in _remote_players.keys():
		_remove_player_orb(id)
		player_left.emit(id)
	player_count_changed.emit(0)
	_schedule_reconnect()
	_local_player = null
	_local_head = null


func _schedule_reconnect() -> void:
	_wants_reconnect = true
	_reconnect_timer = _RECONNECT_DELAY


# ── Sending ──────────────────────────────────────────────────────────

func _send_position() -> void:
	if not _connected:
		return

	if _local_player == null or not is_instance_valid(_local_player):
		var nodes := get_tree().get_nodes_in_group("player")
		if nodes.is_empty():
			return
		_local_player = nodes[0] as CharacterBody3D
		_local_head = null

	var pos := _local_player.global_position
	_send_msg["x"] = pos.x
	_send_msg["y"] = pos.y
	_send_msg["z"] = pos.z
	_send_msg["ry"] = _local_player.rotation.y

	if _local_head == null or not is_instance_valid(_local_head):
		_local_head = _local_player.get_node_or_null("Head")
	_send_msg["rx"] = _local_head.rotation.x if _local_head else 0.0

	_socket.send_text(JSON.stringify(_send_msg))


# ── Receiving ────────────────────────────────────────────────────────

func _on_packet_received(json_string: String) -> void:
	var json := JSON.new()
	if json.parse(json_string) != OK:
		return
	var data: Variant = json.data
	if data == null or not data is Dictionary:
		return

	var msg: Dictionary = data
	match str(msg.get("type", "")):
		"init":
			_my_id = str(msg.get("id", _my_id))

		"join":
			var id := str(msg.get("id", ""))
			if id == "" or id == _my_id or _remote_players.has(id):
				return
			_create_and_register_orb(id)
			player_joined.emit(id)
			player_count_changed.emit(get_player_count())

		"leave":
			var id := str(msg.get("id", ""))
			if not _remote_players.has(id):
				return
			_remove_player_orb(id)
			player_left.emit(id)
			player_count_changed.emit(get_player_count())

		"pos":
			var id := str(msg.get("id", ""))
			if not _remote_players.has(id):
				return
			var entry: Dictionary = _remote_players[id]
			entry["target_pos"] = Vector3(
				float(msg.get("x", 0.0)),
				float(msg.get("y", 0.0)),
				float(msg.get("z", 0.0))
			)
			entry["target_rot_y"] = float(msg.get("ry", 0.0))
			entry["target_rot_x"] = float(msg.get("rx", 0.0))
			entry["last_update"] = Time.get_ticks_msec() / 1000.0


# ── Orb Management ───────────────────────────────────────────────────

func _create_and_register_orb(id: String) -> void:
	var orb := PlayerOrb.new()
	orb.player_id = id
	orb.name = "PlayerOrb_%s" % id
	orb.interpolation_speed = interpolation_speed

	var scene := get_tree().current_scene
	if scene == null:
		var children := get_tree().root.get_children()
		if children.size() > 0:
			scene = children[children.size() - 1]
	if scene == null:
		orb.queue_free()
		return
	scene.add_child(orb)

	_remote_players[id] = {
		"orb": orb,
		"target_pos": Vector3.ZERO,
		"target_rot_y": 0.0,
		"target_rot_x": 0.0,
		"last_update": Time.get_ticks_msec() / 1000.0,
	}


func _remove_player_orb(id: String) -> void:
	var entry: Dictionary = _remote_players.get(id, {})
	if entry.is_empty():
		return
	var orb: PlayerOrb = entry["orb"]
	if orb and is_instance_valid(orb):
		orb.queue_free()
	_remote_players.erase(id)


# ── Public API ───────────────────────────────────────────────────────

func get_player_count() -> int:
	return _remote_players.size()

func is_connected_to_server() -> bool:
	return _connected

func get_my_id() -> String:
	return _my_id
