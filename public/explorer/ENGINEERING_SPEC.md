# Hintze Hall Explorer — Engineering Specification

**Version:** 0.1.0 (MVP)
**URL:** https://coresapian.com/explorer/
**Repo:** `/public/explorer/` in coresapian repo
**GLB:** hintze_hall.glb (149 MB, Natural History Museum Hintze Hall)

---

## 1. Current Architecture

```
index.html              Entry point, all CSS, UI overlays, import map
config.yaml             All tunable parameters (no rebuild needed)
js/state.js             Central shared state object S (imported by every module)
js/config.js            Quote-aware YAML parser + fallback defaults
js/main.js              Orchestrator: init scene, load GLB, animation loop
js/pointer-lock.js      Desktop Pointer Lock + iOS Safari synthetic lock + inventory UI
js/mobile-controls.js   Virtual joystick + touch look zone + action buttons
js/physics.js           WASD movement, gravity, AABB wall collision, multi-ray ground detection
js/scene-objects.js     GLTFLoader for hintze_hall.glb, 6 floating collectible items
js/interaction.js       Center-screen raycast pickup, highlight, E key / tap to collect
```

**Key pattern:** Single shared state object `S` imported by all modules. No events or callbacks for game state -- everything reads/writes `S` directly. Lock/unlock listeners are the only event system (for UI show/hide).

**Camera rig:**
```
S.cameraYaw (THREE.Group, Y rotation)
  └── S.cameraPitch (THREE.Group, X rotation, clamped ±π/2.2)
       └── S.camera (PerspectiveCamera, fov 75)
```

**Data flow:**
```
config.yaml → config.js → S.CFG + S.settings
index.html → pointer-lock.js → S.controls.isLocked (desktop: real API, mobile: synthetic)
mobile-controls.js → S.touchState.{moveX,moveY,sprinting}
main.js keydown → S.controls.{moveForward,moveBackward,moveLeft,moveRight,sprint,jump}
physics.js reads S.controls.* + S.touchState.* → updates S.cameraYaw.position
interaction.js reads S.controls.isLocked → raycasts → updates S.inventory.items
```

**Deployment:** `scp` to Proxmox host 192.168.0.10, then `pct push 103` into LXC. Nginx serves from `/var/www/coresapian/explorer/`. COEP header overridden to `credentialless` for the `/explorer/` location block so CDN Three.js loads.

---

## 2. Known Issues (Current)

### 2.1 Ground Detection — CRITICAL, PARTIALLY FIXED

**Status:** `findFloor()` now scans ALL ray hits and picks the lowest point. This correctly skips the dinosaur skeleton. However, the merged AABB collision boxes still box the player in when they're near/inside complex geometry like the skeleton.

**Remaining problem:** The 3-pass AABB merge creates enormous bounding boxes that can encapsulate large sections of the hall. When the player spawns inside or near one, wall collision prevents all movement. The current "stuck escape" hack (disable wall collision after 30 stuck frames) is a band-aid.

**Proper fix (priority P0):**
- Replace merged AABB wall collision with per-mesh raycast walls (cast 4-8 horizontal rays from player position, block movement in directions that hit within playerRadius)
- Or: use a navigation mesh (navmesh) baked from the GLB geometry. Three.js `Pathfinding` addon works with recast-generated navmeshes
- Or: filter collision boxes by height -- only register boxes whose Y range overlaps the player's current eye height ±0.5m. This prevents the skeleton's bounding box (which extends from floor to ceiling) from blocking movement when the player is at floor level

### 2.2 Spawn Position — WORKAROUND IN PLACE

**Current:** `[20, 0, 20]` with multi-ray ground snap from Y=50.
**Problem:** We don't know the actual floor coordinates of the GLB. The model's bounding box center and size are logged to console but we haven't recorded them.
**Fix:** Add a developer mode (URL param `?dev`) that shows current player position, floor height, and teleport-to-coordinates input. Use this to map safe spawn points.

### 2.3 GLB Loading — 149 MB, No Streaming

**Problem:** hintze_hall.glb is 149 MB. Browser must download the entire file before anything renders. On slow connections this takes minutes.
**Potential fixes:**
- Use `DRACOLoader` with Draco-compressed GLB (could reduce to ~30-50 MB)
- Split into multiple GLBs (hall shell, exhibit areas, ceiling details) and load progressively
- Add a proper loading progress bar (currently exists but the GLB loader reports progress inconsistently for large files)

