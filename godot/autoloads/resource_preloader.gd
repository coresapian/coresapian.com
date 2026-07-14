extends Node
## ResourcePreloader — singleton for zone-based, threaded asset loading.
##
## Usage:
##   ResourcePreloader.preload_zone(["res://scenes/temple/player.tscn", ...])
##   await ResourcePreloader.zone_ready
##   var scene := ResourcePreloader.get_packed_scene("res://scenes/temple/player.tscn")
##
## Only loads resources once; subsequent calls for an already-loaded path are instant.

signal zone_ready

var _cache: Dictionary = {}        # path -> PackedScene or Resource
var _loading: Dictionary = {}       # path -> bool, currently in flight
var _pending: Array[String] = []    # paths queued for current zone
var _loaded_count: int = 0
var _total_count: int = 0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS

## Preload a list of resources in the background.
func preload_zone(paths: Array[String]) -> void:
	_pending = paths.duplicate()
	_loaded_count = 0
	_total_count = paths.size()
	_load_next()

func _load_next() -> void:
	if _pending.is_empty():
		zone_ready.emit()
		return
	var path := _pending[0]
	_pending.remove_at(0)
	if _cache.has(path):
		_loaded_count += 1
		_load_next()
		return
	var err := ResourceLoader.load_threaded_request(path, "", true)
	if err != OK:
		push_warning("[ResourcePreloader] Could not request load for: %s" % path)
		_load_next()
		return
	_loading[path] = true

func _process(_delta: float) -> void:
	for path in _loading.keys():
		var status := ResourceLoader.load_threaded_get_status(path)
		match status:
			ResourceLoader.ThreadLoadStatus.THREAD_LOAD_IN_PROGRESS:
				continue
			ResourceLoader.ThreadLoadStatus.THREAD_LOAD_LOADED:
				_cache[path] = ResourceLoader.load_threaded_get(path)
				_loading.erase(path)
				_loaded_count += 1
				_load_next()
			ResourceLoader.ThreadLoadStatus.THREAD_LOAD_FAILED, ResourceLoader.ThreadLoadStatus.THREAD_LOAD_INVALID_RESOURCE:
				push_warning("[ResourcePreloader] Failed to load: %s" % path)
				_loading.erase(path)
				_loaded_count += 1
				_load_next()

func get_packed_scene(path: String) -> PackedScene:
	return _cache.get(path) as PackedScene

func get_resource(path: String) -> Resource:
	return _cache.get(path) as Resource

func is_ready() -> bool:
	return _loading.is_empty() and _pending.is_empty()

func get_progress() -> float:
	if _total_count == 0:
		return 1.0
	return float(_loaded_count) / float(_total_count)
