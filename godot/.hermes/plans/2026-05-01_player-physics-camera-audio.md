# Player Physics, Dynamic Camera, Spatial Audio Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the CoreSapian Godot 4.6 game from a floating/hovering first-person controller into a ground-based walking simulator with realistic physics, immersive camera effects, and spatial audio ambience.

**Architecture:** The existing `CharacterBody3D` player is replaced with a custom physics body driven by Rapier3D (via GDExtension / godot-rust). The player controller gains gravity, ground detection, sprint stamina, and jump mechanics. Camera effects (head bob, sway, landing impact, strafe lean) are layered onto the existing Head/Camera3D hierarchy. Spatial audio uses Godot's built-in AudioStreamPlayer3D nodes with real downloaded audio files. An Ambient audio system generates procedural muzak and radio noise via GDScript AudioEffect chains. Settings UI is extended with new physics/audio controls.

**Tech Stack:** Godot 4.6, GDScript, Rapier3D (Rust GDExtension via godot-rust), AudioStreamPlayer3D, AudioEffectAmplify/AudioEffectFilter, WAV/OGG audio assets.

**Key Files:**
- `scenes/core_truths/player_controller.gd` — main player logic (367 lines)
- `scenes/core_truths/player.tscn` — player scene tree
- `scenes/ui/settings_menu.gd` — settings UI (184 lines)
- `scenes/ui/settings_menu.tscn` — settings scene tree
- `scenes/core_truths/core_truths.tscn` — world scene
- `project.godot` — project config

---

## CRITICAL DECISION: Rapier3D Integration Approach

The rapier library at `/Users/core/coresapian_inc/Codebases/Alfheim/datadelaurier.com/rapier/` is the **upstream Rust crate v0.32.0** — it has **zero Godot integration** (no `.gdextension`, no addon, no plugin.cfg). To use it with Godot, we need a **godot-rust GDExtension** wrapper.

### Two viable approaches:

**Option A: godot-rapier GDExtension (preferred)**
- Use the existing `rapier3d` Rust crate as a dependency
- Write a thin GDExtension layer with `godot-rust` bindings
- Expose: create physics world, step, add bodies/colliders, raycast, character controller
- Build with `cargo build --target wasm32-unknown-emscripten` for web or `--target x86_64-unknown-linux-gnu` for server
- Registers as `.gdextension` addon

**Option B: GDScript physics + inspiration from rapier examples**
- Keep CharacterBody3D, rewrite movement with manual velocity/friction/gravity math
- Implement ground detection with ShapeCast3D (downward)
- Implement wall sliding via move_and_slide() with slide_on_ceiling=false and custom wall normal handling
- No Rust dependency, pure GDScript, works on all platforms immediately
- Use rapier example logic (PID controller, friction model, etc.) as reference for the math

**Recommendation: Option B** for initial implementation. Reasons:
1. Godot 4.6 CharacterBody3D already handles collision detection and wall sliding natively via `move_and_slide()`
2. No cross-compilation toolchain required (web exports, dedicated server all work)
3. The rapier character controller math can be replicated in GDScript — the concepts (friction, gravity, snap-to-ground, variable jump height) are straightforward
4. Can always upgrade to Option A later if more advanced physics are needed (ragdoll, cloth, complex collision)

**We will reference the rapier example patterns** for the physics math:
- Friction model: velocity -= friction_force * dt (from platform3.rs kinematic velocity control)
- Ground detection: downward shape cast with snap-to-ground tolerance (from character_controller3.rs)
- Wall sliding: CharacterBody3D `move_and_slide()` with `floor_snap_length` + `slide_on_ceiling` already provides per-axis wall slide
- Variable jump height: zero vertical velocity when jump released (from KinematicCharacterController)

---

## Phase 1: Physics Engine Overhaul

### Task 1.1: Add new audio buses to project.godot

**Objective:** Create dedicated audio buses for Ambient, Footsteps, and UI so they can be volume-controlled independently.

**Files:**
- Modify: `project.godot`

**Step 1: Add audio bus layout**

Add the following audio bus configuration to `project.godot`. Godot 4 stores bus layouts in `project.godot` under `[audio]` section or in a separate `default_bus_layout.tres`. Since the project currently uses the default buses (Master, Music, SFX), add new ones:

Create file: `godot/default_bus_layout.tres`

```
[gd_resource type="AudioBusLayout" format=3]

[sub_resource type="AudioEffectCompressor" id="1"]
...

[bus]
name = "Master"
mute = false
volume_db = 0.0
send = ""

[bus]
name = "Music"
mute = false
volume_db = -3.0
send = "Master"

[bus]
name = "SFX"
mute = false
volume_db = 0.0
send = "Master"

[bus]
name = "Ambient"
mute = false
volume_db = -6.0
send = "Master"

[bus]
name = "Footsteps"
mute = false
volume_db = 0.0
send = "Master"

[bus]
name = "UI"
mute = false
volume_db = 0.0
send = "Master"
```

Update `project.godot` to reference:
```ini
[audio]
default_bus_layout = "res://default_bus_layout.tres"
```

**Step 2: Verify**
Open the project in Godot editor, check Audio tab shows all 6 buses.

---

### Task 1.2: Download and add audio assets

**Objective:** Acquire royalty-free audio files for all spatial audio sources and ambient sounds. Use web search and curl to download from freesound.org, pixabay, or similar royalty-free sources.

**Files:**
- Create: `godot/resources/audio/` directory
- Create: `godot/resources/audio/fluorescent_buzz_01.ogg`
- Create: `godot/resources/audio/fluorescent_buzz_02.ogg`
- Create: `godot/resources/audio/fluorescent_buzz_03.ogg`
- Create: `godot/resources/audio/fluorescent_buzz_04.ogg`
- Create: `godot/resources/audio/vending_machine_hum.ogg`
- Create: `godot/resources/audio/water_cooler_bubbles.ogg`
- Create: `godot/resources/audio/ac_vent_whoosh_01.ogg`
- Create: `godot/resources/audio/ac_vent_whoosh_02.ogg`
- Create: `godot/resources/audio/elevator_ding.ogg`
- Create: `godot/resources/audio/footstep_01.ogg`
- Create: `godot/resources/audio/footstep_02.ogg`
- Create: `godot/resources/audio/footstep_03.ogg`
- Create: `godot/resources/audio/footstep_04.ogg`

