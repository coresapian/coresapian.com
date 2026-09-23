# CoreSapian.com

A 3D first-person interactive experience built with Godot 4.6, deployed as a WebGL web app.
Features an Orange Phosphor CRT terminal UI, real-time anonymous chat, and multiplayer
exploration with glowing orbs.

## Architecture

```
                    Cloudflare Tunnel (HTTPS)
                           │
                    ┌──────▼──────┐
                    │  LXC 103    │
                    │  nginx :80  │
                    └──┬───────┬──┘
           Static files │       │ /ws, /ws/chat, /ws/mp (WebSocket)
              /var/www/ │       │
                       │  ┌────▼─────────────┐
              ┌────────┘  │ Node.js :8082    │
              │           │ Unified relay    │
              ▼           │ (mp_server.js:   │
     Godot WebGL build    │  multiplayer     │
     (index.html +        │  orbs + chat)    │
      index.js +          └──────────────────┘
      index.wasm +
      index.pck)
```

### Services

| # | Service | Stack | Port | systemd Unit | Purpose |
|---|---------|-------|------|-------------|---------|
| 1 | Web Server | nginx | 80 | (system) | Static files + WebSocket proxy |
| 2 | Unified Relay | Node.js + `ws` | 8082 | `coresapian-mp.service` | Multiplayer orb positions + real-time chat (v3 merged) |
| 3 | Health Check | Python 3 + cron | — | `coresapian-health-check.timer` | Status page monitoring |
| 4 | Godot Dedicated Server | Godot 4.6 headless | 8083 | `coresapian-godot.service` | High-level multiplayer relay (bare PCK) |

### Dedicated Server Mode

The server binary (`exports/coresapian-server.x86_64`, exported via `scripts/export_godot_all.sh`) runs as a bare multiplayer relay on LXC 103:

- **Activation**: env var `CORESAPIAN_SERVER_PORT=8083` (systemd unit `coresapian-godot.service`, `WorkingDirectory=/opt/coresapian-godot-server`). When set, `godot/scenes/main.gd` calls `NetworkManager.start_dedicated_server(port)` and skips the temple scene entirely.
- **Bare relay PCK**: the server PCK is exported without the temple scene — no inventory nodes.
- **ExpressoBits Inventory constraint (SEGV)**: the `inventory-system` GDExtension (v2.13.0) SEGVs on Godot 4.6 headless Linux when inventory nodes are instantiated. Web (wasm) and desktop builds are unaffected. The dedicated server must therefore NEVER load scenes containing inventory nodes — the bare-relay PCK is the contract. Do not add inventory nodes to the server export preset.
- **Always-online clients**: web clients spawn immediately on load and connect to the relay in the background; on failure a "Connecting to server..." banner shows and auto-retries every 3 s. There is no offline fallback mode.

### nginx Routes

| Path | Backend | Protocol | Purpose |
|------|---------|----------|---------|
| `/` | `/var/www/coresapian/` | HTTP | Root landing (loads Godot game) |
| `/game/` | `/var/www/coresapian/game/` | HTTP | Engine assets (wasm, pck, js) |
| `/ws` | `127.0.0.1:8082` | WebSocket | Exact-match game client endpoint (unified relay) |
| `/ws/chat` | `127.0.0.1:8082` | WebSocket | Anonymous chat (unified relay) |
| `/ws/mp` | `127.0.0.1:8082` | WebSocket | Multiplayer orbs relay (unified relay) |

## Project Structure

```
coresapian/
├── godot/                          # Godot 4.6 project source
│   ├── project.godot               # Project config + autoloads
│   ├── web_shell.html              # Custom HTML shell template
│   ├── export_presets.cfg          # Web + iOS export presets
│   ├── scenes/
│   │   ├── main.gd/tscn            # Main entry point + fade overlay
│   │   ├── player_orb.gd           # Remote player orb visualization
│   │   ├── core_truths/            # Main scene + player controller
│   │   └── ui/
│   │       └── settings_menu.gd    # In-game settings panel
│   ├── autoloads/
│   │   ├── network_manager.gd      # WebSocket multiplayer connection
│   │   └── multiplayer_orbs.gd     # Remote player orb management
│   └── resources/                  # 3D models, textures
│
├── public/                         # Static web root
│   ├── index.html                  # Sole entry point → loads Godot game
│   ├── game/                       # Godot WebGL build output
│   │   ├── index.js                # Godot engine JS
│   │   ├── index.wasm              # Godot engine WASM
│   │   ├── index.pck               # Game data pack
│   │   ├── game-shell.js           # CRT loader + chat + UI
│   │   ├── game-shell.css          # Orange Phosphor CRT theme
│   │   └── index.audio.*.worklet.js
│   ├── robots.txt
│   ├── 404.html
│   └── favicon.ico
│
├── server/                         # Backend services
│   ├── mp_server.js                # Unified multiplayer + chat relay (v3)
│   ├── config.js                   # Env-overridable relay config
│   ├── package.json                # npm manifest (ws)
│   ├── nginx_coresapian.conf       # Canonical nginx site config
│   └── templates/                  # Rendered by scripts/deploy-servers.sh
│       ├── mp-server.service       # systemd unit template
│       ├── nginx-websocket.conf    # WS proxy snippet template
│       └── fail2ban-jail.conf      # Fail2Ban jail template
│
├── scripts/                        # Ops scripts
│   ├── deploy.sh                   # Auto-versioning deploy (hashes + scp)
│   ├── health-check.py             # Service status checker
│   ├── coresapian-health-check.service
│   ├── coresapian-health-check.timer
│   ├── export_godot_web.sh         # Godot → WebGL export
│   ├── export_godot_all.sh         # Export all platforms
│   ├── install_godot_export_templates.sh
│   └── honeypot/                   # Fail2Ban + honeypot configs
│
└── assets/
    ├── audio/                      # Music + sound effects
    └── images/                     # Branding assets
```

