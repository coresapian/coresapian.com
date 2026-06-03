# Plan: Floating Browser Terminals in Godot Aztec Temple

**Status:** Deployed  
**Date:** 2026-04-28  
**Commits:** `2580621` → `1eb6a9f` → `37bef76` → `e17f56e`

---

## Overview

Two interactable 3D objects added to the Aztec temple in the Godot game that
open floating browser overlays (iframes) when the player interacts with them.
Built via a JavaScript bridge: Godot signals → JavaScript creates HTML overlays
on top of the game canvas.

---

## What Was Built

### Browser Overlay System

| File | Role |
|------|------|
| `godot/autoloads/browser_overlay.gd` | Godot autoload singleton. `open_browser(url, title)` calls `JavaScriptBridge.eval()` on web exports. Logs warning on native. |
| `public/shared/browser-overlay.js` | IIFE that exposes `window.__coresapianShowBrowser(url, title)` and `window.__coresapianCloseBrowser()`. Creates a full-viewport iframe modal with Matrix-green theme, close button, Escape-key dismissal, and slide-up animation. |

### Temple Objects

| Object | Position | Visual | Opens |
|--------|----------|--------|-------|
| `CodexPedestal` | Left temple wall (-3.5, 1.0, -3.5) | Stone pedestal + cyan glowing crystal, "Codex" label | `/core_truths_book/` |
| `RuneStone` | Right temple wall (3.5, 1.0, -3.5) | Stone pedestal + floating ᚲᛟᚱᛖ label, blue glow | `/rune_puzzle/` |

Each has:
- `StaticBody3D` with `groups=["interactable"]`
- `CollisionShape3D` (SphereShape3D, radius 0.9)
- Metadata: `interact_text`, `browser_url`, `browser_title`

### Interaction System Extension

`player_controller.gd` `_try_interact()` now checks for `browser_url` metadata
**before** the existing text-message logic. Objects with `browser_url` open the
overlay; objects without it fall through to the original `on_interact_message`
behavior (e.g., the altar still says "The temple hums with ancient energy.").

### Autoload Registration

`godot/project.godot`:
```ini
[autoload]
NetworkManager="*res://autoloads/network_manager.gd"
BrowserOverlay="*res://autoloads/browser_overlay.gd"
```

### Game Shell

`public/game/index.html` loads `browser-overlay.js` before the Godot engine bootstrap:
```html
<script src="../shared/browser-overlay.js"></script>
```

---

## Bugs Encountered During Deployment

### Bug 1: GDScript Parse Error — `identifier "delta" not declared`

**Symptom:** `Parse Error: Identifier "delta" not declared in the current scope. at: network_manager.gd:166`

**Root cause:** Our code-review reconnect logic added `_ws_reconnect_timer += delta` inside
`_poll_world_chat()`, but the function had `func _poll_world_chat() -> void` (no
parameter). `_process(delta)` called it without passing `delta`.

**Fix:** Changed to `func _poll_world_chat(delta: float) -> void` and
`_poll_world_chat(delta)` in `_process()`.

**Commit:** `1eb6a9f`

### Bug 2: Missing Lobby Scene in Web Export

**Symptom:** `ERROR: Cannot open file 'res://scenes/lobby.tscn'. ERROR: Failed loading scene: res://scenes/lobby.tscn.`

**Root cause:** `export_presets.cfg` had `export_filter="scenes"` with
`export_files=PackedStringArray("res://scenes/main.tscn")`. Godot's scene export
mode does NOT statically trace `change_scene_to_file()` calls — it only includes
explicitly listed scenes and their instantiated dependencies. Since
`lobby.tscn` transitions to `main.tscn` via code (`_enter_game()`), lobby was
never included.

**Fix:** Changed to `export_files=PackedStringArray("res://scenes/lobby.tscn", "res://scenes/main.tscn")`.
This ensures both scenes and their full dependency trees (temple, player, chat
widget, autoloads, resources) are packed.

