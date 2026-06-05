extends Node

## ═══════════════════════════════════════════════════════════════════
## CORESAPIAN — Network Manager v2.0
##
## Manages multiplayer connections for the Coresapian world.
## Uses WebSocket transport (WebSocketMultiplayerPeer) for both web
## and native clients.
##
## Autoloaded singleton — access via NetworkManager globally.
## ═══════════════════════════════════════════════════════════════════

signal connection_succeeded
signal connection_failed
signal server_disconnected
signal player_connected(peer_id: int)
signal player_disconnected(peer_id: int)

## Emitted when the lobby scene should load the game world.
signal lobby_ready

const DEFAULT_PORT := 7000
const DEFAULT_SERVER_IP := "127.0.0.1"
const MAX_CONNECTIONS := 16

var player_name: String = "Player"

## True when running as a dedicated server (headless, no rendering).
var is_dedicated_server: bool = false


func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)


## Start a listen server (host plays + others can join).
## Uses WebSocket transport so browser clients can connect.
func host_game(port: int = DEFAULT_PORT, name: String = "Host") -> void:
	player_name = name
	var ws_peer := WebSocketMultiplayerPeer.new()
	var err := ws_peer.create_server(port, "0.0.0.0")
	if err != OK:
		push_error("Failed to host: %s" % err)
		connection_failed.emit()
		return

	multiplayer.multiplayer_peer = ws_peer
	is_dedicated_server = false
	print("WebSocket server started on port %d" % port)
	connection_succeeded.emit()
	player_connected.emit(1)  # The host is always peer 1


## Connect as a client to a remote server.
## Builds the WebSocket URL from the given host, using the standard
## /ws/enet nginx proxy path.
func join_game(host: String = DEFAULT_SERVER_IP, port: int = DEFAULT_PORT, name: String = "Player") -> void:
	player_name = name

	# Build WebSocket URL — TLS terminated by Cloudflare/nginx
	var ws_url := "wss://%s/ws/enet" % host
	print("Connecting via WebSocket: %s" % ws_url)
	var ws_peer := WebSocketMultiplayerPeer.new()
	var err := ws_peer.create_client(ws_url)
	if err != OK:
		push_error("WebSocket create_client failed: %s -- %s" % [ws_url, err])
		connection_failed.emit()
		return

	multiplayer.multiplayer_peer = ws_peer
	is_dedicated_server = false
	print("Connecting to %s:%d..." % [host, port])


## Start a dedicated (headless) server — no client, no rendering.
## Uses WebSocket transport so browser clients can connect via wss:// through nginx.
func start_dedicated_server(port: int = DEFAULT_PORT) -> void:
	var ws_peer := WebSocketMultiplayerPeer.new()
	# No TLS here — Cloudflare/nginx terminates TLS and forwards plain WS.
	var err := ws_peer.create_server(port, "0.0.0.0")
	if err != OK:
		push_error("Dedicated WS server failed to bind port %d: %s" % [port, err])
		return

	multiplayer.multiplayer_peer = ws_peer
	is_dedicated_server = true
	print("Dedicated WebSocket server started on port %d" % port)

	# Tell the scene manager to load the world immediately.
	lobby_ready.emit()


## Disconnect from the server / stop hosting.
func disconnect_network() -> void:
	if multiplayer.multiplayer_peer:
		multiplayer.multiplayer_peer.close()
	multiplayer.multiplayer_peer = null
	is_dedicated_server = false


func is_hosting() -> bool:
	return multiplayer.is_server()


func get_peer_id() -> int:
	return multiplayer.get_unique_id()


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
