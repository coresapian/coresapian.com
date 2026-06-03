# CoreSapian.com — Code Review

**Date**: 2026-04-28  
**Scope**: Full repository audit  
**Files reviewed**: 42 source files across Python, GDScript, Bash, JS/HTML/CSS, systemd units, and config

---

## BUGS

### BUG-1: Missing `coresapian-world-chat.service` systemd file

**Files**: `scripts/deploy-coresapian.sh` line 287  
**Impact**: Deploy script runs `systemctl restart coresapian-world-chat.service` but the service file **does not exist in the repository**. If the service hasn't been manually created on the LXC, the deploy will fail silently.  
**Fix**: Create `server/coresapian-world-chat.service` with:

```ini
[Unit]
Description=CoreSapian World Chat Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/coresapian/.venv/bin/python /opt/coresapian/server/world_chat_server.py
WorkingDirectory=/opt/coresapian/server
Environment=CORE_CHAT_API_KEYS=%CORE_CHAT_API_KEYS%
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

---

### BUG-2: `nginx_stream_enet.conf` proxies to wrong port

**File**: `server/nginx_stream_enet.conf` line 17  
**Impact**: The reference config contains `server 127.0.0.1:7000` in the upstream block, which proxies port 7000 back to itself. The Godot server listens on port 7001, not 7000.  
**Note**: The `deploy-coresapian.sh` script generates the correct config (`proxy_pass 127.0.0.1:7001`), but the reference file in the repo is wrong and could confuse someone using it directly.  
**Fix**: Change line 17 to `server 127.0.0.1:7001;`

---

### BUG-3: ENet relay port mismatch (7070 vs 7000)

**File**: `server/coresapian-enet-relay.service` line 12  
**Impact**: The systemd unit sets `WS_LISTEN_PORT=7070`, but:
- The nginx config does **not** proxy any WebSocket traffic to port 7070
- The Python code defaults to port 7000
- The deploy script doesn't configure nginx for port 7070

This means the ENet relay runs on port 7070 but has **no route from the outside world** — it's unreachable.  
**Fix**: Either (a) change to `WS_LISTEN_PORT=7000` and add nginx proxy for `/ws/enet`

---

### BUG-4: `game-shell.js` monkey-patches global `window[name]` without cleanup

**File**: `public/game/game-shell.js` lines 67-86  
**Impact**: The `installAudioContextTracker()` function replaces global constructors (`AudioContext`, `webkitAudioContext`) with tracked subclasses. If multiple Godot instances load, or if another library depends on the original constructor identity, this causes subtle breakage.  
**Severity**: Low (unlikely in current single-instance setup)  
**Fix**: use a Proxy instead of class replacement.

---

## SECURITY

### SEC-1: `.cursor/mcp.json` hardcodes local filesystem paths

**File**: `.cursor/mcp.json` lines 6-10  
**Impact**: Contains `/Users/core/Documents/GitHub/godot-mcp/build/index.js` — a path specific to one machine. Committed to git, visible to anyone with repo access. Not a secret, but reveals local directory structure.  
**Fix**: Use environment variables

---

### SEC-2: `.env.example` contains real Cloudflare account/tunnel IDs

**File**: `.env.example` lines 24-25  
**Impact**: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_TUNNEL_ID` are real production identifiers. While not secrets themselves (they're public-facing IDs), combined with an API token they enable tunnel management. Best practice is to not commit infrastructure IDs to public repos.  
**Severity**: Low (repo is private)  
**Fix**: Replace with placeholder values like `"YOUR_ACCOUNT_ID"` and document in comments.

---

## MISSING FILES

### MISS-1: `coresapian-world-chat.service` (see BUG-1 above)

### MISS-2: `.env` validation in `ddns_godaddy.sh` doesn't source `.env`

**File**: `scripts/ddns_godaddy.sh`  
**Impact**: Unlike the deploy scripts (which now source `.env`), the DDNS script requires `GODADDY_KEY` and `GODADDY_SECRET` to be exported in the environment or passed on the command line. The systemd unit uses `EnvironmentFile=-/opt/coresapian/ddns/godaddy.env`, but there's no `.env` sourcing for manual runs.  
**Fix**: Add `.env` sourcing

---

## PERFORMANCE

### PERF-1: `terminal.js` loads 130KB WebNN/Transformers.js worker unconditionally

**File**: `public/core_truths_book/terminal.js` line 40  
**File**: `public/core_truths_book/workers/worker-Jy3fF0zp.js` (130KB+)  
**Impact**: The Oracle terminal loads a full Transformers.js worker (WebNN-backed LLM) on first click. This is a massive payload for what appears to be a decorative AI chat feature. Consider:
- Is this feature actually used in production?
- Can it be lazy-loaded only when the user opens the terminal?
- Can a smaller model be used?

Currently the worker is loaded **on page load** because `new Worker(...)` creates the worker immediately. The actual model loading happens on click (line 53: `oracleSpirit.postMessage({ type: 'load' })`), but the 130KB JS bundle is fetched on page load regardless.

**Fix** I dont want the terminal.js AI chat. we dont need it.

---

## DUPLICATION

### DUP-1: CSS variable palettes duplicated between stylesheets

**Files**: `public/core_truths_book/style.css` lines 7-36, `public/rune_puzzle/style.css` lines 7-51  
**Impact**: The "Matrix Cyberpunk Palette" CSS custom properties (`--void-black`, `--stellar-dark`, `--matrix-green`, etc.) are copy-pasted between two stylesheets. Any theme change requires editing both files.  
**Fix**: Extract to `public/shared/theme.css` and `@import` from both pages.

---

### DUP-2: Touch detection logic duplicated

**Files**: `public/shared/torch.js`, `public/rune_puzzle/puzzle.js` lines 4-23  
**Impact**: `torch.js` has inline touch detection, and `puzzle.js` has an identical but more structured `detectInputType()` implementation. The HTML pages also used to have inline touch detection (now removed).  
**Fix**: Extract touch detection to `public/shared/input-type.js` and import from both.

---

## CODE QUALITY

### CQ-1: `world_chat_server.py` — `asyncio.Future()` for infinite run

**File**: `server/world_chat_server.py` line 178  
**Impact**: The server uses `await asyncio.Future()` to block forever. The more idiomatic approach is `await asyncio.Event().wait()`. Both work identically, but `Event().wait()` signals intent more clearly.  
**Severity**: change to more idiomatic approach `await asyncio.Event().wait()`

---

### CQ-2: `enet_ws_relay.py` — bare `except Exception` in handler

**File**: `server/enet_ws_relay.py` lines 91-92  
**Impact**: The `handler()` function catches `except Exception as e` without distinguishing between expected disconnections and unexpected errors. A `ConnectionClosed` should be handled differently from a programming error.  
**Fix**: Catch `ConnectionClosed` explicitly, log unexpected errors with traceback.

---

### CQ-3: `game-shell.js` — `let` used for constants

**File**: `public/game/game-shell.js` lines 16-19  
**Impact**: `initializing`, `statusMode`, `toolbarHideTimer`, `audioEnabled` are declared with `let` but several are effectively configuration constants (e.g., `initializing` is only set once). Use `const` where possible.  
**Severity**: fix with `const` everywhere

---

### CQ-4: `chat_widget.gd` — duplicate auto-hide timer pattern

**File**: `godot/scenes/ui/chat_widget.gd` lines 136-140 and 151-155  
**Impact**: Both `_on_world_chat_message()` and `_add_message()` have identical 4-second auto-hide timer logic with the same closure.  
**Fix**: Extract to a helper method `_auto_hide_after(delay: float)`.

---

### CQ-5: `player_controller.gd` — `_process_local_input()` too long

**File**: `godot/scenes/core_truths/player_controller.gd` lines 87-118  
**Impact**: The function mixes input reading, movement calculation, velocity application, and RPC calls. Would benefit from being split into smaller functions.  
**Fix**: split into smaller functions

---

### CQ-6: `deploy-coresapian.sh` — comment references old IP

**File**: `scripts/deploy-coresapian.sh` line 5  
**Impact**: Comment says `Deploys all coresapian.com services to LXC 103 (192.168.0.148)` — this IP is now sourced from `.env` but the comment still has the old value hardcoded.  
**Fix**: Change to `Deploys all coresapian.com services to LXC $CT_ID` or remove the IP.

---

### CQ-7: `ddns_godaddy.sh` — `AUTH_HEADER` assignment has stray `***`

**File**: `scripts/ddns_godaddy.sh` line 97  
**Content**: `AUTH_HEADER=*** ${GODADDY_KEY}:${GODADDY_SECRET}"`  
**Impact**: There are three asterisks at the start of the RHS, before the variable expansion. This appears to be a partial redaction of a previously hardcoded token. The line should be:
```bash
AUTH_HEADER="sso-key ${GODADDY_KEY}:${GODADDY_SECRET}"
```
**Fix**: Remove the `***` and ensure it's `sso-key` (GoDaddy's API key prefix).

