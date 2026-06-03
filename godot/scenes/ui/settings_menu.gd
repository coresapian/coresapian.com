extends Control

## In-game settings panel — mouse/audio/display controls.
## Opens with F1 key or via the gear button. Releases mouse capture
## while open so the user can click sliders and buttons.

signal settings_closed

@onready var panel: PanelContainer = $SettingsPanel
@onready var master_vol: HSlider = $SettingsPanel/VBox/MasterVolBox/HSlider
@onready var music_vol: HSlider = $SettingsPanel/VBox/MusicVolBox/HSlider
@onready var sfx_vol: HSlider = $SettingsPanel/VBox/SFXVolBox/HSlider
@onready var sensitivity_slider: HSlider = $SettingsPanel/VBox/SensitivityBox/HSlider
@onready var sensitivity_label: Label = $SettingsPanel/VBox/SensitivityBox/ValueLabel
@onready var fullscreen_check: CheckBox = $SettingsPanel/VBox/DisplayBox/FullscreenCheck
@onready var close_button: Button = $SettingsPanel/VBox/Header/CloseButton

var _is_open: bool = false


func _ready() -> void:
	visible = false
	_load_settings()
	close_button.pressed.connect(_close)
	# Click dimmer to close settings
	var dimmer: ColorRect = $Dimmer
	dimmer.gui_input.connect(_on_dimmer_input)
	master_vol.value_changed.connect(_on_master_vol_changed)
	music_vol.value_changed.connect(_on_music_vol_changed)
	sfx_vol.value_changed.connect(_on_sfx_vol_changed)
	sensitivity_slider.value_changed.connect(_on_sensitivity_changed)
	fullscreen_check.toggled.connect(_on_fullscreen_toggled)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		# F1 opens settings — works even with captured mouse.
		# KEY_S is NOT used because it conflicts with move_backward (WASD).
		if event.keycode == KEY_F1 and not _is_open:
			open()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE and _is_open:
			_close()
			get_viewport().set_input_as_handled()


func is_open() -> bool:
	return _is_open


func open() -> void:
	if _is_open:
		return
	_is_open = true
	visible = true
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	# Pause player input processing so mouse movements don't rotate camera
	_pause_player_input(true)


func _close() -> void:
	if not _is_open:
		return
	_is_open = false
	visible = false
	_save_settings()
	settings_closed.emit()
	# Re-capture mouse only if no other UI overlay is active
	_pause_player_input(false)
	if not _any_ui_open():
		if not _should_defer_mouse_capture():
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)


func _on_dimmer_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		_close()


func _pause_player_input(pause: bool) -> void:
	var player := _get_local_player()
	if player:
		player.set_process_unhandled_input(not pause)


func _any_ui_open() -> bool:
	# Check if chat input is focused (chat is in "typing" mode)
	var player := _get_local_player()
	if player:
		var chat: Control = player.get_node_or_null("HUD/ChatWidget")
		if chat and chat.has_method("is_chat_active") and chat.is_chat_active():
			return true
	# Check browser overlay
	if OS.has_feature("web"):
		var js_result = JavaScriptBridge.eval("window.__coresapianIsBrowserOpen && window.__coresapianIsBrowserOpen()")
		if js_result:
			return true
	return false


func _should_defer_mouse_capture() -> bool:
	return OS.has_feature("web")


# ── Settings persistence ──────────────────────────────────────

func _load_settings() -> void:
	var config := ConfigFile.new()
	var err := config.load("user://settings.cfg")
	if err != OK:
		# Defaults
		master_vol.value = 1.0
		music_vol.value = 0.7
		sfx_vol.value = 1.0
		sensitivity_slider.value = 0.0022
		fullscreen_check.button_pressed = false
		return

	master_vol.value = config.get_value("audio", "master", 1.0)
	music_vol.value = config.get_value("audio", "music", 0.7)
	sfx_vol.value = config.get_value("audio", "sfx", 1.0)
	sensitivity_slider.value = config.get_value("input", "mouse_sensitivity", 0.0022)
	fullscreen_check.button_pressed = config.get_value("display", "fullscreen", false)
	_apply_settings()


func _save_settings() -> void:
	var config := ConfigFile.new()
	config.set_value("audio", "master", master_vol.value)
	config.set_value("audio", "music", music_vol.value)
	config.set_value("audio", "sfx", sfx_vol.value)
	config.set_value("input", "mouse_sensitivity", sensitivity_slider.value)
	config.set_value("display", "fullscreen", fullscreen_check.button_pressed)
	config.save("user://settings.cfg")


func _apply_settings() -> void:
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("Master"), linear_to_db(master_vol.value))
	_on_sensitivity_changed(sensitivity_slider.value)
	if fullscreen_check.button_pressed:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)


func _on_master_vol_changed(value: float) -> void:
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("Master"), linear_to_db(value))


func _on_music_vol_changed(value: float) -> void:
	var bus_idx := AudioServer.get_bus_index("Music")
	if bus_idx >= 0:
		AudioServer.set_bus_volume_db(bus_idx, linear_to_db(value))


func _on_sfx_vol_changed(value: float) -> void:
	var bus_idx := AudioServer.get_bus_index("SFX")
	if bus_idx >= 0:
		AudioServer.set_bus_volume_db(bus_idx, linear_to_db(value))


func _on_sensitivity_changed(value: float) -> void:
	sensitivity_label.text = "%.2f" % (value * 1000.0)
	# Apply to player controller if it exists
	var player := _get_local_player()
	if player and player.has_method("set_mouse_sensitivity"):
		player.set_mouse_sensitivity(value)


func _on_fullscreen_toggled(pressed: bool) -> void:
	if pressed:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)


func _get_local_player() -> CharacterBody3D:
	# Walk the tree to find the PlayerSpawner node
	var spawner := get_tree().root.find_child("PlayerSpawner", true, false) as MultiplayerSpawner
	if spawner:
		for child in spawner.get_children():
			if child is CharacterBody3D and child.is_multiplayer_authority():
				return child as CharacterBody3D
	return null
