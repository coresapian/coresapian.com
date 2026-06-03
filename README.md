# CoreSapian.com

> Expanding the frontiers of artificial intelligence and the human mind. Building a future where human ingenuity is amplified by computational leverage.

Live at **[coresapian.com](https://coresapian.com)**

---

## Architecture

```
                        Internet
                           │
                    Cloudflare Tunnel
                    (CGNAT bypass)
                           │
                    ┌──────┴──────┐
                    │  Nginx :80  │  LXC CT 103 (Ubuntu 24.04)
                    │  reverse    │  192.168.0.148
                    │  proxy      │
                    └──┬──┬──┬───┘
          ┌────────────┤  │  │  └─────────────┐
          │            │  │  │                │
     Static Files   ┌───┘  │  └──┐      TCP Stream
     /var/www/      │      │     │       :7000
     coresapian     │      │     │         │
                    ▼      │     ▼         ▼
    ┌──────────┐  ┌─────┐  │  ┌──────────┐  ┌──────────┐
    │ /ws/     │  │/chat│  │  │ /ws/enet │  │godot     │
    │world-chat│  │:9000│  │  │ relay    │  │server    │
    │ :8765    │  │core-│  │  │ :7000    │  │ :7001    │
    │ Python   │  │Chat │  │  │ Python   │  │ ENet     │
    │ WebSocket│  │Node │  │  │WebSocket │  │multiplay.│
    └──────────┘  └─────┘  │  └────┬─────┘  └──────────┘
                           │       │
                    DDNS Cron ─────┘
                    (GoDaddy API)
```

This is a multi-component web presence running on a single Proxmox LXC container behind Cloudflare Tunnel (CenturyLink CGNAT blocks all inbound ports, so the tunnel is the only way in).

---

## Services

| # | Service | Technology | Internal Port | Systemd Unit | Description |
|---|---------|-----------|---------------|--------------|-------------|
| 1 | Nginx | nginx | 80 | nginx | Reverse proxy + static files + TCP stream proxy |
| 2 | World Chat | Python 3 + `websockets` | 8765 | `coresapian-world-chat.service` | API-key-protected multiplayer text chat over WebSocket |
| 3 | ENet Relay | Python 3 + `websockets` | 7000 | `coresapian-enet-relay.service` | Bridges browser WebSocket → Godot ENet TCP (:7001) |
| 4 | Godot Server | Godot 4 dedicated | 7001 | `coresapian-game.service` | Headless dedicated server for multiplayer 3D world |
| 5 | coreChat | Node.js | 9000 | `coresapian-chat.service` | IRC-style web chat client |
| 6 | DDNS Cron | Bash script | — | `coresapian-ddns.service` + `.timer` | Updates GoDaddy A records when public IP changes |

### Nginx Routes

| URL Path | Proxy Target | Protocol | Purpose |
|----------|-------------|----------|---------|
| `/` | `/var/www/coresapian` | Static files | Landing page, Godot WebGL, Core Truths, Rune Puzzle |
| `/ws/world-chat` | `127.0.0.1:8765/ws/world-chat` | WebSocket | World Chat messages |
| `/ws/enet` | `127.0.0.1:7000/ws/enet` | WebSocket | Browser Godot clients → ENet relay |
| `/chat` | `127.0.0.1:9000` | HTTP + WebSocket | coreChat IRC client |
| TCP `:7000` | `127.0.0.1:7001` | TCP stream | ENet multiplayer (Godot native clients) |

**Important:** The TCP stream proxy for port 7000 must be configured in nginx's top-level `stream {}` block (see `server/nginx_stream_enet.conf`), not inside the `http {}` block.

### Service Dependencies

```
coresapian-game.service          (no deps — starts first)
    ↓
coresapian-enet-relay.service    (After=coresapian-game.service, Wants=coresapian-game.service)
    ↓
coresapian-world-chat.service    (After=network.target)
coresapian-chat.service          (After=network.target)
```

---

## Repository Structure

```
coresapian.com/
├── server/                          # Backend services
│   ├── world_chat_server.py         # API-key-protected WebSocket chat server
│   ├── enet_ws_relay.py             # ENet-TCP ↔ WebSocket bridge for browser clients
│   ├── nginx_coresapian.conf        # Nginx http block config (routes + WebSocket proxies)
│   ├── nginx_stream_enet.conf       # Nginx stream block (ENet TCP proxy, port 7000→7001)
│   ├── requirements.txt             # Python deps (websockets>=13.0)
│   ├── coresapian-game.service      # Systemd unit — Godot dedicated server
│   ├── coresapian-enet-relay.service # Systemd unit — ENet WebSocket relay
│   ├── coresapian-world-chat.service # Systemd unit — World Chat server
│   ├── coresapian-chat.service      # Systemd unit — coreChat Node.js
│   ├── coresapian-ddns.service      # Systemd unit — GoDaddy DDNS
│   ├── coresapian-ddns.timer        # Systemd timer — runs DDNS every 5 min
│   └── PROXMOX_VM_DEPLOYMENT.md     # Detailed deployment guide
├── public/                          # Static web content (served by Nginx)
│   ├── index.html                   # Landing page
│   ├── core_truths_book/            # Interactive Core Truths experience
│   │   ├── index.html
│   │   ├── terminal.js              # Expandable runic panel (decorative)
│   │   ├── style.css
│   │   └── workers/                 # Unused WebNN worker (kept for reference)
│   ├── rune_puzzle/                 # Rune Puzzle game
│   │   ├── index.html
│   │   ├── puzzle.js
│   │   └── style.css
│   ├── game/                        # Godot WebGL export
│   │   ├── game-shell.html
│   │   ├── game-shell.js            # Bootloader + AudioContext tracker (Proxy-based)
│   │   ├── game-shell.css
│   │   └── *.wasm, *.pck            # Godot engine + game data
│   └── shared/                      # Shared frontend modules
│       ├── theme.css                # Matrix Green CSS palette (imported by multiple pages)
│       ├── input-type.js            # Touch/mouse/hybrid device detection
│       └── torch.js                 # Torch overlay effect (GSAP-based)
├── godot/                           # Godot 4 game project
│   ├── project.godot                # Godot project file
│   ├── autoloads/
│   │   └── network_manager.gd       # ENet multiplayer + World Chat WS client (singleton)
│   ├── scenes/
│   │   ├── core_truths/
│   │   │   └── player_controller.gd # First-person controller with multiplayer sync
│   │   └── ui/
│   │       └── chat_widget.gd       # In-game chat overlay with auto-hide
│   ├── optional/
│   │   └── scenes/
│   │       └── rune_puzzle/
│   │           └── rune_puzzle.gd   # Drag-and-drop Elder Futhark rune puzzle
│   ├── resources/                   # 3D models, textures (Git LFS)
│   ├── shaders/                     # Custom GLSL shaders
│   └── fonts/                       # Game fonts
├── coreChat/                         # coreChat IRC web client
│   ├── package.json                  # Node.js deps (irc-framework, ws)
│   ├── server/
│   │   └── index.js                  # IRC↔WebSocket bridge server
│   └── client/
│       └── index.html                # Browser chat UI (Matrix Green theme)
├── scripts/                         # Deployment + dev scripts
│   ├── deploy-coresapian.sh         # Full deploy: all services, nginx, DDNS cron
│   ├── dev.sh                       # Local dev manager (start/stop/restart/status)
│   ├── deploy_corechat.sh           # Deploy coreChat Node.js app
│   ├── deploy_dedicated_server.sh   # Deploy Godot dedicated server
│   └── ddns_godaddy.sh              # GoDaddy DDNS updater
├── .env.example                     # Environment variable template
├── .gitattributes                   # Git LFS file type rules
├── .gitignore                       # Ignored files + directories
├── code-review.md                   # Latest comprehensive code review (2026-04-28)
└── README.md                        # This file
```

---

## Quick Start

### Prerequisites

- Python 3.10+
- Godot 4.x (for game development)
- Node.js 20 (for coreChat)
- Git LFS (`brew install git-lfs && git lfs install`)

### 1. Clone

```bash
git clone https://github.com/coresapian/coresapian_com.git
cd coresapian_com
git lfs pull
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env with your values (see Configuration section below)
```

### 3. Python Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

### 4. Run World Chat Server (local dev)

```bash
export CORE_CHAT_API_KEYS="your-api-key-here"
python server/world_chat_server.py --host 0.0.0.0 --port 8765
```

### 5. Run ENet Relay (local dev)

```bash
python server/enet_ws_relay.py
# Defaults: WS on :7000/ws/enet, connects to ENet :7001
```

### 6. Run coreChat IRC Client (local dev)

```bash
cd coreChat && npm install && cd ..
CHAT_PORT=9000 node coreChat/server/index.js
```

coreChat bridges IRC (Libera.Chat by default) to a browser WebSocket UI. Configure with `IRC_SERVER`, `IRC_NICK`, `IRC_CHANNELS` env vars.

### 7. Local Dev Manager

```bash
# Start all services
bash scripts/dev.sh start

# Start individual services
bash scripts/dev.sh start world-chat
bash scripts/dev.sh start corechat

# Stop all
bash scripts/dev.sh stop

# Restart one
bash scripts/dev.sh restart enet-relay

# Check status
bash scripts/dev.sh status

# View logs
bash scripts/dev.sh logs world-chat
```

### 8. Open Godot Project

Open `godot/project.godot`

---

## Configuration

All configuration lives in `.env` (copied from `.env.example`). Never commit `.env`.

| Variable | Example | Description |
|----------|---------|-------------|
| `PROXMOX_HOST` | `root@192.168.0.10` | Proxmox host for SSH-based deploy |
| `CT_ID` | `103` | LXC container ID |
| `CT_IP` | `192.168.0.148` | LXC container IP |
| `CORECHAT_REMOTE_DIR` | `/opt/coresapian/corechat` | coreChat install path on LXC |
| `CORECHAT_PORT` | `9000` | coreChat listen port |
| `CORECHAT_NODE_MAJOR` | `20` | Node.js major version |
| `GODOT_BIN` | `godot4` | Godot binary name |
| `GODOT_SERVER_DIR` | `/opt/coresapian/godot` | Godot server install path |
| `CLOUDFLARE_ACCOUNT_ID` | `YOUR_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_TUNNEL_ID` | `YOUR_TUNNEL_ID` | Cloudflare Tunnel ID |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare API token |
| `CORE_CHAT_API_KEYS` | `key1,key2` | Comma-separated API keys for World Chat |
| `GODADDY_KEY` | — | GoDaddy API key (for DDNS) |
| `GODADDY_SECRET` | — | GoDaddy API secret (for DDNS) |

---

## WebSocket Endpoints

### World Chat (`/ws/world-chat`)

API-key-protected multiplayer text chat. Used by Godot clients and potentially other frontends.

```
wss://coresapian.com/ws/world-chat?api_key=<KEY>&username=<NAME>
```

**Message format (incoming):** Plain text (one message)  
**Message format (outgoing):**

```json
{
  "type": "chat",
  "timestamp": "2026-04-28T15:30:00+00:00",
  "username": "Player",
  "message": "Hello world!"
}
```

### ENet Relay (`/ws/enet`)

Bridges browser WebSocket connections to the Godot ENet TCP server. Browser-based Godot (WASM/WebGL) cannot use raw TCP, so this relay forwards packets bidirectionally.

```
wss://coresapian.com/ws/enet
```

All data is forwarded as raw bytes. No JSON protocol — just ENet packets tunneled through WebSocket frames.

---

## Deployment

### Full Deploy (Production)

From your MacBook:

```bash
bash scripts/deploy-coresapian.sh
```

This script:
1. SSHes into the LXC (via `PROXMOX_HOST` + `CT_IP`)
2. RSYNCs all server code + systemd units to `/opt/coresapian/`
3. Installs Python deps in a virtualenv
4. Configures Nginx (http routes + stream proxy)
5. Sets up DDNS cron via systemd timer
6. Enables and starts all services

### Individual Services

```bash
# Godot dedicated server
bash scripts/deploy_dedicated_server.sh

# coreChat IRC client
bash scripts/deploy_corechat.sh
```

### Service Management (on LXC)

```bash
systemctl status coresapian-game
systemctl status coresapian-enet-relay
systemctl status coresapian-world-chat
systemctl status coresapian-chat
systemctl status coresapian-ddns.timer

# Restart after config changes
systemctl restart nginx
```

---

## Git LFS

Large binary assets (3D models, textures, fonts, Godot exports) are tracked with Git LFS.

Tracked patterns (see `.gitattributes`):
- `*.glb`, `*.gltf` — 3D models
- `*.png`, `*.jpg`, `*.webp` — Textures
- `*.ttf`, `*.otf` — Fonts
- `*.pck`, `*.wasm` — Godot export files
- `*.ogg`, `*.mp3`, `*.wav` — Audio
- `*.blend` — Blender source files

### Setup

```bash
git lfs install
git lfs pull
```

All new `.glb` files added to `godot/resources/` are automatically tracked by the global `*.glb` rule.

---

## Networking

### Current Setup

| Component | Details |
|-----------|---------|
| ISP | CenturyLink (1000 Mbps) |
| Router | C3000Z (192.168.0.1) |
| Public IP | Dynamic (resolved via GoDaddy DDNS) |
| CGNAT | **Yes** — router blocks ALL inbound ports |
| Bypass | Cloudflare Tunnel (cloudflared on LXC) |
| DNS | Cloudflare nameservers |
| DDNS | GoDaddy API (updates A records every 5 minutes) |

### Cloudflare Tunnel

The tunnel ID and account ID are configured in `.env`. The tunnel routes all `*.coresapian.com` and related domain traffic to the LXC's nginx on port 80.

**Tunnel config path:** `/etc/cloudflared/config.yml` on the LXC

---

## Development Notes

### World Chat Server

- The server is a plain WebSocket chat server. Messages are broadcast to all connected clients.
- API keys are checked on connection. Invalid keys get `1008` close code.
- Maximum message length: 512 characters (configurable via `--max-message-length`).
- The `Godot → World Chat` connection needs an API key configured in `network_manager.gd` (`WORLD_CHAT_API_KEY` constant — currently empty, must be set).

### ENet Relay

- The relay creates a fresh TCP connection to the Godot server for each WebSocket client.
- Uses `asyncio.gather()` to run bidirectional forwarding concurrently.
- `ConnectionClosed` exceptions from WebSocket clients are handled gracefully (normal disconnection).
- Unexpected exceptions are logged with full traceback via `log.exception()`.

### Godot Game Scripts

- `network_manager.gd` — Autoload singleton. Manages ENet host/join + World Chat WebSocket with auto-reconnect (5-second interval).
- `player_controller.gd` — First-person controller with authority-based multiplayer replication. Local input → physics → `sync_transform` RPC → remote interpolation.
- `chat_widget.gd` — In-game chat overlay. Press `/` to type, auto-hides after 4 seconds of inactivity.
- `rune_puzzle.gd` — Drag-and-drop puzzle with physics raycasting. Target word: `ᚲᛟᚱᛖ` (CORE).

### Shared Frontend Modules

| File | Purpose | Used By |
|------|---------|---------|
| `shared/theme.css` | Matrix Green CSS variables | `core_truths_book/style.css`, `rune_puzzle/style.css` |
| `shared/input-type.js` | Touch/mouse/hybrid detection | `rune_puzzle/puzzle.js`, `shared/torch.js` |
| `shared/torch.js` | GSAP-based torch overlay | `core_truths_book/index.html` |

### AudioContext Tracking

`game-shell.js` uses a Proxy-based approach to track `AudioContext` instances without monkey-patching global constructors. This avoids breakage when multiple libraries depend on the raw `AudioContext` constructor.

---

## Known Issues & Gotchas

1. **Nginx TCP stream proxy:** The `stream {}` block in `nginx_stream_enet.conf` must go in `/etc/nginx/nginx.conf` at the top level (outside `http {}`). The deploy script handles this automatically, but manual edits must follow this rule.

2. **ENet relay port:** The relay listens on port 7000 (WebSocket) and forwards to Godot on port 7001 (ENet TCP). These are distinct — port 7000 public connects to the relay, port 7001 is internal only.

3. **World Chat API key:** The Godot `network_manager.gd` has `WORLD_CHAT_API_KEY` set to empty string. It must be configured before the Godot client can connect to World Chat.

4. **Cloudflare API token:** The token in the repo has limited permissions (cannot create zones). StarPark.app cannot be added to Cloudflare via the API — it must be added manually through the Cloudflare dashboard.

5. **CenturyLink CGNAT:** All inbound ports are blocked at the ISP level. Port forwarding on the router, DMZ, and static IP requests have not resolved this. Cloudflare Tunnel is the only working inbound path.

6. **Domain DNS split:** Some domains use Cloudflare DNS (via tunnel), others use GoDaddy DDNS. See memory/notes for the full list. Eventually all should migrate to Cloudflare.

7. **Proxmox firewall:** The datacenter firewall (`policy_forward: DROP`) was blocking container traffic. It was disabled. If re-enabled, set `Forward: ACCEPT`.