---

## DOCUMENTATION

### DOC-1: `PROXMOX_VM_DEPLOYMENT.md` references old GoDaddy DNS

**File**: `server/PROXMOX_VM_DEPLOYMENT.md` line 99  
**Content**: `DNS originally at GoDaddy (ns43/ns44.domaincontrol.com), now on Cloudflare nameservers.`  
**Impact**: The DDNS script still updates GoDaddy DNS records. The DNS moved to Cloudflare. coresapian inc is using a Cloudflare tunnel forDNS.  
**Fix**: update to Cloudflare being the DNS provider.

---

### DOC-2: `README.md` references `wss://coresapian.com/ws/world-chat`

**File**: `README.md`  
**Impact**: The World Chat WebSocket URL uses `wss://` but Cloudflare Tunnel terminates TLS, so nginx only serves HTTP. The WebSocket works because Cloudflare's edge proxies upgrade the connection, but the internal path is `ws://` not `wss://`.  
**Severity**: Low (works correctly, just technically inaccurate). Does nginx on LXC 103 serve HTTPS? If not, `wss://` is correct only because Cloudflare handles it.

---

## GODOT CODE NOTES

### GD-1: `network_manager.gd` — WebSocket reconnect timer declared but never used

**File**: `godot/autoloads/network_manager.gd` line 33  
**Impact**: `var _ws_reconnect_timer: float = 0.0` and `const WS_RECONNECT_INTERVAL := 5.0` are declared but the `_process()` method never implements reconnection logic — it only polls. If the WebSocket disconnects, it's never reconnected.  
**Fix**: Either implement reconnect in `_process()`.