## Deployment

### Prerequisites
- Godot 4.6 stable with web export templates
- SSH to the Proxmox host (root@192.168.0.10) — LXC 103 is reached via
  `pct exec 103` only; never SSH the LXC IP directly
- Node.js 20+ on LXC 103

### Web Build + Deploy
```bash
# Export Godot WebGL build
bash scripts/export_godot_web.sh

# Deploy with auto-versioning (content hashes for cache busting)
# Runs on macOS; reaches LXC 103 through the Proxmox host
bash scripts/deploy.sh
```

### Relay Deploy
```bash
# Deploy the unified relay (mp_server.js + systemd + nginx WS routes)
bash scripts/deploy-servers.sh
```

### Verify
```bash
# Web
curl -I https://coresapian.com/
# Relay
ssh root@192.168.0.10 "pct exec 103 -- systemctl status coresapian-mp"
# WebSocket
wscat -c wss://coresapian.com/ws/chat
```

## Unified Relay Protocol (v3)

One Node.js `ws` server (`server/mp_server.js`) on port 8082 serves both
multiplayer positions and chat. Messages are JSON. No authentication, no
usernames.

```json
// Client → Server
{"type": "pos", "x": 1.2, "y": 0.0, "z": -3.4, "ry": 0.5, "rx": 0.1}
{"type": "chat", "text": "hello world", "name": "optional"}
{"text": "hello world"}                       // panel style (no type) also works
{"type": "typing", "name": "optional"}
{"type": "hello", "name": "optional"}     // join announcement (once)
{"type": "ping", "t": 1234567890}

// Server → Client
{"type": "init", "id": "p1a2b"}
{"type": "history", "messages": [ ... ]}  // last chat messages, on connect
{"type": "roster", "players": [{"id": "p1a2b", "name": "someone"}]}  // players already connected (once, after init)
{"type": "join", "id": "p1a2b"}
{"type": "leave", "id": "p1a2b"}
{"type": "pos", "id": "p1a2b", "x": 1.2, "y": 0.0, "z": -3.4, "ry": 0.5, "rx": 0.1}
{"type": "chat", "id": "p1a2b:1727212345678:42", "name": "someone", "text": "hello", "timestamp": "2026-09-22T...Z"}
{"type": "typing", "id": "p1a2b", "name": "someone"}
{"type": "system", "message": "..."}
{"type": "pong", "t": 1234567890}          // echo to sender only
{"type": "shutdown"}                        // server is restarting
```

- Chat `id` is a **unique per-message id** (`<playerId>:<ms>:<seq>`), not
  the sender id — clients dedupe on it
- History is sent as `{"type": "history", "messages": [...]}`, not a
  bare array
- Max 200 messages persisted in `/data/chatlog.json`
- Max 500 characters per message
- Max 500 concurrent clients; **20 concurrent WS connections per IP**
  (nginx `limit_conn` on the `/ws*` locations)
- Rate limits: 30 messages/second per client (all types), 1 chat message
  per second per client, typing indicators throttled
- 15-second ping/pong heartbeat

## Security

- **Headers**: COOP `same-origin`, COEP `require-corp`, CORP `same-origin`,
  `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **Sensitive files**: nginx denies dotfiles, `.env`, `.sql`, `.bak`, `.key`, `.pem`
- **Honeypot**: Canary paths tarpit attackers + Fail2Ban auto-ban
- **Chat**: No auth, no PII, rate-limited, anonymous
- **Servers bind localhost only**: nginx proxies external traffic
- **Origin policy**: the relay is anonymous-by-design; `MP_ALLOWED_ORIGINS`
  is an exact-hostname allowlist (abuse-mitigation, not authentication —
  subdomains must be listed explicitly). Non-browser clients that send no
  `Origin` are rejected unless `MP_ALLOW_ORIGINLESS=1`.
- **Env validation**: integer config values are range-checked at startup;
  out-of-range values abort the relay instead of starting misconfigured.
- **Real IPs behind the tunnel**: nginx restores visitor IPs from
  `CF-Connecting-IP` (trusted only because the origin is reachable solely
  via the Cloudflare Tunnel), so per-IP `limit_conn` works as documented.
- **No secrets in repo**: All credentials via `.env` (gitignored)

## License

See [LICENSE](LICENSE).
