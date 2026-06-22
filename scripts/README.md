# Scrollstr Deployment Scripts

This directory contains scripts for deploying scrollstr to a remote server.

## Scripts

### `deploy-remote.sh`

Main deployment orchestrator. Handles building locally, syncing to a remote server, installing a systemd service, and optionally configuring a reverse proxy.

**Requirements:**
- Local: `npm`, `rsync`
- Remote: `python3`, `systemctl`, `ss`, `curl`, `rsync`, `sudo`

**Usage:**

```bash
scripts/deploy-remote.sh --host user@server [options]
```

**Options:**
- `--host <user@host>` — SSH target for the remote server (required)
- `--port <port>` — App port on the remote host (default: 3000)
- `--install-dir <path>` — Remote install path (default: /var/www/scrollstr)
- `--service-user <user>` — Systemd service user (default: www-data)
- `--service-group <group>` — Systemd service group (default: www-data)
- `--proxy auto|caddy|nginx|none` — Reverse proxy mode (default: auto)
- `--domain <hostname>` — Reverse proxy hostname (required for caddy/nginx)
- `--caddy-email <email>` — Caddy ACME contact email
- `--ssh-port <port>` — SSH port (default: 22)
- `--skip-build` — Skip the local build step
- `--dry-run` — Print actions without executing them
- `-h, --help` — Show help

**Examples:**

Deploy to a server with auto-detected reverse proxy:

```bash
scripts/deploy-remote.sh --host deploy@example.com --domain scrollstr.example.com
```

Deploy with manual proxy configuration:

```bash
scripts/deploy-remote.sh --host deploy@example.com --proxy caddy --domain scrollstr.example.com --caddy-email admin@example.com
```

Deploy without a reverse proxy:

```bash
scripts/deploy-remote.sh --host deploy@example.com --proxy none
```

Dry-run to see what would happen:

```bash
scripts/deploy-remote.sh --host deploy@example.com --domain scrollstr.example.com --dry-run
```

**Environment Overrides:**

Configuration can be provided via environment variables instead of command-line arguments:

- `SCROLLSTR_SSH_TARGET` — SSH target
- `SCROLLSTR_PORT` — App port
- `SCROLLSTR_INSTALL_DIR` — Install directory
- `SCROLLSTR_SERVICE_USER` — Service user
- `SCROLLSTR_SERVICE_GROUP` — Service group
- `SCROLLSTR_PROXY` — Proxy mode
- `SCROLLSTR_DOMAIN` — Domain name
- `SCROLLSTR_CADDY_EMAIL` — Caddy email
- `SCROLLSTR_SSH_PORT` — SSH port
- `SCROLLSTR_DRY_RUN` — Dry-run mode
- `SCROLLSTR_SKIP_BUILD` — Skip build

**What It Does:**

1. **Local Build** — Runs `npm ci` and `npm run build` locally
2. **Repository Sync** — Syncs the repository to a temporary staging directory on the remote server via rsync
3. **Build Artifacts Sync** — Syncs the `dist/` folder to the remote server
4. **Service Installation** — Installs a systemd service to run the app
5. **Reverse Proxy Configuration** — Optionally configures Caddy or nginx as a reverse proxy
6. **Smoke Tests** — Verifies the service started and responds to HTTP requests

### `spa-http-server.py`

Helper script that runs on the remote server to serve the built SPA. Installed as part of the systemd service.

**Features:**
- Serves the Vite build directory as a static site
- Implements SPA routing fallback (requests to non-existent files fall back to index.html)
- Configurable bind address and port
- No-cache headers for proper cache busting

**Usage:**

```bash
spa-http-server.py [directory] --bind <address> --port <port>
```

## Deployment Workflow

1. Make changes to scrollstr
2. Test locally with `npm run dev`
3. Run the deploy script:
   ```bash
   scripts/deploy-remote.sh --host deploy@example.com --domain scrollstr.example.com
   ```
4. The script handles the rest:
   - Builds locally
   - Syncs to remote
   - Installs/updates the service
   - Restarts the app
   - Configures reverse proxy if needed

## Troubleshooting

**Build fails locally:**
- Run `npm ci && npm run build` manually to see the error

**Sync fails:**
- Check SSH connectivity: `ssh user@server -p port`
- Ensure rsync is installed on both machines
- Check file permissions

**Service won't start:**
- SSH to the remote and check: `sudo journalctl -u scrollstr.service -n 50`
- Verify Python 3 is installed: `python3 --version`
- Check the install directory permissions

**Port is already in use:**
- The script will automatically find the next available port
- To use a specific port, pass `--port <number>`
- To stop a running service: `sudo systemctl stop scrollstr`

**Reverse proxy not working:**
- Verify the domain resolves to the server
- Check proxy logs: `sudo journalctl -u caddy` or `sudo tail -f /var/log/nginx/error.log`
- Use `--dry-run` first to preview configuration changes