**Step 1: Create audio directory**

```bash
mkdir -p godot/resources/audio
```

**Step 2: Download audio files**

Use web search and curl to find and download royalty-free audio:

For fluorescent light buzz — search freesound.org for "fluorescent light buzz" or "electrical hum 60hz":
```bash
# Search and download from freesound.org using their API or direct links
# Alternative: use pixabay.com/sound-effects/ or mixkit.co/free-sound-effects/
```

For vending machine hum — search for "machine hum drone":
```bash
# Low frequency mechanical hum
```

For water cooler bubbles — search for "water cooler bubbling":
```bash
# Periodic filtered noise bursts
```

For AC vent whoosh — search for "air vent whoosh HVAC":
```bash
# Filtered white noise, airflow
```

For elevator ding — search for "elevator bell ding":
```bash
# 660Hz bell tone
```

For footsteps — search for "footstep concrete hard surface":
```bash
# Low-freq thud, multiple variations
```

**Step 3: Convert to OGG Vorbis (Godot preferred format)**

```bash
# Use ffmpeg to convert any WAV/MP3 to OGG Vorbis, mono, appropriate sample rate
for f in resources/audio/*.wav; do
  ffmpeg -i "$f" -c:a libvorbis -ac 1 -ar 44100 -q:a 4 "${f%.wav}.ogg"
done
```

**Step 4: Verify imports**
Open Godot editor, confirm all files appear in FileSystem dock and play correctly.

---

### Task 1.3: Rewrite player_controller.gd — Ground-based physics

**Objective:** Replace the hovering flight controller with ground-based walking physics: gravity, ground detection, friction, acceleration/deceleration, sprint with stamina, jump with variable height, wall sliding.

**Files:**
- Modify: `scenes/core_truths/player_controller.gd` (complete rewrite of physics logic, preserve multiplayer/touch/UI code)

**Design (inspired by rapier examples):**

Physics constants (from rapier character_controller3.rs):
```gdscript
# ── Physics Constants ──
@export var gravity: float = 20.0            # m/s² (from spec)
@export var ground_friction: float = 8.0     # m/s² ground friction
@export var air_friction: float = 1.0        # m/s² air friction
@export var walk_speed: float = 4.0          # m/s walk speed
@export var sprint_multiplier: float = 1.6   # sprint speed multiplier (from spec)
@export var max_stamina: float = 100.0       # stamina units
@export var stamina_drain: float = 25.0      # stamina/second while sprinting
@export var stamina_regen: float = 15.0      # stamina/second while not sprinting
@export var jump_velocity: float = 8.0       # initial jump velocity
@export var max_fall_speed: float = -30.0    # terminal velocity
@export var ground_snap_distance: float = 0.1 # snap to ground tolerance (rapier offset)
```

Ground detection — use CharacterBody3D's built-in `is_on_floor()` plus a secondary `ShapeCast3D` pointing down for more precise detection:
```gdscript
@onready var ground_cast: ShapeCast3D = $GroundCast

var is_grounded: bool = false
var was_grounded: bool = false
var last_fall_speed: float = 0.0

func _check_ground() -> void:
    was_grounded = is_grounded
    # Primary: CharacterBody3D's built-in floor detection
    is_grounded = is_on_floor()
    # Secondary: shape cast downward for ledge/snap detection
    if not is_grounded and ground_cast:
        ground_cast.force_shapecast_update()
        is_grounded = ground_cast.is_colliding()
```

Acceleration/deceleration with friction (from rapier platform3.rs velocity-based kinematic):
```gdscript
func _apply_horizontal_physics(move_dir: Vector3, delta: float) -> void:
    var target_speed := walk_speed
    var is_sprinting := Input.is_action_pressed("sprint") and _stamina > 0.0
    if is_sprinting:
        target_speed *= sprint_multiplier
        _stamina = maxf(0.0, _stamina - stamina_drain * delta)
    
    var friction := ground_friction if is_grounded else air_friction
    var desired_velocity := move_dir * target_speed
    
    # Lerp current velocity toward desired with friction as acceleration rate
    var accel := friction * delta
    if move_dir.length_squared() > 0.01:
        velocity.x = move_toward(velocity.x, desired_velocity.x, accel)
        velocity.z = move_toward(velocity.z, desired_velocity.z, accel)
    else:
        # Decelerate to zero with friction
        velocity.x = move_toward(velocity.x, 0.0, accel)
        velocity.z = move_toward(velocity.z, 0.0, accel)
```

Gravity:
```gdscript
func _apply_gravity(delta: float) -> void:
    if not is_grounded:
        velocity.y = maxf(velocity.y - gravity * delta, max_fall_speed)
    # Track fall speed for landing impact camera effect
    if not is_grounded:
        last_fall_speed = velocity.y
```

Jump with variable height (from rapier KinematicCharacterController pattern):
```gdscript
var _jump_held: bool = false

func _handle_jump() -> void:
    if Input.is_action_just_pressed("jump") and is_grounded:
        velocity.y = jump_velocity
        _jump_held = true
        is_grounded = false
    
    # Variable jump height: release early = shorter jump
    if Input.is_action_just_released("jump") and velocity.y > 0.0:
        velocity.y *= 0.4  # cut upward velocity when button released
        _jump_held = false
```

Landing impact detection:
```gdscript
func _check_landing_impact() -> void:
    if not was_grounded and is_grounded and last_fall_speed < -3.0:
        var impact_intensity := clampf(absf(last_fall_speed) / max_fall_speed, 0.0, 1.0)
        _camera_shake_landing.emit(impact_intensity)
```

Wall sliding — CharacterBody3D `move_and_slide()` already handles this:
```gdscript
# The existing move_and_slide() with floor_snap_length handles wall sliding.
# Set floor_snap_length to ground_snap_distance for consistent ground snapping.
func _physics_process(delta: float) -> void:
    # ... physics calculations ...
    floor_snap_length = ground_snap_distance if not velocity.y < -1.0 else 0.0
    move_and_slide()
```

Stamina system:
```gdscript
var _stamina: float = max_stamina

func _process(delta: float) -> void:
    # Regen stamina when not sprinting
    if not Input.is_action_pressed("sprint") or not is_grounded:
        _stamina = minf(_stamina + stamina_regen * delta, max_stamina)
```