### 2.4 No Collision Mesh Optimization

**Problem:** Every mesh in the GLB is individually registered as a collision mesh. The hintze_hall model likely has thousands of meshes. Raycasting against all of them every frame is expensive.
**Fix:** Build a BVH (Bounding Volume Hierarchy) from the collision meshes. Three.js has `MeshBVH` in examples. This would reduce raycast from O(n) to O(log n).

---

## 3. Planned Features

### 3.1 Robust Collision System (P0)

Replace the current AABB system with one of:

**Option A: Horizontal Raycasts**
- Cast 8 rays horizontally from player position at 45-degree intervals
- Each ray length = playerRadius + small margin (0.1m)
- If a ray hits, block movement in that direction
- Sliding: allow movement component perpendicular to the blocked direction
- Pros: simple, works with arbitrary geometry, no preprocessing
- Cons: can miss thin geometry between ray angles, O(n) per ray per frame

**Option B: Recast Navmesh + Pathfinding**
- Use `recastnavigation` (C++ lib, emscripten port exists) to generate a navmesh from the GLB geometry
- Three.js `Pathfinding` addon for runtime pathfinding/constraint
- Player movement is constrained to the navmesh surface
- Pros: perfect floor detection, no wall clipping, handles stairs/ramps
- Cons: complex build pipeline, navmesh generation can take minutes for large scenes

**Option C: BVH + AABB Hybrid**
- Build a BVH from all mesh bounding boxes
- Player collision tests against BVH (log n culling) then precise AABB
- Floor detection uses BVH-accelerated raycasts
- Pros: good performance, relatively simple
- Cons: AABB still not pixel-perfect for concave geometry

**Recommended:** Start with Option C (BVH acceleration for existing system). If AABB precision is insufficient, migrate to Option A.

### 3.2 Developer/Debug Mode (P1)

URL param `?dev` or `?debug` enables:
- FPS counter (top-right)
- Player position display (X, Y, Z, floor Y)
- Wireframe toggle for environment
- Collision box visualization
- Teleport-to-coordinates input
- Floor height map export (cast grid of rays, output heatmap)

This is essential for calibrating spawn points, item placement, and debugging collision issues without deploying code changes.

### 3.3 Inventory System V2 (P1)

Current inventory is a flat list of items with no gameplay mechanics. Enhance to:

**Rarity system:**
```yaml
pickable_items:
  - id: "sapphire_crystal"
    name: "Sapphire Crystal"
    rarity: "rare"        # common, uncommon, rare, epic, legendary
    description: "..."
    stackable: false
    quest_item: false
```

**Drag-and-drop:**
- Reorder items in inventory grid by dragging
- Right-click / long-press for context menu (Examine, Drop, Use)