**Commits:** `37bef76` (first attempt: lobby only — also wrong), `e17f56e` (both scenes)

### Bug 3: World Chat Disconnects (Expected)

**Symptom:** `World Chat WS disconnected, will reconnect...` repeating every 5s.

**Root cause:** `network_manager.gd` has `WORLD_CHAT_API_KEY := ""` — the World
Chat server requires a valid API key and closes the connection with code 1008.
The reconnect timer works correctly (it retries every 5s) but will never
succeed without a real key.

**Status:** Not a bug per se — expected behavior. Set `WORLD_CHAT_API_KEY` in
`network_manager.gd` to a valid key from `CORE_CHAT_API_KEYS` env var to enable
in-game global chat.

### CSP Warnings (Cosmetic)

**Symptom:** `Loading the script '<URL>' violates CSP directive: "script-src 'unsafe-inline' 'unsafe-eval'". ...report-only...`

**Root cause:** Cloudflare injects challenge-platform scripts and RUM analytics
that trigger Godot WebGL's CSP. These are `report-only` — nothing is blocked.
Cloudflare's `connect-src 'none'` also triggers but is report-only. No
functional impact.

---

## Deployment

### GitHub
Branch: `self-host-vps` → `origin` (github.com/coresapian/coresapian_com)

### Proxmox LXC 103 (192.168.0.148)
Files synced via rsync:
```
/var/www/coresapian/game/index.html     — updated with browser-overlay.js reference
/var/www/coresapian/game/index.js       — Godot engine JS (315KB)
/var/www/coresapian/game/index.pck      — Godot game data (57MB) — includes new temple objects
/var/www/coresapian/game/index.wasm     — Godot engine WASM (37.6MB)
/var/www/coresapian/shared/browser-overlay.js — browser overlay JS (5KB)
```

**Live URL:** https://coresapian.com/game/index.html

---

## coreChat Integration Status

coreChat is **not** integrated into the Godot game. It is a standalone
self-hosted IRC web client (Node.js, served at `/chat` behind nginx). It
connects to IRC servers (Libera.Chat, etc.), not to the Godot game.

The in-game communication is handled by:
1. `chat_widget.gd` — ENet RPC chat (same-session multiplayer)
2. World Chat WebSocket (`/ws/world-chat`) — cross-server global chat (Python server)

coreChat can be accessed directly at https://coresapian.com/chat or could be
added as a third temple interactable object ("Mirror of Voices" → `/chat`).

---

## Files Changed

| File | Change |
|------|--------|
| `godot/autoloads/browser_overlay.gd` | **Created** — Godot↔JS bridge autoload |
| `godot/autoloads/network_manager.gd` | **Modified** — added `delta` param to `_poll_world_chat()` |
| `godot/project.godot` | **Modified** — registered `BrowserOverlay` autoload |
| `godot/export_presets.cfg` | **Modified** — export both `lobby.tscn` and `main.tscn` |
| `godot/scenes/core_truths/core_truths.tscn` | **Modified** — added `CodexPedestal` and `RuneStone` nodes |
| `godot/scenes/core_truths/player_controller.gd` | **Modified** — `_try_interact()` checks `browser_url` meta |
| `public/shared/browser-overlay.js` | **Created** — JS iframe overlay manager |
| `public/game/index.html` | **Modified** — loads `browser-overlay.js` |

---

## Player Flow

1. Player joins game → lobby screen → clicks Host/Join → loads temple scene
2. Walks toward **Codex Pedestal** (cyan glow, left wall) → sees "Press E to read the Codex of Truths"
3. Presses E → full-viewport iframe overlay slides up showing `coresapian.com/core_truths_book/`
4. Presses Escape or clicks ✕ → overlay closes, game canvas refocused
5. Walks toward **Rune Stone** (blue glow, right wall, ᚲᛟᚱᛖ runes) → sees "Press E to touch the Rune Stone"
6. Presses E → overlay opens with `coresapian.com/rune_puzzle/`
7. Original altar interaction still works (no `browser_url` → shows text message)