Touch controls update — Rise/Descend buttons become unused for ground mode. Can repurpose or hide.

**Step 1: Add GroundCast ShapeCast3D to player.tscn**

In `player.tscn`, add a child node:
```
[node name="GroundCast" type="ShapeCast3D" parent="."]
shape = SubResource("CapsuleShape3D_ground")  # same shape as collision
target_position = Vector3(0, -0.2, 0)  # short downward cast
collision_mask = 1  # match environment layer
margin = 0.01
```

**Step 2: Rewrite player_controller.gd**

Complete rewrite preserving:
- Multiplayer sync (sync_transform RPC, remote interpolation)
- Mouse look / touch look
- Settings menu interaction
- Interaction ray system
- Input map binding
- Cursor management

Replacing:
- `_process_local_input()` — new ground-based physics
- `_apply_move_velocity()` → `_apply_horizontal_physics()`
- `_apply_vertical_velocity()` → `_apply_gravity()` + `_handle_jump()`
- Remove `_rise_requested`, `_descend_requested` (no more hover)
- Add stamina, jump, landing detection, ground detection

**Step 3: Test**
- Walk with WASD — should accelerate and decelerate with friction
- Press Space to jump — should arc upward and fall back down
- Hold Space for higher jump, release early for shorter jump
- Hold Shift to sprint — should move faster, stamina bar depletes
- Sprint until stamina depleted — should revert to walk speed
- Stop sprinting — stamina regenerates
- Walk into walls — should slide along them per-axis
- Fall from height — should detect landing impact

---

### Task 1.4: Add Stamina Bar HUD element

**Objective:** Create a stamina bar UI that appears at the bottom-center of the screen, turns red when depleted.

**Files:**
- Modify: `scenes/core_truths/player.tscn` (add stamina bar nodes)
- Modify: `scenes/core_truths/player_controller.gd` (bind stamina to UI)

**Step 1: Add stamina bar nodes to player.tscn**

Add under `$HUD`:
```
[node name="StaminaBar" type="Control" parent="HUD"]
layout_mode = 1  # anchors
anchors_preset = 12  # full rect
anchor_right = 1.0
anchor_bottom = 1.0

[node name="StaminaBackground" type="Panel" parent="HUD/StaminaBar"]
layout_mode = 1
anchors_preset = 8  # vcenter bottom
anchor_top = 0.88
anchor_bottom = 0.92
offset_left = 0.3
offset_right = 0.7

[node name="StaminaFill" type="ColorRect" parent="HUD/StaminaBar/StaminaBackground"]
layout_mode = 1
anchors_preset = 15  # full rect
anchor_right = 1.0
anchor_bottom = 1.0
color = Color(0.2, 0.8, 0.4, 0.7)  # green

[node name="StaminaLabel" type="Label" parent="HUD/StaminaBar/StaminaBackground"]
layout_mode = 1
anchors_preset = 8  # center
anchor_left = 0.5
anchor_right = 0.5
anchor_top = 0.0
anchor_bottom = 1.0
horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
vertical_alignment = VERTICAL_ALIGNMENT_CENTER
text = "SPRINT"
```

**Step 2: Bind stamina to UI in player_controller.gd**

```gdscript
@onready var stamina_fill: ColorRect = $HUD/StaminaBar/StaminaBackground/StaminaFill

func _process(delta: float) -> void:
    # ... existing code ...
    _update_stamina_ui()

func _update_stamina_ui() -> void:
    if not stamina_fill:
        return
    var ratio := _stamina / max_stamina
    stamina_fill.anchor_left = 0.0
    stamina_fill.anchor_right = ratio
    
    # Color shift: green → yellow → red
    if ratio > 0.5:
        stamina_fill.color = Color(0.2, 0.8, 0.4, 0.7)
    elif ratio > 0.2:
        stamina_fill.color = Color(0.9, 0.8, 0.1, 0.7)
    else:
        stamina_fill.color = Color(0.9, 0.2, 0.15, 0.8)
    
    # Hide when full and not sprinting
    stamina_fill.get_parent().visible = ratio < 0.99 or Input.is_action_pressed("sprint")
```

**Step 3: Test**
- Sprint — bar shrinks, stays visible
- Stop sprinting — bar regenerates, fades when full
- Deplete stamina — bar turns red

---

## Phase 2: Dynamic Camera (Walking Simulation)

### Task 2.1: Create camera_effects.gd script

**Objective:** Encapsulate all camera effects (head bob, head sway, landing impact, strafe lean) in a separate script attached to the Head node. This keeps player_controller.gd clean.

**Files:**
- Create: `scenes/core_truths/camera_effects.gd`
- Modify: `scenes/core_truths/player.tscn` (attach script to Head node)

**Design:**

```gdscript
extends Node3D

## Walking simulation camera effects.
## Attach to the Head node (parent of Camera3D).

signal landing_impact(intensity: float)

@export var head_bob_enabled: bool = true
@export var head_bob_intensity: float = 1.0
@export var strafe_lean_amount: float = 3.0  # degrees

# Head bob parameters
var _bob_timer: float = 0.0
var _bob_frequency_walk: float = 12.0  # Hz (steps per second feel)
var _bob_frequency_sprint: float = 16.0
var _bob_amplitude_y: float = 0.035  # meters vertical oscillation
var _bob_amplitude_x: float = 0.02   # lateral sway

# Head sway (phase-offset from bob)
var _sway_phase: float = 0.0
var _sway_amplitude_x: float = 0.012
var _sway_amplitude_z: float = 0.008

# Landing impact
var _landing_timer: float = 0.0
var _landing_duration: float = 0.4
var _landing_amplitude: float = 0.0

# Strafe lean
var _target_roll: float = 0.0

@onready var camera: Camera3D = $Camera3D

var _is_moving: bool = false
var _is_sprinting: bool = false
var _move_lateral: float = 0.0  # -1 to 1, lateral input


func set_movement_state(moving: bool, sprinting: bool, lateral: float) -> void:
    _is_moving = moving
    _is_sprinting = sprinting
    _move_lateral = lateral


func trigger_landing_impact(fall_speed: float) -> void:
    landing_impact.emit(absf(fall_speed))
    _landing_timer = _landing_duration
    _landing_amplitude = clampf(absf(fall_speed) * 0.003, 0.0, 0.08)


func _process(delta: float) -> void:
    var offset := Vector3.ZERO
    
    # Head bob
    if head_bob_enabled and _is_moving:
        var freq := _bob_frequency_sprint if _is_sprinting else _bob_frequency_walk
        _bob_timer += delta * freq * TAU
        offset.y += sin(_bob_timer) * _bob_amplitude_y * head_bob_intensity
        offset.x += cos(_bob_timer) * _bob_amplitude_x * head_bob_intensity
        
        # Head sway (phase-offset oscillations)
        _sway_phase += delta * freq * TAU
        offset.x += sin(_sway_phase + 1.5) * _sway_amplitude_x * head_bob_intensity
        offset.z += cos(_sway_phase + 0.7) * _sway_amplitude_z * head_bob_intensity
    else:
        # Smooth return to center
        _bob_timer *= 0.9
        _sway_phase *= 0.9
    
    # Landing impact — damped oscillation
    if _landing_timer > 0.0:
        _landing_timer -= delta
        var t := 1.0 - (_landing_timer / _landing_duration)
        var damp := exp(-t * 6.0)  # exponential damping
        offset.y -= sin(t * 30.0) * _landing_amplitude * damp
        offset.x += cos(t * 25.0) * _landing_amplitude * 0.3 * damp
    
    camera.position = camera.position.lerp(offset, 0.3)
    
    # Strafe lean — camera roll
    _target_roll = _move_lateral * deg_to_rad(strafe_lean_amount) * head_bob_intensity
    if not _is_moving:
        _target_roll = 0.0
    camera.rotation.z = lerp(camera.rotation.z, _target_roll, 0.1)
```