**Item examination:**
- Click item in inventory to show 3D model viewer (render the item's mesh in a separate small scene)
- Show full description, rarity, flavor text

**Item dropping:**
- Drop item from inventory back into the world at player's feet
- Item appears at player position with a small bounce animation
- Re-register for pickup raycasting

**Persistence:**
- Save inventory to `localStorage` on every change
- Load on page init, re-validate against config (items removed from config are stripped)
- Track which items have been collected globally (so they don't respawn)

### 3.4 Quest/Hint System (P2)

```yaml
quests:
  - id: "first_find"
    name: "Curious Collector"
    description: "Find your first item in Hintze Hall."
    trigger: "collect_any"
    reward_text: "The hall holds many secrets..."
  - id: "gem_collector"
    name: "Gem Hunter"
    description: "Collect both gemstones."
    trigger: "collect_all"
    items: ["blue_gem", "red_gem"]
    reward_text: "The gems pulse with inner light."
```

- Quest progress tracked in `localStorage`
- Toast notification on quest completion
- Quest log panel (separate from inventory, toggle with J key)

### 3.5 Minimap (P2)

- Top-down orthographic camera rendering the scene
- Player position shown as a dot with direction indicator
- Collected/uncollected items shown as colored dots
- Toggle with M key
- Canvas overlay, low z-index, semi-transparent background

### 3.6 Ambient Audio (P2)

```yaml
audio:
  enabled: true
  master_volume: 0.6
  ambient:
    - type: "hvac_drone"
      frequency: 60
      waveform: "triangle"
      volume: 0.15
    - type: "hall_hum"
      frequency: 120
      waveform: "sawtooth"
      filter: "lowpass"
      filter_frequency: 400
      volume: 0.10
  pickup_sound:
    frequency: 880
    duration: 0.15
    waveform: "sine"
    volume: 0.3
```

- Web Audio API, created on first pointer lock (user gesture requirement)
- Synthesized ambient drones (no audio files needed)
- Pickup chime sound effect
- Fade master gain on lock/unlock

### 3.7 Atmosphere Enhancements (P3)

From the skill's atmosphere toolkit, prioritized by impact:

| Feature | Lines | Impact | Config Section |
|---------|-------|--------|----------------|
| FogExp2 (done) | 1 | Massive | `fog` |
| Fluorescent flicker | ~15 | High | `flicker` |
| Dust particles | ~30 | High | `dust` |
| VHS timestamp overlay | HTML+CSS | High | `vhs` |
| Shadows on 2-3 lights (done) | ~5 | Medium | `lights` |
| Crouch mechanic | ~10 | Medium | `crouch` |
| NPC proximity awareness | ~15 per NPC | Medium | `npcs` |

All configurable in `config.yaml`. Implemented as separate JS modules in `js/atmosphere/`.

### 3.8 Mobile Enhancements (P2)

**Gyroscope look:** Use `DeviceOrientationEvent` for subtle camera tilt on mobile. Requires iOS 13+ permission request (`DeviceOrientationEvent.requestPermission()`).

**Haptic feedback:** `navigator.vibrate(50)` on item pickup, collision with walls.

**Adaptive quality:** Reduce pixel ratio and disable shadows when FPS drops below 30 for 10 consecutive frames. Re-enable when FPS recovers.

---

## 4. Module Dependency Graph

```
main.js
├── state.js (S)
├── config.js → S.CFG, S.settings
├── pointer-lock.js → S.controls.isLocked
│   └── mobile-controls.js → S.touchState (only if isTouchDevice)
├── scene-objects.js → S.collisionMeshes, S.pickableItems, S.environmentGroup
├── physics.js → reads S.controls, S.touchState, writes S.cameraYaw.position
└── interaction.js → reads S.controls.isLocked, writes S.inventory.items
```

**Circular dependency note:** pointer-lock.js calls `renderInventory()` which reads `S.inventory.items` populated by interaction.js. This is fine because pointer-lock.js reads inventory state, interaction.js writes it -- no circular writes. The `window.__renderInventory` bridge is used because pointer-lock.js owns the DOM manipulation for the inventory panel.

---

## 5. Performance Budget

| Metric | Target | Current | Notes |
|--------|--------|---------|-------|
| GLB download | <30s on 10 Mbps | ~2min | 149 MB. Draco compression needed. |
| Scene parse + collision build | <2s | ~1-3s | Depends on mesh count. BVH would help. |
| Frame time (desktop) | <16ms (60fps) | ~10-15ms | Good for simple scene. |
| Frame time (mobile) | <33ms (30fps) | Unknown | Needs testing. Reduce pixel ratio. |
| Memory | <500 MB | ~300-400 MB | 149 MB GLB + textures + Three.js overhead. |
| Collision meshes | <5000 | Unknown | Need to log from hintze_hall. BVH essential if >2000. |

---

## 6. Configuration Reference

All values in `config.yaml`. Changes take effect on page reload (no rebuild).

```yaml
player:
  height: 1.7           # Total player height (meters)
  eye_height: 1.6       # Camera Y offset from feet
  radius: 0.4           # Collision cylinder radius
  walk_speed: 4.5       # m/s
  sprint_speed: 8.0     # m/s
  mouse_sensitivity: 0.002  # rad/px (desktop only)
  touch_look_multiplier: 0.008  # rad/px (mobile only, calibrated separately)
  head_bob_speed: 12.0  # bob frequency
  head_bob_amount: 0.04 # bob amplitude (meters)
  gravity: 20.0         # m/s²
  jump_velocity: 7.0    # m/s upward

environment:
  model: "hintze_hall.glb"
  background_color: "#111122"    # Scene background + fog color
  ambient_intensity: 0.15        # AmbientLight
  hemisphere_sky_color: "#ccddff"
  hemisphere_ground_color: "#111133"
  hemisphere_intensity: 0.3
  convert_to_basic: false        # true=MeshBasicMaterial (baked), false=PBR

spawn:
  position: [20, 0, 20]  # X, Y, Z — Y is overridden by ground snap
  yaw: 0                  # Initial look direction (radians)

fog:
  enabled: true
  color: "#111122"
  density: 0.003          # FogExp2 density

lights:  # Array of point lights
  - type: point
    position: [x, y, z]
    color: "#hex"
    intensity: float
    distance: float       # Attenuation distance

pickable_items:  # Array
  - id: string
    name: string
    description: string
    icon: string          # gem|coin|herb|key|scroll
    color: "#hex"
    emissive: "#hex"
    position: [x, y, z]
    scale: float
    shape: octahedron|dodecahedron|icosahedron|torus|cylinder|sphere|cube
    float_amplitude: float
    float_speed: float
    rotation_speed: float

interaction:
  pickup_range: 3.0      # Max distance for center-screen raycast
  pickup_prompt: "[E] Pick up"
  highlight_color: "#ffffff"
  highlight_intensity: 0.3

inventory:
  max_slots: 20
  columns: 5

mobile:
  joystick_size: 120
  joystick_deadzone: 0.15
  look_zone_width_percent: 55
  sprint_button: true
  pause_button: true
  pickup_button: true
```

---

## 7. Deployment Procedure

```bash
# From project root
cd /Users/core/coresapian_inc/Codebases/Alfheim/coresapian

# Deploy single file
FILE=public/explorer/js/physics.js
cat "$FILE" | ssh root@192.168.0.10 "cat > /tmp/explorer-file"
ssh root@192.168.0.10 "pct push 103 /tmp/explorer-file /var/www/coresapian/explorer/js/physics.js"

# Deploy all explorer files (text only, skip GLB)
for f in public/explorer/index.html public/explorer/config.yaml public/explorer/js/*.js; do
  dest="/var/www/coresapian/explorer/${f#public/explorer/}"
  cat "$f" | ssh root@192.168.0.10 "cat > /tmp/explorer-file"
  ssh root@192.168.0.10 "pct push 103 /tmp/explorer-file $dest"
done

# Deploy GLB (149 MB, only needed once)
cat public/explorer/hintze_hall.glb | ssh root@192.168.0.10 "cat > /tmp/explorer-file"
ssh root@192.168.0.10 "pct push 103 /tmp/explorer-file /var/www/coresapian/explorer/hintze_hall.glb"

# Verify
curl -sI https://coresapian.com/explorer/ | head -5

# Git commit (push blocked by LFS issue -- see below)
git add public/explorer/ && git commit -m "descriptive message"
```

**LFS blocker:** 28 pre-existing LFS objects are missing from local `.git/lfs` cache. `git push org main` fails. Fix options:
1. `git lfs fetch --all` from remote (if remote has the objects)
2. `git lfs migrate import` to clean history
3. Re-clone the repo fresh

**Nginx config:** The `/explorer/` location block must override COEP to `credentialless` (the global config uses `require-corp` which blocks CDN Three.js). This is already in the live config at `/etc/nginx/sites-available/coresapian` on LXC 103.

---

## 8. Testing Checklist

### Desktop (Chrome/Firefox/Safari)
- [ ] Page loads, loading bar progresses, blocker appears
- [ ] Click blocker → pointer lock engages, crosshair visible
- [ ] WASD movement works, camera-relative
- [ ] Mouse look works, pitch clamped ±~82°
- [ ] Shift sprints (faster movement, faster head bob)
- [ ] Space jumps, gravity pulls back down
- [ ] Walking into walls stops movement (wall collision)
- [ ] Can walk up slight inclines/stairs
- [ ] Crosshair highlights items when aimed at within 3m
- [ ] E key picks up item, item disappears, bag count increments
- [ ] Tab/B opens inventory panel, shows collected items
- [ ] Escape exits pointer lock, shows blocker
- [ ] Escape while inventory open closes inventory first
- [ ] Bag icon click opens inventory

### Mobile (iOS Safari, Chrome Android)
- [ ] Touch detected, mobile UI visible (joystick, look zone, buttons)
- [ ] Joystick drag moves player, release stops
- [ ] Right-side drag rotates camera
- [ ] Pause button exits synthetic lock
- [ ] Sprint button works (hold to sprint)
- [ ] Pickup button collects highlighted item
- [ ] Fullscreen entered on lock (iOS 16.4+)
- [ ] Orientation prompt shows in portrait, dismissible
- [ ] No browser scroll/zoom interference

### Collision
- [ ] Player does NOT fall through floor
- [ ] Player does NOT walk through walls
- [ ] Player spawns on floor, not floating or inside geometry
- [ ] Jump works, player returns to ground
- [ ] Safety clamp works (y < -100 resets to spawn)

### Performance
- [ ] 60fps on desktop (mid-range GPU)
- [ ] 30fps on mobile (iPhone 12 or equivalent)
- [ ] Memory stays under 500 MB
- [ ] No visible frame drops during movement

---

## 9. File Sizes

```
hintze_hall.glb   149.1 MB  (Git LFS tracked)
index.html         13.9 KB
config.yaml         3.2 KB
js/state.js         2.0 KB
js/config.js        6.9 KB
js/pointer-lock.js  6.4 KB
js/mobile-controls.js  4.3 KB
js/physics.js       7.4 KB
js/scene-objects.js 6.6 KB
js/interaction.js   4.7 KB
js/main.js          6.4 KB
─────────────────────────────
Total (excl. GLB)  ~62 KB   (miniscule, no build step)
```

---

## 10. Priority Roadmap

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Fix collision (BVH or horizontal raycasts) | 1-2 days | Unplayable without it |
| P0 | Developer mode (?dev URL param) | 0.5 day | Essential for debugging |
| P0 | Map model bounds + find safe spawn points | 2 hours | Player stuck on load |
| P1 | Draco-compressed GLB (reduce 149MB → ~40MB) | 1 day | Unusable on slow connections |
| P1 | Inventory V2 (drag-drop, examine, drop, rarity) | 2 days | Core gameplay loop |
| P1 | localStorage persistence (inventory, collected items) | 0.5 day | Items respawn on reload |
| P1 | BVH for collision meshes | 1 day | Performance for large scenes |
| P2 | Quest/hint system | 1 day | Gameplay depth |
| P2 | Minimap | 1 day | Navigation in large space |
| P2 | Ambient audio (Web Audio API) | 0.5 day | Atmosphere |
| P2 | Mobile gyroscope look | 0.5 day | Better mobile experience |
| P3 | Atmosphere (dust, flicker, crouch) | 1-2 days | Polish |
| P3 | NPC proximity awareness | 1 day | Interactivity |
| P3 | VHS timestamp overlay | 2 hours | Aesthetic |

---

## 11. Key Technical Decisions Log

| Decision | Rationale | Date |
|----------|-----------|------|
| PBR materials (convert_to_basic: false) | hintze_hall.glb uses real PBR materials, not baked lightmaps. MeshBasicMaterial made everything flat. | 2026-05-28 |
| NoToneMapping | ACESFilmic at exposure 1.0 overexposed the scene | 2026-05-28 |
| COEP: credentialless for /explorer/ | Global `require-corp` blocks CDN Three.js. Credentialless allows cross-origin without CORS grants. | 2026-05-28 |
| Multi-ray ground detection | Single raycast hits suspended objects (dinosaur skeleton). Multiple rays with lowest-point selection finds real floor. | 2026-05-28 |
| findFloor() scans ALL hits | Even multi-ray was picking skeleton (hit[0]). Now scans all intersection points per ray and picks the lowest Y = real floor. | 2026-05-28 |
| Spawn at [20,0,20] | Center [0,0,0] is directly on/inside the dinosaur skeleton. Moving 20m off-center lands in open gallery space. | 2026-05-28 |
| Direct deployment (scp/pct push) | Git push blocked by 28 missing LFS objects. Files deployed directly to bypass. | 2026-05-28 |
| Touch look multiplier 0.008 (not mouse_sens) | Mouse has sub-pixel precision. Touch has discrete finger drags. 0.008 gives ~180° per full swipe. | 2026-05-28 |
