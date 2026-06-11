extends Node

## Coresapian — main entry point.
## --server:  Start WebSocket server + load temple (host+play mode for testing)
## --client:  Connect to a WebSocket server
## (no args): Offline single-player

func _ready() -> void:
	var args := OS.get_cmdline_args()
	if "--server" in args:
		print("[Main] Host mode — starting WS server on port 7000")
		_start_local_server()
	elif "--client" in args:
		var host := "127.0.0.1"
		var port := 7000
		var name := "Player"
		for arg in args:
			if arg.begins_with("--host="):
				host = arg.split("=")[1]
			elif arg.begins_with("--port="):
				port = int(arg.split("=")[1])
			elif arg.begins_with("--name="):
				name = arg.split("=")[1]
		print("[Main] Client mode — connecting to %s:%d as %s" % [host, port, name])
		NetworkManager.join_game(host, port, name)
	else:
		print("[Main] Offline / single-player mode")
		# temple.tscn spawns a local player via _spawn_local_player()


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
	# Server player (peer 1) will be spawned by temple.gd when first client connects
	# OR we spawn it immediately:
	await get_tree().create_timer(0.1).timeout
	# Signal temple to spawn server's own player
	_spawn_server_player()


func _spawn_server_player() -> void:
	var temple = get_node_or_null("Temple")
	if temple and temple.has_method("_spawn_player"):
		temple._spawn_player(1)