**Step 1: Create the script file**

**Step 2: Attach to Head node in player.tscn**
```
[node name="Head" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.65, 0)
script = ExtResource("camera_effects_id")
```

**Step 3: Connect landing impact in player_controller.gd**

```gdscript
@onready var camera_effects: Node3D = $Head  # now has camera_effects.gd

func _check_landing_impact() -> void:
    if not was_grounded and is_grounded and last_fall_speed < -3.0:
        camera_effects.trigger_landing_impact(last_fall_speed)

func _process_local_input(delta: float) -> void:
    # ... after physics ...
    var lateral := Input.get_axis("move_left", "move_right")
    camera_effects.set_movement_state(
        velocity.length() > 0.5,
        Input.is_action_pressed("sprint"),
        lateral
    )
```

**Step 4: Test**
- Walk — camera bobs up/down and sways laterally
- Sprint — bob frequency increases
- Jump and land — camera shakes on impact
- Strafe (A/D) — camera tilts slightly

---

### Task 2.2: Footstep synthesis system

**Objective:** Play procedural footstep sounds on each head bob cycle crossing, using downloaded audio files.

**Files:**
- Create: `scenes/core_truths/footstep_system.gd`
- Modify: `scenes/core_truths/player.tscn` (attach to player root)

**Design:**

```gdscript
extends Node3D

## Procedural footstep audio system.
## Plays footstep sounds at each head bob cycle crossing.
## Uses downloaded .ogg files, not programmatic synthesis (per user request).

@export var footstep_volume_db: float = -12.0

@onready var footsteps: AudioStreamPlayer3D = $FootstepPlayer

var _footstep_sounds: Array[AudioStream] = []
var _last_bob_sign: float = 0.0  # positive or negative, tracks zero-crossing
var _step_index: int = 0


func _ready() -> void:
    # Load all footstep variations
    for i in range(1, 5):
        var path := "res://resources/audio/footstep_%02d.ogg" % i
        if ResourceLoader.exists(path):
            var stream = load(path) as AudioStream
            if stream:
                _footstep_sounds.append(stream)
    
    if footsteps:
        footsteps.volume_db = footstep_volume_db


func update_bob(bob_value: float, is_moving: bool, is_sprinting: bool) -> void:
    if not is_moving or _footstep_sounds.is_empty() or not footsteps:
        return
    
    var sign := signf(bob_value)
    if sign != _last_bob_sign and sign != 0.0:
        # Zero-crossing detected = footstep
        _play_footstep()
    _last_bob_sign = sign


func _play_footstep() -> void:
    if footsteps.playing:
        return  # don't overlap
    
    _step_index = (_step_index + 1) % _footstep_sounds.size()
    footsteps.stream = _footstep_sounds[_step_index]
    
    # Randomize pitch slightly for variation
    footsteps.pitch_scale = randf_range(0.9, 1.1)
    footsteps.play()
```

**Step 1: Create the script**

**Step 2: Add AudioStreamPlayer3D to player.tscn**

```
[node name="FootstepPlayer" type="AudioStreamPlayer3D" parent="."]
bus = "Footsteps"
volume_db = -12.0
```

**Step 3: Connect bob value from camera_effects**

In camera_effects.gd, emit the raw bob sine value:
```gdscript
signal bob_value(value: float)

# In _process():
var raw_bob := sin(_bob_timer)
bob_value.emit(raw_bob)
```

In footstep_system.gd, connect to camera_effects signal:
```gdscript
func _ready() -> void:
    # ... load sounds ...
    var cam_fx := get_parent().get_node_or_null("Head")
    if cam_fx and cam_fx.has_signal("bob_value"):
        cam_fx.bob_value.connect(update_bob)
```

**Step 4: Test**
- Walk — hear footstep thuds at each step
- Sprint — footstep rate increases
- Jump — no footsteps while airborne

---

## Phase 3: Spatial Audio

### Task 3.1: Create ambient_audio_manager.gd autoload

**Objective:** Create a scene-level audio manager that places spatial audio sources (fluorescent buzz, vending hum, water cooler, AC vents, elevator ding) at specified world positions. Uses AudioStreamPlayer3D for spatial positioning with Doppler effect.

**Files:**
- Create: `scenes/core_truths/ambient_audio_manager.gd`
- Modify: `scenes/core_truths/core_truths.tscn` (add manager node + audio sources)

**Design:**

