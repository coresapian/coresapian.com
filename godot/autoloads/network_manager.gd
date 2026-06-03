extends Node

## Manages ENet multiplayer connections for the Coresapian world.
## Works as both a client and a dedicated server.
## Autoloaded singleton -- access via NetworkManager globally.

signal connection_succeeded
signal connection_failed
signal server_disconnected
signal player_connected(peer_id: int)
signal player_disconnected(peer_id: int)

## Emitted when the lobby scene should load the game world.
signal lobby_ready

signal chat_message_received(sender_name: String, text: String)
signal world_chat_message_received(sender_name: String, text: String)

const DEFAULT_PORT := 7000
const DEFAULT_SERVER_IP := "127.0.0.1"
const MAX_CONNECTIONS := 16
const WORLD_CHAT_WS_URL := "wss://coresapian.com/ws/world-chat"

var peer: ENetMultiplayerPeer = null
var player_name: String = "Player"

## True when running as a dedicated server (headless, no rendering).
var is_dedicated_server: bool = false

## World Chat WebSocket client (connects from game client).
var _ws_client: WebSocketPeer = null
var _ws_connected: bool = false
var _ws_reconnect_timer: float = 0.0
var _ws_disconnect_logged: bool = false
var _ws_retry_count: int = 0
var _ws_gave_up: bool = false


func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)

	# Connect to World Chat WebSocket if we're a client (not dedicated server)
	if not OS.has_feature("dedicated_server"):
		_load_world_chat_api_key()
		if OS.has_feature("web"):
			_connect_world_chat()
		elif not _world_chat_api_key.is_empty():
			_connect_world_chat()


func _process(delta: float) -> void:
	_poll_world_chat(delta)


## Start a listen server (host plays + others can join).
func host_game(port: int = DEFAULT_PORT, name: String = "Host") -> void:
	player_name = name
	peer = ENetMultiplayerPeer.new()
	var err := peer.create_server(port, MAX_CONNECTIONS)
	if err != OK:
		push_error("Failed to host: %s" % err)
		connection_failed.emit()
		return

	multiplayer.multiplayer_peer = peer
	is_dedicated_server = false
	print("Server started on port %d" % port)
	connection_succeeded.emit()
	player_connected.emit(1)  # The host is always peer 1


## Connect as a client to a remote server.
const ENET_WS_PATH := "/ws/enet"


func join_game(ip: String = DEFAULT_SERVER_IP, port: int = DEFAULT_PORT, name: String = "Player") -> void:
	player_name = name

	var err: int
	if OS.has_feature("web"):
		# Browser builds MUST use WebSocketMultiplayerPeer (ENet doesn't speak WS).
		# Connect to port 443 through Cloudflare/nginx which proxies /ws/enet -> relay.
		var ws_url := "wss://%s%s" % [ip, ENET_WS_PATH]
		print("Web client connecting via WebSocket: %s" % ws_url)
		var ws_peer := WebSocketMultiplayerPeer.new()
		err = ws_peer.create_client(ws_url)
		if err == OK:
			multiplayer.multiplayer_peer = ws_peer
			peer = null  # Not using ENet peer for WS client
		else:
			push_error("WebSocket create_client failed: %s -- %s" % [ws_url, err])
			connection_failed.emit()
			return
	else:
		peer = ENetMultiplayerPeer.new()
		err = peer.create_client(ip, port)
		if err != OK:
			push_error("Failed to connect to %s:%d -- %s" % [ip, port, err])
			connection_failed.emit()
			return
		multiplayer.multiplayer_peer = peer

	is_dedicated_server = false
	print("Connecting to %s:%d..." % [ip, port])


## Start a dedicated (headless) server -- no client, no rendering.
## Uses WebSocket transport so browser clients can connect via wss:// through nginx.
func start_dedicated_server(port: int = DEFAULT_PORT) -> void:
	var ws_peer := WebSocketMultiplayerPeer.new()
	# No TLS here -- Cloudflare/nginx terminates TLS and forwards plain WS.
	var err := ws_peer.create_server(port)
	if err != OK:
		push_error("Dedicated WS server failed to bind port %d: %s" % [port, err])
		return

	multiplayer.multiplayer_peer = ws_peer
	peer = null  # Not using ENet peer for WS server
	is_dedicated_server = true
	print("Dedicated WebSocket server started on port %d" % port)

	# Tell the scene manager to load the world immediately.
	lobby_ready.emit()


func disconnect_network() -> void:
	if peer:
		peer.close()
		peer = null
	multiplayer.multiplayer_peer = null
	is_dedicated_server = false
	_disconnect_world_chat()


func is_hosting() -> bool:
	return multiplayer.is_server()


func get_peer_id() -> int:
	return multiplayer.get_unique_id()


## Send a chat message from this client to all peers via ENet RPC.
@rpc("any_peer", "call_remote", "reliable")
func send_chat_message(text: String) -> void:
	var sender_id := multiplayer.get_remote_sender_id()
	receive_chat_message.rpc(sender_id, text)


