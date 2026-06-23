## Visual representation of a remote multiplayer player.
## Glowing orange phosphor orb that interpolates toward reported position.
## No class_name — loaded dynamically to avoid parse errors on dedicated servers.
extends Node3D

var target_position: Vector3 = Vector3.ZERO
var target_rot_y: float = 0.0
var target_rot_x: float = 0.0
var interpolation_speed: float = 12.0
var player_id: String = ""

var _mesh: MeshInstance3D
var _mat: StandardMaterial3D
var _light: OmniLight3D
var _phase: float = 0.0

# Orange phosphor colors
const ORB_COLOR := Color(1.0, 0.55, 0.0)       	# #FF8C00
const ORB_COLOR_BRIGHT := Color(1.0, 0.69, 0.0)  # #FFB000


func _ready() -> void:
	_mesh = MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.3
	sphere.height = 0.6
	sphere.radial_segments = 12
	sphere.rings = 6
	_mesh.mesh = sphere

	_mat = StandardMaterial3D.new()
	_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat.albedo_color = Color(ORB_COLOR.r, ORB_COLOR.g, ORB_COLOR.b, 0.5)
	_mat.emission_enabled = true
	_mat.emission = ORB_COLOR_BRIGHT
	_mat.emission_energy_multiplier = 2.0
	_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mesh.material_override = _mat
	add_child(_mesh)

	_light = OmniLight3D.new()
	_light.light_color = ORB_COLOR
	_light.light_energy = 2.0
	_light.omni_range = 5.0
	_light.omni_attenuation = 2.0
	_light.shadow_enabled = false
	add_child(_light)


func _process(delta: float) -> void:
	var alpha := 1.0 - exp(-interpolation_speed * delta)
	global_position = global_position.lerp(target_position, alpha)

	_phase += delta * 3.0
	var pulse := 2.0 + sin(_phase) * 0.8
	_mat.emission_energy_multiplier = pulse
	_light.light_energy = pulse

	var c := _mat.albedo_color
	c.a = 0.5 + sin(_phase * 1.2) * 0.15
	_mat.albedo_color = c