```gdscript
extends Node3D

## Manages spatial audio sources in the game world.
## Places AudioStreamPlayer3D nodes at specified positions
## for environmental ambience with Doppler effect.

func _ready() -> void:
    # Enable Doppler on the listener (camera)
    var viewport := get_viewport()
    if viewport and viewport.get_camera_3d():
        # AudioListener3D is on Camera3D by default in Godot 4
        # doppler_factor is a property of AudioStreamPlayer3D, not the listener
        pass
    
    _setup_fluorescent_lights()
    _setup_vending_machine()
    _setup_water_cooler()
    _setup_ac_vents()
    _setup_elevator_ding()


func _create_spatial_player(
    stream: AudioStream,
    position: Vector3,
    bus: String = "SFX",
    volume_db: float = -12.0,
    autoplay: bool = true,
    doppler_factor: float = 0.8,
    max_distance: float = 25.0,
    attenuation: float = 1.5
) -> AudioStreamPlayer3D:
    var player := AudioStreamPlayer3D.new()
    player.stream = stream
    player.global_position = position
    player.bus = bus
    player.volume_db = volume_db
    player.autoplay = autoplay
    player.doppler_factor = doppler_factor  # Doppler effect (spec: 0.8)
    player.max_distance = max_distance
    player.attenuation = attenuation
    player.panning_strength = 0.8  # strong spatial positioning
    add_child(player)
    return player


func _setup_fluorescent_lights() -> void:
    var buzz := _load_audio("fluorescent_buzz_01.ogg")
    if not buzz:
        return
    
    # 4 fluorescent lights at ceiling positions (scale with temple)
    var positions := [
        Vector3(-5.0, 4.5, -3.0),
        Vector3(5.0, 4.5, -3.0),
        Vector3(-5.0, 4.5, 3.0),
        Vector3(5.0, 4.5, 3.0),
    ]
    
    for idx in range(positions.size()):
        var stream_path := "res://resources/audio/fluorescent_buzz_%02d.ogg" % (idx + 1)
        var stream := _load_audio("fluorescent_buzz_%02d.ogg" % (idx + 1))
        if not stream:
            stream = buzz  # fallback to first if others missing
        _create_spatial_player(stream, positions[idx], "Ambient", -15.0, true, 0.8, 20.0)


func _setup_vending_machine() -> void:
    var hum := _load_audio("vending_machine_hum.ogg")
    if not hum:
        return
    _create_spatial_player(hum, Vector3(8.0, 0.0, 5.0), "Ambient", -18.0, true, 0.8, 15.0)


func _setup_water_cooler() -> void:
    var bubbles := _load_audio("water_cooler_bubbles.ogg")
    if not bubbles:
        return
    var player := _create_spatial_player(
        bubbles, Vector3(-2.0, 0.8, -5.0),
        "Ambient", -14.0, true, 0.8, 12.0
    )
    # Water cooler: periodic bubble bursts — use a timer to play/stop
    var timer := Timer.new()
    timer.wait_time = randf_range(3.0, 8.0)
    timer.autostart = true
    timer.timeout.connect(_water_cooler_cycle.bind(player, timer))
    add_child(timer)


func _water_cooler_cycle(player: AudioStreamPlayer3D, timer: Timer) -> void:
    # Random cycle: play for 0.5-2s, stop, wait 3-8s
    if not player.playing:
        player.play()
        var play_timer := Timer.new()
        play_timer.wait_time = randf_range(0.5, 2.0)
        play_timer.one_shot = true
        play_timer.timeout.connect(func():
            player.stop()
            play_timer.queue_free()
        )
        add_child(play_timer)
        play_timer.start()
    timer.wait_time = randf_range(3.0, 8.0)
    timer.start()


func _setup_ac_vents() -> void:
    for idx in range(2):
        var stream := _load_audio("ac_vent_whoosh_%02d.ogg" % (idx + 1))
        if not stream:
            continue
        var pos := Vector3([-3.0, 8.0][idx], 4.5, [-5.0, 5.0][idx])
        _create_spatial_player(stream, pos, "Ambient", -16.0, true, 0.8, 20.0)


func _setup_elevator_ding() -> void:
    var ding := _load_audio("elevator_ding.ogg")
    if not ding:
        return
    var player := _create_spatial_player(
        ding, Vector3(15.0, 1.5, 15.0),
        "Ambient", -8.0, false, 0.8, 35.0
    )
    # Elevator ding: every 20-40s randomly
    var timer := Timer.new()
    timer.wait_time = randf_range(20.0, 40.0)
    timer.autostart = true
    timer.timeout.connect(func():
        player.play()
        timer.wait_time = randf_range(20.0, 40.0)
    )
    add_child(timer)


func _load_audio(filename: String) -> AudioStream:
    var path := "res://resources/audio/%s" % filename
    if ResourceLoader.exists(path):
        return load(path) as AudioStream
    return null
```

**Step 1: Create the script**

**Step 2: Add AudioManager node to core_truths.tscn**

```
[node name="AmbientAudioManager" type="Node3D" parent="."]
script = ExtResource("ambient_audio_manager_id")
```

**Step 3: Test**
- Walk around the scene — fluorescent buzzes change volume based on distance
- Approach (8,0,5) — hear vending machine hum
- Approach (-2,0.8,-5) — hear water cooler bubbles periodically
- Wait 20-40s — hear distant elevator ding
- Move quickly toward/away from sources — notice Doppler pitch shift

---

## Phase 4: Ambient Background Audio

### Task 4.1: Elevator Muzak generator

**Objective:** Create an autoload/script that generates procedural elevator muzak using Godot's AudioStreamGenerator and oscillators — 4 detuned sine oscillators playing Cmaj7 → Fmaj7 → Am7 → G7 chord progression, low-pass filtered for tinny speaker effect.

**Files:**
- Create: `scenes/core_truths/ambient_music.gd`
- Modify: `scenes/core_truths/core_truths.tscn` (add node)

**Design:**

Godot 4 has `AudioStreamGenerator` for procedural audio. We use it to create the muzak:

