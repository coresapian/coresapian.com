# CORESAPIAN — Nine Realms First-Person RPG — Execution Plan

## Product Summary
Production-ready 3D first-person Norse mythology RPG for the browser. Nine realms, FPS combat (melee/shield/bow/rune magic), RPG progression (XP, skill trees, inventory, crafting), quest campaign with branching dialogue, procedural world events, and always-online multiplayer with a dedicated authoritative server.

## Key Technical Decisions
- **Client**: Vite + React (HUD/menus shell) + Three.js (imperative game engine singleton). TypeScript throughout. Low-poly stylized aesthetic + runic CRT UI overlay (scanlines, phosphor glow, runic glyphs).
- **Server**: Node dedicated server — HTTP static serving + WebSocket authoritative multiplayer layer. Server authority over player state, inventory ops, and combat resolution (client-predicted, server-reconciled at snapshot level).
- **Godot 4.6 note**: No Godot toolchain exists in this build/verify environment, and "functional verification on deploy" is a hard requirement — so the deliverable is a web-native Three.js build (the browser deployment target itself). System boundaries (scene graph, tick loop, net protocol) are kept engine-agnostic for a future Godot port.
- **Deploy**: `dynamic` website version (Dockerfile at repo root). Server serves client with content-hashed assets + long-cache headers, CSP-compliant shell, build-version stamp injected at build time.

## Stage 0 — Workspace & Skills
Load `vibecoding-webapp-swarm` (orchestration) + `swarm-workspace` (worktree setup). Scaffold repo.

## Stage 1 — Architecture & Design Contracts (plan agent)
Deliverables: `docs/DESIGN.md` + `src/shared/*` —
- Realm config schema (9 realms: palette, fog, sky, terrain noise params, props, enemies, music mode)
- Net protocol (message types, snapshot format, tick rates)
- Game systems contracts: stats, items, skills, quests, dialogue, crafting recipes (data-driven JSON/TS)
- Module boundaries so parallel coders never collide.

## Stage 2 — Client Build Swarm (parallel coders, isolated worktrees)
1. **Core engine**: FPS controller (pointer lock, WASD, jump, capsule physics vs. heightfield/props), interaction/grab, game loop, quality scaling.
2. **World/Realms**: procedural terrain per realm, biome props, sky/lighting/fog, portals with transition FX, minimap data.
3. **Combat**: melee arcs, shield block/parry, bow projectiles, 4 rune schools, cooldowns, damage pipeline, hit FX.
4. **Enemies/AI**: FSM (idle/patrol/aggro/attack/flee), draugr/wolf/troll/valkyrie/giant + realm bosses, spawners, roaming world events.
5. **RPG systems**: XP/levels, skill tree, inventory, equipment, crafting, loot tables, realm abilities.
6. **Quests/NPCs**: NPC schedules, shops, branching dialogue runtime, quest log, factions, campaign questline.
7. **UI/UX**: runic CRT HUD (health/mana/stamina, compass, hotbar), menus, loading screen w/ version stamp, damage numbers, settings, reconnect banner.
8. **Audio**: WebAudio procedural engine — per-realm ambient drones, positional SFX, combat/UI sounds, Old-Norse-style vocal pads (synthesized formants).

## Stage 3 — Server Backend (backend-building-swarm composition)
- WS gateway: join/leave, input ingestion, 10Hz snapshots, orb-avatar + nametag relay
- Authority: inventory/combat validation, anti-teleport sanity checks
- Reconnect contract: client auto-retry every 3s, world visible during connect
- Dockerfile + CSP headers + content-hash cache policy + version stamp endpoint.

## Stage 4 — Integration, Build, Verify
- Merge branches, `npm run build`, boot server, browser smoke test (spawn, realm travel, combat, HUD, reconnect banner), screenshot verification. Reviewer + verifier agents; fix loop until pass.

## Stage 5 — Delivery
`website_version_manager build_version` (type: dynamic) + final report.
