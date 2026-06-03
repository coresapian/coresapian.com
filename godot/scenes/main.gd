extends Node

## Scene host -- loads the CoreTruths world with fade-in/fade-out.
## In multiplayer, this scene is loaded after the lobby connection succeeds.

@export var fade_in_duration: float = 1.2
@export var fade_out_duration: float = 0.8

@onready var fade_rect: ColorRect = $FadeCanvasLayer/FadeOverlay if has_node("FadeCanvasLayer/FadeOverlay") else null
@onready var current_scene: Node = $CoreTruths if has_node("CoreTruths") else null


func _ready() -> void:
	# On dedicated server, skip the fade entirely.
	if NetworkManager.is_dedicated_server:
		if fade_rect:
			fade_rect.visible = false
		var fade_layer = $FadeCanvasLayer if has_node("FadeCanvasLayer") else null
		if fade_layer:
			fade_layer.queue_free()
		_setup_world_signals()
		return

	if not fade_rect:
		_setup_world_signals()
		return

	fade_rect.color = Color(0, 0, 0, 1)
	var fade_in := create_tween()
	fade_in.tween_property(fade_rect, "color:a", 0.0, fade_in_duration)
	_setup_world_signals()


func _setup_world_signals() -> void:
	if current_scene and current_scene.has_signal("experience_completed"):
		current_scene.experience_completed.connect(_on_experience_completed)


func _on_experience_completed() -> void:
	if NetworkManager.is_dedicated_server:
		return
	var fade_out := create_tween()
	fade_out.tween_property(fade_rect, "color:a", 1.0, fade_out_duration)