```gdscript
extends Node

## Procedural elevator muzak generator.
## Uses AudioStreamGenerator with raw PCM buffer manipulation
## to create detuned sine oscillators with chord progression.

@export var volume_db: float = -20.0
@export var bus_name: String = "Music"

var _player: AudioStreamPlayer
var _playback: AudioStreamGeneratorPlayback
var _stream: AudioStreamGenerator
var _phase: float = 0.0
var _chord_idx: int = 0
var _chord_timer: float = 0.0
var _chord_duration: float = 2.0  # seconds per chord
var _mix_rate: int = 22050  # lower rate for lo-fi feel

# Chord frequencies (Cmaj7 → Fmaj7 → Am7 → G7)
var _chords := [
    [261.63, 329.63, 392.00, 493.88],  # C E G B
    [174.61, 220.00, 261.63, 329.63],  # F A C E
    [220.00, 261.63, 329.63, 393.88],  # A C E G#
    [196.00, 246.94, 293.66, 349.23],  # G B D F
]

# Detune amounts for tinny speaker effect
var _detunes := [0.0, 0.7, -0.5, 1.2]  # Hz offsets


func _ready() -> void:
    _stream = AudioStreamGenerator.new()
    _stream.mix_rate = _mix_rate
    _stream.buffer_length = 0.1
    
    _player = AudioStreamPlayer.new()
    _player.stream = _stream
    _player.bus = bus_name
    _player.volume_db = volume_db
    add_child(_player)
    
    _player.play()
    _playback = _player.get_stream_playback() as AudioStreamGeneratorPlayback
    
    # Add low-pass filter effect to the bus for tinny speaker
    var bus_idx := AudioServer.get_bus_index(bus_name)
    var lpf := AudioEffectLowPassFilter.new()
    lpf.cutoff_hz = 1500.0  # tinny speaker cutoff
    lpf.resonance = 0.5
    AudioServer.add_bus_effect(bus_idx, lpf)
    
    # Add slight distortion for speaker buzz
    var dist := AudioEffectDistortion.new()
    dist.drive = 0.05
    AudioServer.add_bus_effect(bus_idx, dist)


func _process(_delta: float) -> void:
    if not _playback or _playback.get_frames_available() <= 0:
        return
    
    _chord_timer += 1.0 / _mix_rate
    if _chord_timer >= _chord_duration:
        _chord_timer = 0.0
        _chord_idx = (_chord_idx + 1) % _chords.size()
    
    var chord := _chords[_chord_idx]
    var frames_to_fill := _playback.get_frames_available()
    var buffer := PackedVector2Array()
    buffer.resize(frames_to_fill)
    
    for i in range(frames_to_fill):
        var sample := 0.0
        var t := _phase
        
        for osc in range(4):
            var freq := chord[osc] + _detunes[osc]
            sample += sin(t * freq * TAU) * 0.15  # 4 oscillators, each quiet
        
        # Crossfade between chords (last 0.3s of chord duration)
        var fade_zone := 0.3
        if _chord_timer > _chord_duration - fade_zone:
            var next_idx := (_chord_idx + 1) % _chords.size()
            var next_chord := _chords[next_idx]
            var cross := (_chord_timer - (_chord_duration - fade_zone)) / fade_zone
            var next_sample := 0.0
            for osc in range(4):
                var freq := next_chord[osc] + _detunes[osc]
                next_sample += sin(t * freq * TAU) * 0.15
            sample = lerpf(sample, next_sample, cross)
        
        _phase += 1.0 / _mix_rate
        
        # Soft clip
        sample = clampf(sample, -1.0, 1.0)
        buffer[i] = Vector2(sample, sample)
    
    _playback.push_buffer(buffer)
```

**Step 1: Create the script**

**Step 2: Add to core_truths.tscn**
```
[node name="AmbientMusic" type="Node" parent="."]
script = ExtResource("ambient_music_id")
```

**Step 3: Test**
- Enter scene — hear tinny elevator muzak
- Chords change every 2 seconds
- Sounds like it's playing through a cheap speaker

---

### Task 4.2: Strange Radio Noise generator

**Objective:** Create procedural radio noise — white noise through modulated bandpass filter (sweeping 200-2000Hz), periodic static crackles.

**Files:**
- Create: `scenes/core_truths/radio_noise.gd`
- Modify: `scenes/core_truths/core_truths.tscn` (add node)

**Design:**

```gdscript
extends Node

## Procedural strange radio noise.
## White noise through sweeping bandpass filter + periodic crackles.

@export var volume_db: float = -24.0
@export var bus_name: String = "Ambient"

var _player: AudioStreamPlayer
var _playback: AudioStreamGeneratorPlayback
var _stream: AudioStreamGenerator
var _phase: float = 0.0
var _mix_rate: int = 22050
var _noise_phase: float = 0.0
var _sweep_phase: float = 0.0
var _crackle_timer: float = 0.0
var _crackle_active: bool = false


func _ready() -> void:
    _stream = AudioStreamGenerator.new()
    _stream.mix_rate = _mix_rate
    _stream.buffer_length = 0.1
    
    _player = AudioStreamPlayer.new()
    _player.stream = _stream
    _player.bus = bus_name
    _player.volume_db = volume_db
    add_child(_player)
    
    _player.play()
    _playback = _player.get_stream_playback() as AudioStreamGeneratorPlayback
    
    # Seed for noise
    _noise_phase = randf() * 1000.0


func _process(_delta: float) -> void:
    if not _playback or _playback.get_frames_available() <= 0:
        return
    
    var frames := _playback.get_frames_available()
    var buffer := PackedVector2Array()
    buffer.resize(frames)
    
    for i in range(frames):
        var t := _phase
        _phase += 1.0 / _mix_rate
        
        # White noise (simple hash-based)
        _noise_phase += 1.0
        var noise := (_hash_noise(_noise_phase) - 0.5) * 2.0
        
        # Bandpass sweep: LFO modulates center frequency
        _sweep_phase += 1.0 / _mix_rate
        var lfo := sin(_sweep_phase * 0.3) * 0.5 + 0.5  # 0 to 1
        var center_freq := lerpf(200.0, 2000.0, lfo)
        
        # Simple bandpass approximation using sin() resonance
        var resonance := sin(t * center_freq * TAU)
        var filtered := noise * resonance * 0.08
        
        # Static crackles
        _crackle_timer -= 1.0 / _mix_rate
        if _crackle_timer <= 0.0:
            _crackle_timer = randf_range(1.0, 5.0)  # next crackle
            _crackle_active = true
        
        if _crackle_active:
            filtered += (randf() - 0.5) * 0.4
            if randf() < 0.05:  # short crackle bursts
                _crackle_active = false
        
        var sample := clampf(filtered, -1.0, 1.0)
        buffer[i] = Vector2(sample, sample)
    
    _playback.push_buffer(buffer)


func _hash_noise(n: float) -> float:
    # Simple hash for pseudo-random noise
    var i := int(n * 1000.0) & 0x7FFFFFFF
    i = ((i >> 13) ^ i) * 1274126177
    i = ((i >> 16) ^ i)
    return float(i & 0x7FFFFFFF) / 2147483647.0
```

