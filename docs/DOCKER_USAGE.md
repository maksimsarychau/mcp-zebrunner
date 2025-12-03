# Docker Usage Guide for Zebrunner MCP

## Overview

This guide covers how to build, run, and use the Zebrunner MCP server with Docker and Docker MCP Toolkit.

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

# Build the Docker image
docker compose build

# Or build with version tag
VERSION=5.14.0 docker compose build
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

## Docker Files Overview

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build with native dependencies (ffmpeg, tesseract, sharp) |
| `docker-compose.yml` | Local development and testing |
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

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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
# Build image
docker compose build

# Build with no cache
docker compose build --no-cache

# Build with version tag
VERSION=5.14.0 docker compose build
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

# Tag with version
docker tag msarychau/mcp-zebrunner:latest msarychau/mcp-zebrunner:5.14.0

# Push both tags
docker push msarychau/mcp-zebrunner:5.14.0
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

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZEBRUNNER_URL` | ✅ Yes | - | Base URL of Zebrunner instance |
| `ZEBRUNNER_LOGIN` | ✅ Yes | - | Zebrunner username |
| `ZEBRUNNER_TOKEN` | ✅ Yes | - | Zebrunner API token |
| `DEBUG` | No | `false` | Enable debug logging |
| `EXPERIMENTAL_FEATURES` | No | `false` | Enable experimental endpoints |
| `MAX_PAGE_SIZE` | No | `100` | Maximum API page size |
| `DEFAULT_PAGE_SIZE` | No | `10` | Default API page size |
| `ENABLE_RULES_ENGINE` | No | `false` | Enable rules-based test generation |

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

*Last Updated: December 2025*
