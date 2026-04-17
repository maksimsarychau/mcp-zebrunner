# check=skip=SecretsUsedInArgOrEnv
# ══════════════════════════════════════════════════════════════════════════════
# Zebrunner MCP Server - Multi-stage Docker Build
# ══════════════════════════════════════════════════════════════════════════════
# Supports: stdio transport (default), video/image analysis (ffmpeg, sharp, tesseract)
# Usage: docker build -t msarychau/mcp-zebrunner:latest .
# ══════════════════════════════════════════════════════════════════════════════

ARG NODE_VERSION=20

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder - Compile TypeScript and install dependencies
# ──────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder

# Install build dependencies for native modules (sharp, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    vips-dev

WORKDIR /build

# Copy package files first (leverage Docker layer caching)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for TypeScript compilation)
# sharp@0.34 needs node-addon-api + node-gyp to build from source on Alpine
RUN npm ci

# Copy source code and config files
COPY tsconfig.json ./
COPY src/ ./src/
COPY .integrity-signatur[e] ./

# Build TypeScript to JavaScript
RUN npm run build

# Prune devDependencies for smaller production image
RUN npm prune --production

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Production - Minimal runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS production

# Labels for Docker Hub and container identification
LABEL org.opencontainers.image.title="Zebrunner MCP Server"
LABEL org.opencontainers.image.description="MCP server for Zebrunner TCM - test cases, suites, coverage analysis, launchers, and reporting"
LABEL org.opencontainers.image.vendor="Maksim Sarychau"
LABEL org.opencontainers.image.url="https://github.com/maksimsarychau/mcp-zebrunner"
LABEL org.opencontainers.image.source="https://github.com/maksimsarychau/mcp-zebrunner"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL ai.mcp.server="true"
LABEL ai.mcp.transport="stdio,streamablehttp"

# Install runtime dependencies for native modules
# - vips: required by sharp for image processing
# - ffmpeg: required for video analysis
# - tesseract-ocr: required for OCR in screenshots
# - ca-certificates: for HTTPS requests
# - wget: for downloading tessdata
RUN apk add --no-cache \
    vips \
    ffmpeg \
    tesseract-ocr \
    ca-certificates \
    wget \
    && rm -rf /var/cache/apk/*

# Download tesseract training data from official repository
RUN mkdir -p /usr/share/tessdata && \
    wget -q -O /usr/share/tessdata/eng.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata

# Create non-root user for security
RUN addgroup -g 1001 -S mcpuser && \
    adduser -u 1001 -S mcpuser -G mcpuser

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder --chown=mcpuser:mcpuser /build/dist ./dist
COPY --from=builder --chown=mcpuser:mcpuser /build/node_modules ./node_modules
COPY --from=builder --chown=mcpuser:mcpuser /build/package.json ./

COPY --from=builder --chown=mcpuser:mcpuser /build/.integrity-signatur[e] ./
COPY --chown=mcpuser:mcpuser .mcp-statu[s] ./

# Copy default rules file if it exists (use wildcard to avoid build failure)
COPY --chown=mcpuser:mcpuser mcp-zebrunner-rules.md* ./

# Create directories for optional config mounts and token store
RUN mkdir -p /config /data && chown mcpuser:mcpuser /config /data

# Switch to non-root user
USER mcpuser

# Environment variables with defaults
ENV NODE_ENV=production
ENV DEBUG=false
ENV MAX_PAGE_SIZE=100
ENV DEFAULT_PAGE_SIZE=10
ENV ENABLE_RULES_ENGINE=false

# Transport configuration (auto-detect: PORT present = HTTP, otherwise STDIO)
ENV MCP_TRANSPORT=auto
ENV PORT=""
ENV MCP_AUTH_MODE=headers
ENV MCP_SERVER_URL=""

# Required environment variables (must be provided at runtime)
# STDIO mode: ZEBRUNNER_URL, ZEBRUNNER_LOGIN, ZEBRUNNER_TOKEN
# HTTP mode: ZEBRUNNER_URL only (credentials come per-request via headers)

# Expose port for HTTP mode (no-op in STDIO mode)
EXPOSE 3000

# Start MCP server — auto-detects STDIO vs HTTP based on PORT
CMD ["node", "dist/server.js"]