**Step 1: Create the script**

**Step 2: Add to core_truths.tscn**
```
[node name="RadioNoise" type="Node" parent="."]
script = ExtResource("radio_noise_id")
```

**Step 3: Test**
- Enter scene — hear faint sweeping radio static
- Periodic louder crackle bursts

---

## Phase 5: Settings Controls

### Task 5.1: Extend settings_menu.gd with new controls

**Objective:** Add PHYSICS section (Head Bob toggle, Head Bob Intensity slider, Sprint Multiplier slider) and DRONE.AI audio additions (Music Volume, Ambient Volume) to the settings menu.

**Files:**
- Modify: `scenes/ui/settings_menu.gd`
- Modify: `scenes/ui/settings_menu.tscn`

**Design — New settings sections:**

```
SettingsPanel/VBox/
  Header/
  AudioSection/         (existing)
    MasterVolBox/
    MusicVolBox/
    SFXVolBox/
    NEW: AmbientVolBox/
      Label "Ambient Volume"
      HSlider (0 to 1, default 0.5)
      ValueLabel
  NEW: PhysicsSection/
    VBoxContainer "PHYSICS"
      HeadBobBox/
        Label "Head Bob"
        CheckBox (default: on)
      HeadBobIntensityBox/
        Label "Head Bob Intensity"
        HSlider (0 to 1, step 0.05, default 1.0)
        ValueLabel
      SprintMultBox/
        Label "Sprint Multiplier"
        HSlider (1.2 to 2.5, step 0.1, default 1.6)
        ValueLabel
  InputSection/         (existing)
    SensitivityBox/
  DisplaySection/       (existing)
    DisplayBox/
  CloseButton/
```

**Step 1: Add new UI nodes to settings_menu.tscn**

Add the AmbientVolBox under existing VBox/AudioSection, and a new PhysicsSection.

**Step 2: Update settings_menu.gd**

New exported/ready variables:
```gdscript
@onready var ambient_vol: HSlider = $SettingsPanel/VBox/AudioSection/AmbientVolBox/HSlider
@onready var ambient_vol_label: Label = $SettingsPanel/VBox/AudioSection/AmbientVolBox/ValueLabel
@onready var head_bob_check: CheckBox = $SettingsPanel/VBox/PhysicsSection/HeadBobBox/CheckBox
@onready var head_bob_intensity: HSlider = $SettingsPanel/VBox/PhysicsSection/HeadBobIntensityBox/HSlider
@onready var head_bob_label: Label = $SettingsPanel/VBox/PhysicsSection/HeadBobIntensityBox/ValueLabel
@onready var sprint_mult: HSlider = $SettingsPanel/VBox/PhysicsSection/SprintMultBox/HSlider
@onready var sprint_mult_label: Label = $SettingsPanel/VBox/PhysicsSection/SprintMultBox/ValueLabel
```

New signal connections in _ready():
```gdscript
ambient_vol.value_changed.connect(_on_ambient_vol_changed)
head_bob_check.toggled.connect(_on_head_bob_toggled)
head_bob_intensity.value_changed.connect(_on_head_bob_intensity_changed)
sprint_mult.value_changed.connect(_on_sprint_mult_changed)
```

New callbacks:
```gdscript
func _on_ambient_vol_changed(value: float) -> void:
    var bus_idx := AudioServer.get_bus_index("Ambient")
    if bus_idx >= 0:
        AudioServer.set_bus_volume_db(bus_idx, linear_to_db(value))

func _on_head_bob_toggled(pressed: bool) -> void:
    var player := _get_local_player()
    if player and player.has_method("set_head_bob_enabled"):
        player.set_head_bob_enabled(pressed)

func _on_head_bob_intensity_changed(value: float) -> void:
    head_bob_label.text = "%.2f" % value
    var player := _get_local_player()
    if player and player.has_method("set_head_bob_intensity"):
        player.set_head_bob_intensity(value)

func _on_sprint_mult_changed(value: float) -> void:
    sprint_mult_label.text = "%.1fx" % value
    var player := _get_local_player()
    if player and player.has_method("set_sprint_multiplier"):
        player.set_sprint_multiplier(value)
```

Update _load_settings():
```gdscript
ambient_vol.value = config.get_value("audio", "ambient", 0.5)
head_bob_check.button_pressed = config.get_value("physics", "head_bob", true)
head_bob_intensity.value = config.get_value("physics", "head_bob_intensity", 1.0)
sprint_mult.value = config.get_value("physics", "sprint_multiplier", 1.6)
```

Update _save_settings():
```gdscript
config.set_value("audio", "ambient", ambient_vol.value)
config.set_value("physics", "head_bob", head_bob_check.button_pressed)
config.set_value("physics", "head_bob_intensity", head_bob_intensity.value)
config.set_value("physics", "sprint_multiplier", sprint_mult.value)
```

**Step 3: Add setter methods to player_controller.gd**

```gdscript
func set_head_bob_enabled(enabled: bool) -> void:
    if camera_effects:
        camera_effects.head_bob_enabled = enabled

func set_head_bob_intensity(value: float) -> void:
    if camera_effects:
        camera_effects.head_bob_intensity = value

func set_sprint_multiplier(value: float) -> void:
    sprint_multiplier = value
```

**Step 4: Test**
- Open settings → see new PHYSICS section with 3 controls
- Toggle Head Bob → camera stops/starts bobbing immediately
- Adjust Head Bob Intensity → bob amplitude changes
- Adjust Sprint Multiplier → sprint speed changes
- Adjust Ambient Volume → ambient audio volume changes
- Close settings → values persist to settings.cfg
- Reopen settings → values restored from settings.cfg

---

## Phase 6: Controls Update & Polish

### Task 6.1: Update key bindings and documentation

**Objective:** Ensure Shift and Space are correctly bound for sprint and jump (already partially done), and update touch controls for ground mode.

**Files:**
- Modify: `scenes/core_truths/player_controller.gd`
- Modify: `scenes/core_truths/player.tscn` (touch control visibility)

**Changes:**

1. Input bindings — already bound in `_ensure_input_map()`:
   - `sprint` → KEY_SHIFT ✓
   - `jump` → KEY_SPACE ✓

