# Bonsai

**Stable version available on the [`stable`](../../tree/stable) branch.**

Specification-driven development workspace. Hierarchical, interconnected specs live in the repo alongside code — helping developers align AI coding agents through structured project context.

## Quick Start

```bash
git clone <repo-url>
cd bonsai
./deploy.sh
```

The script installs all dependencies, starts the backend and frontend, and opens:

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:8000

Press `Ctrl+C` to stop. Cleanup is automatic.

### Prerequisites

- **Node.js** (with npm)
- **Python 3.11+**
- **uv** (installed automatically if missing)

### Configuration

Copy `.env.example` to `.env` to override defaults:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_HOST` | `0.0.0.0` | Backend bind address |
| `BACKEND_PORT` | `8000` | Backend port |
| `FRONTEND_PORT` | `3000` | Frontend port |

## Authentication & First-Time Setup

Bonsai requires authentication. On first launch there are two setup paths:

### Portable Executable

Just run the executable — the browser opens automatically. Since no users exist yet, you'll see a **Setup Screen** where you enter a username and display name. This creates the first admin account and shows your access token. Save it.

### Development (from source)

Create the first admin user via CLI:

```bash
cd backend && uv run python -m app.cli create-user --id danya --name "Danya" --admin
# → Token: bns_a8f3k2m9...
```

Then open http://localhost:3000 and enter the token on the login screen.

### Managing Users

Admin users can create and manage other users from the **Admin** button in the app header. Admins can:
- Create new users (generates a token to share with them)
- Grant or revoke admin rights
- Delete users
- Revoke individual tokens

At least one admin must always exist.

## Remote Access

Both servers bind to `0.0.0.0` by default, so Bonsai is reachable from other devices on your LAN. The startup script prints your LAN IP automatically.

### Tailscale (recommended)

[Tailscale](https://tailscale.com/download) gives you secure access from anywhere without port-forwarding or firewall changes:

1. Install Tailscale on the host and the remote device
2. Run `./deploy.sh` (or `./run.sh`)
3. Open `http://<tailscale-ip>:3000` on the remote device

MagicDNS also works: `http://<hostname>:3000`.

### LAN

Just open `http://<host-lan-ip>:3000` from any device on the same network. The LAN IP is shown in the startup output.

### Localhost only

To restrict access to the local machine:

```bash
BACKEND_HOST=127.0.0.1 ./deploy.sh
```

Or set `BACKEND_HOST=127.0.0.1` in `.env`.

See [REMOTE_DESIGN.md](REMOTE_DESIGN.md) for full architecture details.

## Stable Version

For the latest stable release, use the `stable` branch:

```bash
git checkout stable
./deploy.sh
```
