extends Node

## Coresapian — main entry point.
## --server:  Start WebSocket server + load temple (host+play mode for testing)
## --client:  Connect to a WebSocket server
## Web:       Load temple, auto-connect to dedicated server (always-online, auto-retry)
## Server:    Bare WebSocket relay — no temple (avoids GDExtension crash on headless)
## (no args): Offline single-player (editor testing only)

const RECONNECT_DELAY := 3.0
const TEMPLE_PATH := "res://scenes/temple/temple.tscn"

var _reconnect_timer: float = 0.0
var _wants_reconnect: bool = false


func _ready() -> void:
	var args := OS.get_cmdline_args()
	if "--server" in args:
		print("[Main] Host mode — starting WS server on port 7000")
		_load_temple()
		_start_local_server()
	elif "--client" in args:
		var host := "127.0.0.1"
		var port := 7000
		var pname := "Player"
		for arg in args:
			if arg.begins_with("--host="):
				host = arg.split("=")[1]
			elif arg.begins_with("--port="):
				port = int(arg.split("=")[1])
			elif arg.begins_with("--name="):
				pname = arg.split("=")[1]
		print("[Main] Client mode — connecting to %s:%d as %s" % [host, port, pname])
		_load_temple()
		NetworkManager.join_game(host, port, pname)
	elif OS.get_environment("CORESAPIAN_SERVER_PORT").is_valid_int():
		# Dedicated server: bare relay, NO temple scene.
		# The ExpressoBits GDExtension crashes (SEGV) on Godot 4.6 headless Linux.
		# Player visibility is handled by the orbs relay (separate WebSocket on :8082).
		var port := int(OS.get_environment("CORESAPIAN_SERVER_PORT"))
		print("[Main] Dedicated server mode — bare relay on port %d" % port)
		NetworkManager.start_dedicated_server(port)
		# Wire peer tracking for logging
		multiplayer.peer_connected.connect(func(pid): print("[Server] Peer %d connected" % pid))
		multiplayer.peer_disconnected.connect(func(pid): print("[Server] Peer %d disconnected" % pid))
		return  # Skip temple, skip reconnect wiring — pure relay
	elif OS.has_feature("web"):
		print("[Main] Web mode — loading temple + connecting to dedicated server...")
		_load_temple()
		_connect_to_web_server()
	else:
		print("[Main] Offline / single-player mode")
		_load_temple()

	# Wire auto-retry for web always-online design
	NetworkManager.connection_failed.connect(_on_connection_failed)
	NetworkManager.connection_succeeded.connect(_on_connection_succeeded)
	NetworkManager.server_disconnected.connect(_on_server_disconnected)


func _process(_delta: float) -> void:
	if _wants_reconnect:
		_reconnect_timer -= _delta
		if _reconnect_timer <= 0.0:
			_wants_reconnect = false
			_connect_to_web_server()


func _load_temple() -> void:
	var temple_scene: PackedScene = load(TEMPLE_PATH) as PackedScene
	if temple_scene:
		var temple: Node = temple_scene.instantiate()
		add_child(temple)
	else:
		push_error("[Main] Failed to load temple scene")


func _connect_to_web_server() -> void:
	_show_connecting_banner(true)
	var host := "coresapian.com"
	if OS.has_feature("web"):
		var eval_host: Variant = JavaScriptBridge.eval("location.hostname", true)
		if eval_host != null and str(eval_host) != "":
			host = str(eval_host)
	print("[Main] Connecting to dedicated server at %s..." % host)
	NetworkManager.join_game(host, 0, "Player")


func _on_connection_succeeded() -> void:
	_show_connecting_banner(false)
	print("[Main] Connected to server!")


func _on_connection_failed() -> void:
	if not OS.has_feature("web"):
		return
	print("[Main] Connection failed — retrying in %ds..." % int(RECONNECT_DELAY))
	_wants_reconnect = true
	_reconnect_timer = RECONNECT_DELAY


func _on_server_disconnected() -> void:
	if not OS.has_feature("web"):
		return
	print("[Main] Server disconnected — retrying in %ds..." % int(RECONNECT_DELAY))
	_show_connecting_banner(true)
	_wants_reconnect = true
	_reconnect_timer = RECONNECT_DELAY


## Show/hide a fixed-position "Connecting to server..." banner via the DOM.
func _show_connecting_banner(visible: bool) -> void:
	if not OS.has_feature("web"):
		return
	var js := ""
	if visible:
		js = """
var el = document.getElementById('mp-banner');
if (!el) {
	el = document.createElement('div');
	el.id = 'mp-banner';
	el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(255,140,0,0.92);color:#1a1a2e;text-align:center;padding:6px 12px;font-family:\"Share Tech Mono\",monospace;font-size:13px;letter-spacing:1px;pointer-events:none;';
	el.textContent = '⟁ CONNECTING TO SERVER...';
	document.body.appendChild(el);
}
"""
	else:
		js = """
var el = document.getElementById('mp-banner');
if (el) el.remove();
"""
	JavaScriptBridge.eval(js, true)


func _start_local_server() -> void:
	# Start as multiplayer server (NOT dedicated — we still render)
	var ws_peer := WebSocketMultiplayerPeer.new()
	var err := ws_peer.create_server(7000, "0.0.0.0")
	if err != OK:
		push_error("[Main] Failed to start WS server on port 7000: %s" % err)
		return
	multiplayer.multiplayer_peer = ws_peer
	NetworkManager.is_dedicated_server = false
	print("[Main] WebSocket server listening on port 7000")
	await get_tree().create_timer(0.1).timeout
	_spawn_server_player()


func _spawn_server_player() -> void:
	var temple: Node = get_node_or_null("Temple")
	if temple and temple.has_method("_spawn_player"):
		temple._spawn_player(1)