2. Remove hover bindings:
   - Remove `_bind_key("move_up", KEY_SPACE)` — Space should only jump, not rise
   - Remove `_bind_key("move_down", KEY_CTRL)` — Ctrl/C no longer needed for descend
   - Actually KEEP them but only use for hover mode toggle if needed later

3. Touch controls for ground mode:
   - Rise/Descend buttons: hide when not in hover mode
   - Jump button: add new button for mobile (or use RiseButton repurposed)
   - Sprint button: add toggle or hold button

4. Sync sprint stamina to RPC:
   - Add stamina to sync_transform so remote players can show stamina bar

**Step 1: Update _ensure_input_map()**

```gdscript
func _ensure_input_map() -> void:
    _bind_key("move_forward", KEY_W)
    _bind_key("move_forward", KEY_UP)
    _bind_key("move_backward", KEY_S)
    _bind_key("move_backward", KEY_DOWN)
    _bind_key("move_left", KEY_A)
    _bind_key("move_left", KEY_LEFT)
    _bind_key("move_right", KEY_D)
    _bind_key("move_right", KEY_RIGHT)
    _bind_key("jump", KEY_SPACE)
    _bind_key("sprint", KEY_SHIFT)
    _bind_key("interact", KEY_E)
    _bind_key("interact", KEY_F)
    # Keep move_up/move_down for potential hover toggle later
    _bind_key("move_up", KEY_C)
    _bind_key("move_down", KEY_CTRL)
```

**Step 2: Test**
- WASD moves, Shift sprints, Space jumps
- No conflicts between controls
- Touch controls work (or are hidden on desktop)

---

### Task 6.2: Multiplayer stamina sync

**Objective:** Sync stamina state to remote players so they can display the stamina bar correctly.

**Files:**
- Modify: `scenes/core_truths/player_controller.gd`

**Design:**

Extend sync_transform to include stamina:
```gdscript
@rpc("authority", "call_remote", "unreliable")
func sync_transform(pos: Vector3, rot_y: float, pitch: float, stamina: float = -1.0) -> void:
    _sync_position = pos
    _sync_rotation_y = rot_y
    _sync_pitch = pitch
    if stamina >= 0.0:
        _sync_stamina = stamina
```

Call:
```gdscript
sync_transform.rpc(global_position, global_rotation.y, _pitch, _stamina)
```

Remote player update:
```gdscript
func _interpolate_remote_state(_delta: float) -> void:
    # ... existing interpolation ...
    _update_remote_stamina_ui()

func _update_remote_stamina_ui() -> void:
    if _remote_stamina_fill:
        var ratio := _sync_stamina / max_stamina
        _remote_stamina_fill.anchor_right = ratio
```

---

### Task 6.3: Update player.tscn scene tree

**Objective:** Update the player scene tree to include all new nodes: GroundCast, footstep player, camera effects script, stamina bar, updated touch controls.

**Files:**
- Modify: `scenes/core_truths/player.tscn`

**Full updated scene tree:**
```
Player (CharacterBody3D) — player_controller.gd
├── CollisionShape3D (CapsuleShape3D, radius=0.35, height=1.2)
├── GroundCast (ShapeCast3D, target_position=(0,-0.2,0))
├── FootstepPlayer (AudioStreamPlayer3D, bus="Footsteps") — footstep_system.gd
├── Head (Node3D, y=0.65) — camera_effects.gd
│   └── Camera3D
│   └── InteractRay (RayCast3D)
├── PlayerLabel (Label3D, visible=false for local)
└── HUD (Control, full rect)
    ├── Crosshair (Label)
    ├── InteractLabel (Label)
    ├── GearButton (Button, text="⚙")
    ├── SettingsMenu (Control) — settings_menu.gd
    ├── StaminaBar (Control, full rect)
    │   └── StaminaBackground (Panel)
    │       └── StaminaFill (ColorRect)
    │       └── StaminaLabel (Label)
    ├── ChatWidget (Control)
    └── TouchControls (Control)
        ├── MovePad → MoveKnob
        ├── LookPad
        ├── RiseButton (hidden in ground mode)
        ├── DescendButton (hidden in ground mode)
        ├── JumpButton (new, for mobile)
        └── InteractButton
```

---

## Task Dependency Graph

```
1.1 (audio buses) ───┐
                      ├──→ 1.2 (audio assets) ───→ 3.1 (spatial audio) ───┐
1.3 (physics)  ──→ 1.4 (stamina UI) ──→ 2.1 (camera FX) ──→ 2.2 (footsteps) ──┤
                                                                              │
4.1 (muzak) ──────────────────────────────────────────────────────────────────┤
4.2 (radio noise) ───────────────────────────────────────────────────────────┤
                                                                              ↓
                                                              5.1 (settings UI)
                                                              6.1 (controls)
                                                              6.2 (multiplayer sync)
                                                              6.3 (scene tree update)
```

---

## Risks & Mitigations

1. **Audio assets may not be exactly as described** (fluorescent 120Hz harmonics, etc.)
   - Mitigation: Download the closest matches available from freesound/pixabay, apply AudioEffectFilter in Godot to shape the frequency response. The files don't need to be perfect raw recordings — we shape them with filters.

2. **Procedural audio (muzak/radio) may have performance issues on web/mobile**
   - Mitigation: Use low mix rate (22050 Hz), small buffer length (0.1s), and disable procedural audio on web builds if needed.

3. **Touch controls need mobile testing**
   - Mitigation: Hide unused touch buttons on desktop, add JumpButton for mobile. Test with browser device emulation.

4. **Settings.cfg migration** — existing players have old format
   - Mitigation: `config.get_value()` with defaults handles missing keys gracefully.

5. **CharacterBody3D wall sliding vs rapier-style** — Godot's `move_and_slide()` may behave differently
   - Mitigation: Test thoroughly. If needed, implement custom wall slide by checking `get_last_slide_collision()` normals and zeroing velocity on the collision axis.

---

## Open Questions

1. Should we add a "hover mode" toggle (press C to switch between ground/walk and fly/hover)? This would preserve the original flight behavior as an option.
2. The temple environment is scaled at 0.6 — do audio source positions need to be adjusted to match the scaled temple geometry?
3. Should footstep sounds change based on surface type (stone, metal, etc.) or is one material sufficient for now?