@rpc("authority", "call_remote", "reliable")
func receive_chat_message(sender_id: int, text: String) -> void:
	var name: String = str(sender_id)
	if sender_id == 1:
		name = player_name
	chat_message_received.emit(name, text)


# ── World Chat WebSocket ─────────────────────────────────────────

# API key is loaded at runtime -- never hardcoded in the build.
# Web builds: from window.__GAME_CONFIG.worldChatApiKey (set in HTML shell).
# Native builds: from CORESAPIAN_WORLD_CHAT_API_KEY env var.
# Dedicated server: no chat (headless).
var _world_chat_api_key: String = ""
const WORLD_CHAT_USERNAME := "GodotClient"
const WS_RECONNECT_BASE_INTERVAL := 5.0
const WS_MAX_RETRIES := 10


func _load_world_chat_api_key() -> void:
	if OS.has_feature("web"):
		var config_str: Variant = JavaScriptBridge.eval("JSON.stringify(window.__GAME_CONFIG || {})", true)
		if config_str is String and config_str != "":
			var config: Variant = JSON.parse_string(config_str)
			if config is Dictionary:
				_world_chat_api_key = str(config.get("worldChatApiKey", ""))
	elif not OS.has_feature("dedicated_server"):
		_world_chat_api_key = OS.get_environment("CORESAPIAN_WORLD_CHAT_API_KEY")


func _ws_url() -> String:
	var params := "?username=%s" % WORLD_CHAT_USERNAME
	if not _world_chat_api_key.is_empty():
		params += "&api_key=%s" % _world_chat_api_key
	return WORLD_CHAT_WS_URL + params

func _connect_world_chat() -> void:
	if _ws_client:
		return
	_ws_client = WebSocketPeer.new()
	var url := _ws_url()
	var err := _ws_client.connect_to_url(url)
	if err != OK:
		push_warning("Failed to connect World Chat WS: %s" % err)
		_ws_client = null
		return
	# Only log on first attempt, and NEVER log the URL (contains API key).
	if not _ws_disconnect_logged:
		print("Connecting to World Chat WS...")


func _disconnect_world_chat() -> void:
	if _ws_client:
		_ws_client.close()
		_ws_client = null
	_ws_connected = false
	_ws_retry_count = 0
	_ws_gave_up = false


func _poll_world_chat(delta: float) -> void:
	if _ws_gave_up:
		return
	if not _ws_client:
		# Try reconnecting after disconnection (with exponential backoff)
		if not _ws_connected:
			_ws_reconnect_timer += delta
			var backoff := WS_RECONNECT_BASE_INTERVAL * (1.0 + 0.5 * _ws_retry_count)
			backoff = minf(backoff, 60.0)  # cap at 60 seconds
			if _ws_reconnect_timer >= backoff:
				_ws_reconnect_timer = 0.0
				if _ws_retry_count >= WS_MAX_RETRIES:
					push_warning("World Chat WS: gave up after %d retries" % WS_MAX_RETRIES)
					_ws_gave_up = true
					return
				_ws_retry_count += 1
				_connect_world_chat()
		return

	_ws_client.poll()
	var state := _ws_client.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		_ws_connected = true
		_ws_retry_count = 0
		_ws_reconnect_timer = 0.0
		# Read incoming messages.
		while _ws_client.get_available_packet_count() > 0:
			var packet := _ws_client.get_packet()
			if _ws_client.was_string_packet():
				_handle_world_chat_message(packet.get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED:
		if _ws_connected or not _ws_disconnect_logged:
			print("World Chat WS disconnected, will reconnect... (attempt %d/%d)" % [_ws_retry_count + 1, WS_MAX_RETRIES])
			_ws_disconnect_logged = true
		_ws_connected = false
		_ws_client = null


func _handle_world_chat_message(raw: String) -> void:
	# World chat sends JSON: {"type":"message","user":"name","text":"hello"}
	var json := JSON.new()
	if json.parse(raw) != OK:
		return
	var data: Dictionary = json.data
	if data.get("type") == "message":
		var sender: String = data.get("user", "Unknown")
		var text: String = data.get("text", "")
		world_chat_message_received.emit(sender, text)


## Send a message to the World Chat WebSocket server.
func send_world_chat_message(text: String) -> void:
	if _ws_client and _ws_client.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var msg := JSON.stringify({"type": "message", "text": text, "user": player_name})
		_ws_client.send_text(msg)


# ── Internal callbacks ──────────────────────────────────────────

func _on_peer_connected(peer_id: int) -> void:
	print("Player %d connected" % peer_id)
	player_connected.emit(peer_id)


func _on_peer_disconnected(peer_id: int) -> void:
	print("Player %d disconnected" % peer_id)
	player_disconnected.emit(peer_id)


func _on_connection_failed() -> void:
	push_error("Connection failed")
	connection_failed.emit()


func _on_server_disconnected() -> void:
	push_warning("Server disconnected")
	server_disconnected.emit()
