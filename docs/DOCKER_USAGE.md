# Docker Usage Guide for Zebrunner MCP

## Overview

This guide covers how to build, run, and use the Zebrunner MCP server with Docker and Docker MCP Toolkit.

---

## Table of Contents

1. [Overview](#overview)
2. [Zebrunner Native MCP vs this server](#zebrunner-native-mcp-vs-this-server)
3. [Quick Start](#quick-start)
   - [Prerequisites](#prerequisites)
   - [Build the Docker Image](#build-the-docker-image)
   - [Run Locally with Docker Compose](#run-locally-with-docker-compose)
4. [HTTP Mode (StreamableHTTP)](#http-mode-streamablehttp)
   - [Mode 2: HTTP + header auth](#mode-2-http--header-auth)
   - [Mode 3: Self-service auth (selfauth)](#mode-3-self-service-auth-selfauth)
   - [Mode 4: Okta OIDC (okta)](#mode-4-okta-oidc-okta)
   - [Mode 5: Okta + Token Exchange (okta-exchange)](#mode-5-okta--token-exchange-okta-exchange)
   - [Selecting HTTP auth mode with Docker Compose](#selecting-http-auth-mode-with-docker-compose)
   - [Transport mode reference](#transport-mode-reference)
5. [Docker MCP Gateway — Remote Server with OAuth](#docker-mcp-gateway--remote-server-with-oauth)
6. [Docker Files Overview](#docker-files-overview)
7. [Docker MCP Toolkit Integration](#docker-mcp-toolkit-integration)
   - [Step 1: Import Custom Catalog](#step-1-import-custom-catalog)
   - [Step 2: Enable the Server](#step-2-enable-the-server)
   - [Step 3: Configure Credentials (CLI)](#step-3-configure-credentials-cli)
   - [Step 4: Run the Gateway](#step-4-run-the-gateway)
   - [Step 5: Verify](#step-5-verify)
8. [Connecting to MCP Clients](#connecting-to-mcp-clients)
   - [Option A: Cursor IDE](#option-a-cursor-ide)
   - [Option B: Claude Desktop](#option-b-claude-desktop)
   - [Option C: Docker MCP Gateway Client Connect](#option-c-docker-mcp-gateway-client-connect)
9. [Docker Commands Reference](#docker-commands-reference)
   - [Building](#building)
   - [Running](#running)
   - [Testing](#testing)
   - [Publishing to Docker Hub](#publishing-to-docker-hub)
10. [Docker MCP Toolkit Commands](#docker-mcp-toolkit-commands)
    - [Catalog Management](#catalog-management)
    - [Server Management](#server-management)
    - [Configuration](#configuration)
    - [Gateway](#gateway)
11. [Troubleshooting](#troubleshooting)
    - [Clearing Stored Credentials (Modes 3 & 4)](#clearing-stored-credentials-modes-3--4)
    - [Server Won't Start](#server-wont-start)
    - [Server Not in Docker Desktop UI](#server-not-in-docker-desktop-ui)
    - [MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL Warning](#mcp_dangerously_allow_insecure_issuer_url-is-enabled-warning)
    - [Image Build Fails](#image-build-fails)
    - [Permission Denied on Docker Hub Push](#permission-denied-on-docker-hub-push)
12. [Environment Variables](#environment-variables)
    - [Required variables by mode](#required-variables-by-mode)
    - [Variable reference](#variable-reference)
13. [TODO: Docker MCP Registry Submission](#todo-docker-mcp-registry-submission)

---

## Zebrunner Native MCP vs this server

Zebrunner ships a **native MCP** endpoint on each workspace:

`https://{workspace}.zebrunner.com/api/mcp`

That built-in server exposes on the order of **~30 tools** and expects **header-based** Zebrunner API authentication (same idea as `X-Zebrunner-*` style access to your workspace API).

**This repository** (`mcp-zebrunner`) is a separate, fuller integration: **60+ tools** spanning reporting, analytics, screenshots, charts, flaky-test signals, and broader automation beyond basic TCM CRUD.

If you only need **lightweight test-case management** against Zebrunner’s API, the **native** endpoint may be enough. If you want the **extended analytics and reporting surface**, run this server (STDIO or HTTP) instead or alongside it.

---

## Quick Start

### Prerequisites

- Docker Desktop installed (with MCP Toolkit extension)
- Zebrunner account with API token
- Node.js 20+ (for local development)

### Build the Docker Image

```bash
# Clone the repository
git clone https://github.com/maksimsarychau/mcp-zebrunner.git
cd mcp-zebrunner

# Build with integrity signing (recommended)
npm run build
npm run sign-release
docker build -t msarychau/mcp-zebrunner:latest .

# Or build with Docker Compose
docker compose build

# Or build with Docker Compose
docker compose build
```

### Run Locally with Docker Compose

```bash
# Create .env file with your credentials
cat > .env << EOF
ZEBRUNNER_URL=https://your-instance.zebrunner.com
ZEBRUNNER_LOGIN=your-username
ZEBRUNNER_TOKEN=your-api-token
DEBUG=false
ENABLE_RULES_ENGINE=false
EOF

# Run the container
docker compose up
```

---

## HTTP Mode (StreamableHTTP)

The server supports StreamableHTTP transport for remote access. The same Docker image supports both STDIO and HTTP — transport is selected at runtime.

HTTP authentication is grouped into **modes** (aligned with project docs):

| Mode | `MCP_AUTH_MODE` | How Zebrunner credentials reach the server |
|------|-----------------|---------------------------------------------|
| **2** | `headers` (default) | Client sends `X-Zebrunner-Username` / `X-Zebrunner-Api-Token` on each request |
| **3** | `selfauth` | Users complete a one-time browser form; credentials are encrypted in `TOKEN_STORE_PATH` |
| **4** | `okta` | Okta OIDC gate + same per-user store as selfauth (**no** shared `ZEBRUNNER_LOGIN` / `ZEBRUNNER_TOKEN` on the server) |
| **5** | `okta-exchange` | Same as Mode 4 + automatic Zebrunner token via OIDC exchange (falls back to Mode 4 form if endpoint unavailable) |

Combined values `headers,selfauth`, `headers,okta`, and `headers,okta-exchange` are also supported for migration (try headers first, then OAuth).

### Mode 2: HTTP + header auth

```bash
# HTTP mode with header auth (simplest)
docker compose -f docker-compose.yml -f docker-compose.http.yml up
```

Ensure `.env` sets at least `ZEBRUNNER_URL` and `PORT` (see [Environment variables](#environment-variables)); `docker-compose.http.yml` sets `MCP_TRANSPORT=http` and a default `PORT` mapping.

#### Client configuration (HTTP mode, headers)

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "zebrunner": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "X-Zebrunner-Username": "your.name",
        "X-Zebrunner-Api-Token": "your-token"
      }
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

> Claude Desktop does not support Streamable HTTP natively. Use the
> [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge.

```json
{
  "mcpServers": {
    "zebrunner": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "http://localhost:3000/mcp",
        "--header", "X-Zebrunner-Username: your.name",
        "--header", "X-Zebrunner-Api-Token: your-token"
      ]
    }
  }
}
```

#### Health check

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"...","transport":"streamablehttp","authMode":"headers","activeSessions":0}
```

(`authMode` reflects `MCP_AUTH_MODE`, e.g. `selfauth` or `okta` when configured.)

### Mode 3: Self-service auth (`selfauth`)

Users sign in through the server’s **credential form** once; tokens are stored encrypted. Clients only need the MCP **URL** — no Zebrunner headers in the MCP client config.

**.env (server)**

```bash
ZEBRUNNER_URL=https://your-workspace.zebrunner.com/api/public/v1
MCP_TRANSPORT=http
PORT=3000
MCP_AUTH_MODE=selfauth
TOKEN_STORE_PATH=/data/tokens.enc
TOKEN_STORE_KEY=use-a-long-random-secret-for-encryption
MCP_SERVER_URL=http://localhost:3000
```

Use a persistent volume for `/data` in Docker (the HTTP compose file mounts `token-data` at `/data`).

**Client configuration (URL only)**

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "zebrunner": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

> Claude Desktop does not support Streamable HTTP natively. Use the
> [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge.
> For OAuth modes, `mcp-remote` handles the full OAuth flow automatically.

```json
{
  "mcpServers": {
    "zebrunner": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

Start with:

```bash
docker compose -f docker-compose.yml -f docker-compose.http.yml up
```

(after setting `MCP_AUTH_MODE=selfauth` and `TOKEN_STORE_KEY` in `.env`).

### Mode 4: Okta OIDC (`okta`)

Okta verifies the user; Zebrunner credentials are still captured per user and stored in the encrypted token store. **Do not** put shared `ZEBRUNNER_LOGIN` / `ZEBRUNNER_TOKEN` in the server environment for this mode — each user’s access is isolated in the store.

**`TOKEN_STORE_KEY` is required** (encryption key for the token file).

**.env (server)**

```bash
ZEBRUNNER_URL=https://your-workspace.zebrunner.com/api/public/v1
MCP_TRANSPORT=http
PORT=3000
MCP_AUTH_MODE=okta
TOKEN_STORE_PATH=/data/tokens.enc
TOKEN_STORE_KEY=use-a-long-random-secret-for-encryption

OKTA_DOMAIN=your-org.okta.com
OKTA_CLIENT_ID=0oa...
OKTA_CLIENT_SECRET=...
OKTA_AUTH_SERVER_ID=default

# Public base URL of this MCP server (OAuth metadata / redirects)
MCP_SERVER_URL=https://mcp.yourcompany.com
```

**Client configuration (URL only)**

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "zebrunner": {
      "url": "https://mcp.yourcompany.com/mcp"
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

> Claude Desktop does not support Streamable HTTP natively. Use the
> [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge.
> For OAuth modes, `mcp-remote` handles the full OAuth flow automatically.

```json
{
  "mcpServers": {
    "zebrunner": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.yourcompany.com/mcp"]
    }
  }
}
```

Start with:

```bash
docker compose -f docker-compose.yml -f docker-compose.http.yml up
```

(after filling Okta and token-store variables in `.env`).

### Mode 5: Okta + Token Exchange (`okta-exchange`)

Identical to Mode 4 except the server **automatically exchanges the Okta ID token for a Zebrunner API token** after SSO. If the Zebrunner token-exchange endpoint is unavailable, it falls back to Mode 4 behavior (credential form).

Change only `MCP_AUTH_MODE` in `.env`:

```bash
MCP_AUTH_MODE=okta-exchange
```

All other variables (Okta, token store, etc.) remain the same as Mode 4.

### Selecting HTTP auth mode with Docker Compose

HTTP mode uses a **single** override file: `docker-compose.http.yml`. Switch strategies by editing **`.env`** (or your shell environment) and **restarting** the stack:

1. Set `MCP_AUTH_MODE` to `headers`, `selfauth`, `okta`, `okta-exchange`, `headers,selfauth`, `headers,okta`, or `headers,okta-exchange`.
2. Ensure mode-specific variables from [Environment variables](#environment-variables) are present (`TOKEN_STORE_KEY` for selfauth/okta/okta-exchange, `OKTA_*` for okta/okta-exchange, etc.).
3. Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.http.yml up
```

Change `MCP_AUTH_MODE` in `.env` and `docker compose up` again to switch modes — no separate compose file per auth mode.

### Transport mode reference

| `MCP_TRANSPORT` | `PORT` | Result |
|----------------|--------|--------|
| `stdio` | (ignored) | STDIO mode (default) |
| `http` | must be set | HTTP mode (fails if PORT missing) |
| `auto` or not set | set | HTTP (auto-detected) |
| `auto` or not set | not set | STDIO (auto-detected) |

---

## Docker MCP Gateway — Remote Server with OAuth

For teams using Docker Desktop, register the HTTP server as a remote MCP server:

```bash
docker mcp server enable zebrunner-remote
docker mcp oauth authorize zebrunner-remote  # opens browser for Okta SSO
```

The gateway manages token lifecycle automatically. Both local (STDIO) and remote (HTTP) catalog entries can coexist.

---

## Docker Files Overview

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build with native dependencies (ffmpeg, tesseract, sharp) |
| `docker-compose.yml` | Local development and testing (STDIO) |
| `docker-compose.http.yml` | HTTP mode override (StreamableHTTP); auth mode from `MCP_AUTH_MODE` in `.env` |
| `.dockerignore` | Excludes unnecessary files from build context |
| `catalogs/mcp-zebrunner/catalog.yaml` | Docker MCP Toolkit catalog definition |
| `server.yaml` | Docker MCP Registry submission format |
| `tools.json` | Tool manifest for registry submission |

---

## Docker MCP Toolkit Integration

### Step 1: Import Custom Catalog

```bash
# Create a custom catalog
docker mcp catalog create zebrunner-catalog

# Or import from file (enter "zebrunner" when prompted for name)
docker mcp catalog import ./catalogs/mcp-zebrunner/catalog.yaml
```

### Step 2: Enable the Server

```bash
docker mcp server enable mcp-zebrunner
```

### Step 3: Configure Credentials (CLI)

```bash
# Set configuration values
docker mcp config write mcp-zebrunner.zebrunner_url="https://your-instance.zebrunner.com"
docker mcp config write mcp-zebrunner.zebrunner_login="your-username"
docker mcp config write mcp-zebrunner.debug="false"
docker mcp config write mcp-zebrunner.enable_rules_engine="false"

# Set API token (secret)
docker mcp secret set mcp-zebrunner.api_token="your-api-token"
```

### Step 4: Run the Gateway

```bash
docker mcp gateway run
```

### Step 5: Verify

```bash
# List enabled servers
docker mcp server ls

# Check catalogs
docker mcp catalog ls
docker mcp catalog show zebrunner
```

---

## Connecting to MCP Clients

### Option A: Cursor IDE

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "zebrunner-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "ZEBRUNNER_URL",
        "-e", "ZEBRUNNER_LOGIN",
        "-e", "ZEBRUNNER_TOKEN",
        "-e", "DEBUG=false",
        "-e", "ENABLE_RULES_ENGINE=false",
        "msarychau/mcp-zebrunner:latest"
      ],
      "env": {
        "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
        "ZEBRUNNER_LOGIN": "your-username",
        "ZEBRUNNER_TOKEN": "your-api-token"
      }
    }
  }
}
```

After editing, restart Cursor (Cmd+Shift+P → "Developer: Reload Window").

### Option B: Claude Desktop

**STDIO mode** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zebrunner-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "ZEBRUNNER_URL=https://your-instance.zebrunner.com",
        "-e", "ZEBRUNNER_LOGIN=your-username",
        "-e", "ZEBRUNNER_TOKEN=your-api-token",
        "msarychau/mcp-zebrunner:latest"
      ]
    }
  }
}
```

**HTTP mode** — Claude Desktop does not support Streamable HTTP natively. Use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```json
{
  "mcpServers": {
    "zebrunner-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

> For Mode 2 (headers), add `--header` flags:
> `"args": ["-y", "mcp-remote", "http://localhost:3000/mcp", "--header", "X-Zebrunner-Username: your.name", "--header", "X-Zebrunner-Api-Token: your-token"]`

### Option C: Docker MCP Gateway Client Connect

```bash
# List available clients
docker mcp client ls

# Connect to Cursor
docker mcp client connect cursor

# Connect to Claude
docker mcp client connect claude
```

---

## Docker Commands Reference

### Building

```bash
# Build with integrity signing (recommended for releases)
npm run build
npm run sign-release
docker build -t msarychau/mcp-zebrunner:latest .

# Build via Docker Compose
docker compose build

# Build with no cache
docker compose build --no-cache
```

### Running

```bash
# Run with docker-compose
docker compose up

# Run in background
docker compose up -d

# View logs
docker compose logs -f zebrunner-mcp

# Stop
docker compose down
```

### Testing

```bash
# Test container starts
docker run --rm msarychau/mcp-zebrunner:latest node -e "console.log('OK')"

# Test native dependencies
docker run --rm msarychau/mcp-zebrunner:latest sh -c "which ffmpeg && which tesseract"

# Test MCP server (will fail without credentials, but confirms code loads)
docker run --rm \
  -e ZEBRUNNER_URL=https://test.zebrunner.com \
  -e ZEBRUNNER_LOGIN=test \
  -e ZEBRUNNER_TOKEN=test \
  msarychau/mcp-zebrunner:latest \
  timeout 3 node dist/server.js || true
```

### Publishing to Docker Hub

```bash
# Login to Docker Hub
docker login -u msarychau

# Tag with version (use current version from package.json)
docker tag msarychau/mcp-zebrunner:latest msarychau/mcp-zebrunner:$(node -p "require('./package.json').version")

# Push both tags
docker push msarychau/mcp-zebrunner:$(node -p "require('./package.json').version")
docker push msarychau/mcp-zebrunner:latest
```

---

## Docker MCP Toolkit Commands

### Catalog Management

```bash
# List catalogs
docker mcp catalog ls

# Show catalog contents
docker mcp catalog show zebrunner

# Show in JSON format
docker mcp catalog show zebrunner --format json

# Create empty catalog
docker mcp catalog create my-catalog

# Import catalog
docker mcp catalog import ./catalog.yaml

# Remove catalog
docker mcp catalog rm my-catalog

# Reset all catalogs
docker mcp catalog reset
```

### Server Management

```bash
# List enabled servers
docker mcp server ls

# Enable server
docker mcp server enable mcp-zebrunner

# Disable server
docker mcp server disable mcp-zebrunner

# Inspect server (if in catalog)
docker mcp server inspect mcp-zebrunner
```

### Configuration

```bash
# Write config value
docker mcp config write mcp-zebrunner.zebrunner_url="https://..."

# Read config
docker mcp config read

# Set secret
docker mcp secret set mcp-zebrunner.api_token="..."

# List secrets
docker mcp secret ls
```

### Gateway

```bash
# Run gateway
docker mcp gateway run

# Gateway will show:
# - Loaded catalogs
# - Enabled servers
# - Tool count per server
# - Any startup errors
```

---

## Troubleshooting

### Clearing Stored Credentials (Modes 3 & 4)

In selfauth and Okta modes, user Zebrunner credentials are stored in an encrypted file (`TOKEN_STORE_PATH`) backed by a Docker volume. The server-signed JWT has **no expiration**, so users are never re-prompted automatically.

#### Delete a single user's credentials (admin CLI)

Use `manage-tokens` to remove one user without affecting others:

```bash
# List all stored users
docker run --rm \
  -v mcp-zebrunner_token-data:/data \
  -e TOKEN_STORE_PATH=/data/tokens.enc \
  -e TOKEN_STORE_KEY=<your-secret> \
  msarychau/mcp-zebrunner:latest \
  node dist/admin/manage-tokens.js list

# Delete a single user
docker run --rm \
  -v mcp-zebrunner_token-data:/data \
  -e TOKEN_STORE_PATH=/data/tokens.enc \
  -e TOKEN_STORE_KEY=<your-secret> \
  msarychau/mcp-zebrunner:latest \
  node dist/admin/manage-tokens.js delete user@company.com
```

The deleted user will be prompted to re-authenticate on their next MCP connection. Other users are unaffected.

> **Volume name:** Docker Compose creates a volume named `<project>_token-data` (e.g. `mcp-zebrunner_token-data`). If you used `docker run -v mcp-token-data:/data`, use that name instead.

#### Wipe the entire store

To force all users to re-authenticate:

```bash
# Docker Compose — removes the token-data volume:
docker compose -f docker-compose.yml -f docker-compose.http.yml down -v

# Docker standalone — remove the named volume:
docker volume rm mcp-token-data

# Local (npx / node) — delete the file:
rm ./data/tokens.enc
```

After deleting, restart the server. The next MCP connection triggers the login flow.

### Server Won't Start

**Error**: `Can't start mcp-zebrunner: failed to connect: calling "initialize": EOF`

**Cause**: Missing or empty environment variables

**Solution**: Configure credentials via CLI:
```bash
docker mcp config write mcp-zebrunner.zebrunner_url="https://..."
docker mcp config write mcp-zebrunner.zebrunner_login="..."
docker mcp secret set mcp-zebrunner.api_token="..."
```

### Server Not in Docker Desktop UI

**Issue**: Server enabled via CLI but not visible in Docker Desktop MCP Toolkit UI

**Cause**: Docker Desktop UI currently only shows servers from the official `docker-mcp` catalog. Custom catalog servers are managed via CLI.

**Solution**: Use CLI commands or submit to official Docker MCP Registry (see TODO section).

### "MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL is enabled" Warning

**Message**: `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL is enabled - HTTP issuer URLs are allowed. Do not use in production.`

**Cause**: The OAuth 2.1 spec requires HTTPS for the issuer URL. When running locally over plain HTTP (`http://localhost:3000`), this flag relaxes that check.

**Safe to ignore** for local development. In production behind a TLS reverse proxy:
1. Set `MCP_SERVER_URL=https://mcp.yourcompany.com`
2. Remove `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` or set it to `false`

Only affects Modes 3 and 4 (OAuth). Mode 2 (headers) doesn't use OAuth discovery.

### Image Build Fails

**Error**: Native dependency compilation errors

**Solution**: Ensure you have the latest Dockerfile with proper Alpine packages:
```bash
docker compose build --no-cache
```

### Permission Denied on Docker Hub Push

**Solution**: Login to Docker Hub first:
```bash
docker login -u your-username
```

---

## Environment Variables

### Required variables by mode

| Mode | Name | Required on server |
|------|------|---------------------|
| **1** — STDIO | Local / Toolkit stdio | `ZEBRUNNER_URL`, `ZEBRUNNER_LOGIN`, `ZEBRUNNER_TOKEN` |
| **2** — HTTP + headers | `MCP_AUTH_MODE=headers` | `ZEBRUNNER_URL`, `PORT` (and `MCP_TRANSPORT=http` or auto via compose); Zebrunner credentials come from **client headers** |
| **3** — HTTP + selfauth | `MCP_AUTH_MODE=selfauth` | `ZEBRUNNER_URL`, `PORT`, `TOKEN_STORE_PATH`, `TOKEN_STORE_KEY` |
| **4** — HTTP + Okta | `MCP_AUTH_MODE=okta` | `ZEBRUNNER_URL`, `PORT`, `TOKEN_STORE_PATH`, `TOKEN_STORE_KEY`, plus `OKTA_DOMAIN`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET` (and typically `MCP_SERVER_URL` for correct OAuth metadata) |
| **5** — HTTP + Okta + exchange | `MCP_AUTH_MODE=okta-exchange` | Same as Mode 4 (token exchange is attempted automatically after Okta login) |

For combined modes (`headers,selfauth`, `headers,okta`, `headers,okta-exchange`), satisfy the union of requirements (e.g. token store + key whenever selfauth or okta is included).

### Variable reference

| Variable | Mode(s) | Default | Description |
|----------|-----------|---------|-------------|
| `ZEBRUNNER_URL` | All | — | Base URL of Zebrunner API for this server |
| `ZEBRUNNER_LOGIN` | **1** (STDIO) | — | Zebrunner username (not used as a shared server secret in modes 3–4) |
| `ZEBRUNNER_TOKEN` | **1** (STDIO) | — | Zebrunner API token (per-request in mode 2 via headers) |
| `MCP_TRANSPORT` | 2–4 | `auto` | `stdio`, `http`, or `auto` |
| `PORT` | 2–4 | — | HTTP listen port (required for HTTP) |
| `MCP_AUTH_MODE` | 2–5 | `headers` | `headers`, `selfauth`, `okta`, `okta-exchange`, `headers,selfauth`, `headers,okta`, `headers,okta-exchange` (legacy: `oauth` → `okta`, `both` → `headers,okta`) |
| `TOKEN_STORE_PATH` | 3–4 | — | Encrypted credential store path (e.g. `/data/tokens.enc` in Docker) |
| `TOKEN_STORE_KEY` | 3–5 | — | **Required** for selfauth/okta/okta-exchange — encryption key for the store |
| `OKTA_DOMAIN` | 4 | — | Okta org domain |
| `OKTA_CLIENT_ID` | 4 | — | OIDC client ID |
| `OKTA_CLIENT_SECRET` | 4 | — | OIDC client secret |
| `OKTA_AUTH_SERVER_ID` | 4 | `default` | Okta authorization server ID |
| `MCP_SERVER_URL` | 3–4 (recommended) | — | Public URL of this MCP server (OAuth redirects / metadata) |
| `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` | 3–4 | `true` (in compose) | Allow HTTP issuer URLs for local development. Set to `false` in production behind HTTPS. |
| `MCP_RESOURCE_PROJECTS` | All | — | Comma-separated project keys to expose as MCP resources (e.g. `ANDROID,IOS`). When unset, only starred projects are listed. |
| `DEBUG` | All | `false` | Enable debug logging |
| `MAX_PAGE_SIZE` | All | `100` | Maximum API page size |
| `DEFAULT_PAGE_SIZE` | All | `10` | Default API page size |
| `ENABLE_RULES_ENGINE` | All | `false` | Enable rules-based test generation |

---

## TODO: Docker MCP Registry Submission

### Goal
Submit Zebrunner MCP to Docker's official MCP Registry so it appears in Docker Desktop for all users with full UI configuration support.

### Prerequisites
- [ ] Docker image published to Docker Hub (`msarychau/mcp-zebrunner`)
- [ ] GitHub repository public and accessible
- [ ] License compatible (AGPL-3.0 may need review - MIT/Apache preferred)

### Step-by-Step Process

#### Step 1: Fork the Registry
- [ ] Go to https://github.com/docker/mcp-registry
- [ ] Click "Fork" to create your copy
- [ ] Clone your fork locally:
  ```bash
  git clone https://github.com/YOUR_USERNAME/mcp-registry.git
  cd mcp-registry
  ```

#### Step 2: Create Server Directory
- [ ] Create folder: `servers/mcp-zebrunner/`
- [ ] Required files:
  - `server.yaml` - Server configuration
  - `tools.json` - Tool manifest
  - `readme.md` - Link to documentation

#### Step 3: Create server.yaml
- [ ] Copy from our `server.yaml` template
- [ ] Ensure format matches Docker's requirements
- [ ] Include all environment variables and secrets

#### Step 4: Create tools.json
- [ ] Copy from our `tools.json` file
- [ ] Required because server needs credentials before listing tools

#### Step 5: Create readme.md
- [ ] Simple file with documentation link:
  ```
  https://github.com/maksimsarychau/mcp-zebrunner#readme
  ```

#### Step 6: Test Locally (Optional)
- [ ] Install Task runner: https://taskfile.dev/
- [ ] Run: `task build -- --tools mcp-zebrunner`
- [ ] Run: `task catalog -- mcp-zebrunner`
- [ ] Import: `docker mcp catalog import $PWD/catalogs/mcp-zebrunner/catalog.yaml`
- [ ] Test in Docker Desktop

#### Step 7: Submit Pull Request
- [ ] Commit changes to your fork
- [ ] Push to GitHub
- [ ] Open PR to `docker/mcp-registry`
- [ ] Fill in PR template with:
  - Server description
  - Test instructions
  - Any special requirements

#### Step 8: Share Test Credentials
- [ ] Fill out Docker's credential sharing form:
  https://forms.gle/6Lw3nsvu2d6nFg8e6
- [ ] Provide test Zebrunner instance access

#### Step 9: Wait for Review
- [ ] Docker team will review
- [ ] Address any feedback
- [ ] Once approved, server appears in:
  - Docker Hub MCP catalog
  - Docker Desktop MCP Toolkit
  - `mcp` namespace on Docker Hub (if Docker builds image)

### Expected Timeline
- PR Review: 1-2 weeks
- Availability after merge: ~24 hours

### Benefits After Approval
- ✅ Full UI configuration in Docker Desktop
- ✅ Discoverable by all Docker Desktop users
- ✅ Automatic security features (signatures, provenance, SBOMs)
- ✅ Optional automatic updates

### References
- [Docker MCP Registry Contributing Guide](https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md)
- [Docker MCP Gateway Catalog Docs](https://github.com/docker/mcp-gateway/blob/main/docs/catalog.md)

---

*Last Updated: April 2026*
