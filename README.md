# CoreSapian.com

A 3D first-person lab experience built with Godot 4.6, deployed as a WebGL web app
and iOS app (WKWebView wrapper). Features an Orange Phosphor CRT Terminal UI,
real-time anonymous chat, and multiplayer temple exploration.

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
| 3 | Health Check | Python 3 + cron | — | `coresapian-health-check.timer` | Status page monitoring |

### nginx Routes

| Path | Backend | Protocol | Purpose |
|------|---------|----------|---------|
| `/` | `/var/www/coresapian/` | HTTP | Static files |
| `/game/` | `/var/www/coresapian/game/` | HTTP | Godot WebGL build |
| `/ws/chat` | `127.0.0.1:3001` | WebSocket | Anonymous chat |

## Project Structure

```
coresapian/
├── godot/                          # Godot 4.6 project source
│   ├── project.godot               # Project config
│   ├── web_shell.html              # Custom HTML shell template
│   ├── export_presets.cfg          # Web + iOS export presets
│   ├── scenes/
│   │   ├── lobby.gd/tscn           # Lobby / loading screen
│   │   ├── main.gd/tscn            # Main entry point
│   │   ├── core_truths/            # Player controller + world
│   │   └── ui/
│   │       └── settings_menu.gd    # Settings overlay
│   ├── autoloads/
│   │   ├── network_manager.gd      # WebSocket multiplayer
│   │   └── browser_overlay.gd      # iframe overlay bridge
│   ├── shaders/                    # Glow, godrays, matrix rain
│   └── resources/                  # 3D models, textures, fonts
│
├── public/                         # Static web root
│   ├── index.html                  # Root landing → game
│   ├── game/                       # Godot WebGL build output
│   │   ├── index.html              # Game shell HTML
│   │   ├── index.js                # Godot engine JS
│   │   ├── index.wasm              # Godot engine WASM
│   │   ├── index.pck               # Game data pack
│   │   ├── game-shell.js           # CRT loader + chat + UI
│   │   ├── game-shell.css          # Orange Phosphor CRT theme
│   │   └── index.audio.*.worklet.js
│   ├── shared/
│   │   └── browser-overlay.js      # iframe overlay controller
│   ├── status/                     # Status dashboard
│   ├── privacy/                    # Privacy policy
│   ├── core_truths_book/           # Interactive lore book
│   ├── rune_puzzle/                # Rune puzzle mini-game
│   ├── explorer/                   # World explorer
│   ├── robots.txt
│   ├── 404.html
│   └── favicon.ico
│
├── server/                         # Backend services
│   ├── anonymous_chat_server.js    # Node.js WebSocket chat
│   ├── package.json                # npm manifest (ws)
│   ├── coresapian-anonymous-chat.service  # systemd unit
│   ├── deploy_anonymous_chat.sh    # Deployment script
│   └── nginx_coresapian.conf       # Canonical nginx config
│
├── scripts/                        # Ops scripts
│   ├── health-check.py             # Service status checker
│   ├── coresapian-health-check.service
│   ├── coresapian-health-check.timer
│   ├── export_godot_web.sh         # Godot → WebGL export
│   ├── export_godot_all.sh         # Export all platforms
│   ├── install_godot_export_templates.sh
│   └── honeypot/                   # Fail2Ban + honeypot configs
│
└── .env.example                    # Environment template
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

# Deploy everything to LXC 103
scp -r public/* root@192.168.0.148:/var/www/coresapian/
```

### Chat Server Deploy
```bash
bash server/deploy_anonymous_chat.sh
```

### Verify
```bash
# Web
curl -I https://coresapian.com/game/
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
- **No secrets in repo**: All credentials via `.env` (gitignored)

## License

See [LICENSE](LICENSE).