---

### GD-2: `network_manager.gd` — `WORLD_CHAT_WS_URL` has no auth

**File**: `godot/autoloads/network_manager.gd` line 22  
**Impact**: The World Chat URL is `wss://coresapian.com/ws/world-chat` with **no `?api_key=...&username=...`** parameters. The `world_chat_server.py` requires an API key. This connection will always fail.  
**Fix**: Add API key and username query parameters, or source them from a config file.

---

### GD-3: `rune_puzzle.gd` — `ALL_GLYPHS` array missing 'ᛖ'

**File**: `godot/optional/scenes/rune_puzzle/rune_puzzle.gd` lines 17-19  
**Impact**: The target word is `ᚲᛟᚱᛖ` (C-O-R-E), and `ᛖ` (E) is one of the 4 required glyphs. But `ᛖ` is **not** in the `ALL_GLYPHS` decoy array. The required glyphs are spawned separately (via `REQUIRED_GLYPH_SCREEN_SLOTS`), so the puzzle works correctly — but the decoy list is incomplete, making ᛖ never appear as a decoy.  
**Severity**: Very low (puzzle still works).  
**Fix**: Add `"ᛖ"` to `ALL_GLYPHS` for completeness.

---

## ACTION ITEMS

1. **Create** `server/coresapian-world-chat.service` — deploy will fail without it
2. **Fix** `nginx_stream_enet.conf` upstream port (7000→7001)
3. **Fix** ENet relay port mismatch (7070 vs 7000) or add nginx route for 7070
4. **Fix** `ddns_godaddy.sh` line 97 — broken `AUTH_HEADER` with stray `***`
5. **Fix** `network_manager.gd` — add API key to World Chat WebSocket URL or it will never connect
6. **Implement** WebSocket reconnect logic in `network_manager.gd` or remove dead timer variables
7. **Extract** shared CSS theme palette to `public/shared/theme.css`
8. **Fix** `chat_widget.gd` duplicate auto-hide timer
9. **Fix** `deploy-coresapian.sh` comment referencing old hardcoded IP
10. **Clarify** DNS situation in `PROXMOX_VM_DEPLOYMENT.md` (GoDaddy DDNS vs Cloudflare)
