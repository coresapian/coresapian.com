extends Control

## In-game chat widget -- floats over the game viewport.
## Connects to NetworkManager signals for multiplayer chat relay
## and to the World Chat WebSocket server for global chat.

## Emitted when a world chat message arrives from the WebSocket server.

signal world_chat_message_received(sender_name: String, text: String)

@onready var chat_panel: PanelContainer = $ChatPanel
@onready var message_log: RichTextLabel = $ChatPanel/VBox/MessageLog
@onready var input_field: LineEdit = $ChatPanel/VBox/InputField
@onready var toggle_button: Button = $ToggleButton

var _visible_in_game: bool = false
var _chat_history: Array[String] = []

const MAX_MESSAGES := 100
const CHAT_TOGGLE_KEY := KEY_SLASH


func _ready() -> void:
	input_field.placeholder_text = "Press / to chat..."
	input_field.visible = false
	chat_panel.visible = false
	toggle_button.text = "💬"
	toggle_button.tooltip_text = "Toggle Chat"
	toggle_button.pressed.connect(_toggle_chat)

	NetworkManager.chat_message_received.connect(_on_chat_message)
	NetworkManager.world_chat_message_received.connect(_on_world_chat_message)
	NetworkManager.player_connected.connect(_on_player_joined)
	NetworkManager.player_disconnected.connect(_on_player_left)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == CHAT_TOGGLE_KEY and not input_field.visible:
			_show_chat()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE and input_field.visible:
			_hide_chat()
			get_viewport().set_input_as_handled()


func _toggle_chat() -> void:
	if chat_panel.visible:
		_hide_chat()
	else:
		_show_chat()


func _show_chat() -> void:
	chat_panel.visible = true
	input_field.visible = true
	_visible_in_game = true
	input_field.grab_focus()
	# Release mouse from FPS capture while typing.
	if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)


func _hide_chat() -> void:
	input_field.visible = false
	input_field.release_focus()
	# Don't hide the panel if there are recent messages -- let them fade.
	# Re-capture mouse for FPS gameplay — but NOT if settings menu is open.
	if _is_settings_open():
		return
	if not _should_defer_mouse_capture():
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)


func _is_settings_open() -> bool:
	var player := _get_local_player_node()
	if player:
		var settings: Control = player.get_node_or_null("HUD/SettingsMenu")
		if settings and settings.has_method("is_open") and settings.is_open():
			return true
	return false


func _get_local_player_node() -> CharacterBody3D:
	var spawner := get_tree().root.find_child("PlayerSpawner", true, false)
	if spawner:
		for child in spawner.get_children():
			if child is CharacterBody3D and child.is_multiplayer_authority():
				return child as CharacterBody3D
	return null


func _should_defer_mouse_capture() -> bool:
	return OS.has_feature("web")


func is_chat_active() -> bool:
	return input_field.visible and input_field.has_focus()


#region -- Input handling --

func _on_input_field_text_submitted(text: String) -> void:
	if text.strip_edges().is_empty():
		_hide_chat()
		return

	# Check for commands
	if text.begins_with("/"):
		_handle_command(text)
	else:
		# Send via NetworkManager RPC to all peers.
		NetworkManager.send_chat_message(text)
		# Also relay to world chat WebSocket.
		NetworkManager.send_world_chat_message(text)

	input_field.text = ""
	_hide_chat()


func _handle_command(text: String) -> void:
	var parts := text.split(" ", false, 2)
	var cmd := parts[0].to_lower()

	match cmd:
		"/help":
			_add_system_message("Commands: /help, /players, /clear")
		"/players":
			var count := multiplayer.get_peers().size() + 1
			_add_system_message("%d player(s) online" % count)
		"/clear":
			message_log.clear()
			_chat_history.clear()
		_:
			_add_system_message("Unknown command: %s" % cmd)

	input_field.text = ""

#endregion


#region -- Message display --

func _on_chat_message(sender_name: String, text: String) -> void:
	_add_message(sender_name, text)


func _on_player_joined(peer_id: int) -> void:
	_add_system_message("Player %d joined" % peer_id)


func _on_player_left(peer_id: int) -> void:
	_add_system_message("Player %d left" % peer_id)


func _on_world_chat_message(sender: String, text: String) -> void:
	var formatted := "[color=#34d399][W] %s:[/color] %s" % [sender, text]
	message_log.append_bbcode(formatted + "\n")
	_auto_hide_after(4.0)


func _add_message(sender: String, text: String) -> void:
	var formatted := "[color=#22d3ee]%s:[/color] %s" % [sender, text]
	message_log.append_bbcode(formatted + "\n")
	_chat_history.append(formatted)
	if _chat_history.size() > MAX_MESSAGES:
		_chat_history.pop_front()
	_auto_hide_after(4.0)


func _auto_hide_after(delay: float) -> void:
	if chat_panel.visible:
		return
	chat_panel.visible = true
	get_tree().create_timer(delay).timeout.connect(func():
		if not input_field.has_focus():
			chat_panel.visible = _visible_in_game
	)


func _add_system_message(text: String) -> void:
	var formatted := "[color=#94a3b8][i]%s[/i][/color]" % text
	message_log.append_bbcode(formatted + "\n")

#endregion
