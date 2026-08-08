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
           Static files │       │ /ws/chat (WebSocket)
              /var/www/ │       │
                       │  ┌────▼─────────────┐
              ┌────────┘  │ Node.js :3001    │
              │           │ Anonymous Chat   │
              ▼           │ (anonymous_      │
     Godot WebGL build    │  chat_server.js) │
     (index.html +        └──────────────────┘
      index.js +
      index.wasm +
      index.pck)
```

### Services

| # | Service | Stack | Port | systemd Unit | Purpose |
|---|---------|-------|------|-------------|---------|
| 1 | Web Server | nginx | 80 | (system) | Static files + WebSocket proxy |
| 2 | Anonymous Chat | Node.js + `ws` | 3001 | `coresapian-anonymous-chat.service` | Real-time anonymous WebSocket chat |
| 3 | Multiplayer Orbs | Node.js + `ws` | 8082 | `coresapian-mp.service` | Real-time player position relay |
| 4 | Health Check | Python 3 + cron | — | `coresapian-health-check.timer` | Status page monitoring |
| 5 | Godot Dedicated Server | Godot 4.6 headless | 8083 | `coresapian-godot.service` | High-level multiplayer relay (bare PCK) |

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
| `/ws/chat` | `127.0.0.1:3001` | WebSocket | Anonymous chat |
| `/ws/mp` | `127.0.0.1:8082` | WebSocket | Multiplayer orbs relay |

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
│   ├── mp_server.js                # Multiplayer orbs relay
│   ├── mp_package.json             # npm manifest for mp_server
│   ├── coresapian-mp.service       # systemd unit for mp_server
│   ├── anonymous_chat_server.js    # Node.js WebSocket chat
│   ├── package.json                # npm manifest (ws)
│   ├── coresapian-anonymous-chat.service  # systemd unit
│   ├── deploy_anonymous_chat.sh    # Deployment script
│   └── nginx_coresapian.conf       # Canonical nginx config
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
- SSH access to LXC 103 (root@192.168.0.148)
- Node.js 20+ on LXC 103

### Web Build + Deploy
```bash
# Export Godot WebGL build
bash scripts/export_godot_web.sh

# Deploy with auto-versioning (content hashes for cache busting)
bash scripts/deploy.sh
```

### Chat Server Deploy
```bash
bash server/deploy_anonymous_chat.sh
```

### Verify
```bash
# Web
curl -I https://coresapian.com/
# Chat server
systemctl status coresapian-anonymous-chat
# WebSocket
wscat -c wss://coresapian.com/ws/chat
```

## Anonymous Chat Protocol

Messages are broadcast to all connected clients. No authentication, no usernames.

```json
// Client → Server
{"text": "hello world"}

// Server → Client (broadcast)
{"text": "hello world", "timestamp": "2026-06-05T14:32:00Z"}

// On connect: receive history
[{"text": "...", "timestamp": "..."}, ...]
```

- Max 200 messages persisted in `/data/chatlog.json`
- Max 500 characters per message
- Max 500 concurrent clients
- Rate limit: 10 messages per 10 seconds per client
- 30-second ping/pong heartbeat
- Debounced saves (2s coalesce)

## Security

- **Headers**: COOP `same-origin`, COEP `require-corp`, CORP `same-origin`,
  `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **Sensitive files**: nginx denies dotfiles, `.env`, `.sql`, `.bak`, `.key`, `.pem`
- **Honeypot**: Canary paths tarpit attackers + Fail2Ban auto-ban
- **Chat**: No auth, no PII, rate-limited, anonymous
- **Servers bind localhost only**: nginx proxies external traffic
- **No secrets in repo**: All credentials via `.env` (gitignored)

## License

See [LICENSE](LICENSE).
