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
    vips-dev

WORKDIR /build

# Copy package files first (leverage Docker layer caching)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy source code and config files
COPY tsconfig.json ./
COPY src/ ./src/

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
LABEL ai.mcp.transport="stdio"

# Install runtime dependencies for native modules
# - vips: required by sharp for image processing
# - ffmpeg: required for video analysis
# - tesseract-ocr: required for OCR in screenshots
# - ca-certificates: for HTTPS requests
RUN apk add --no-cache \
    vips \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    ca-certificates \
    tini \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S mcpuser && \
    adduser -u 1001 -S mcpuser -G mcpuser

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder --chown=mcpuser:mcpuser /build/dist ./dist
COPY --from=builder --chown=mcpuser:mcpuser /build/node_modules ./node_modules
COPY --from=builder --chown=mcpuser:mcpuser /build/package.json ./

# Copy default rules file if needed by rules engine
COPY --chown=mcpuser:mcpuser mcp-zebrunner-rules.md.example ./mcp-zebrunner-rules.md

# Copy tesseract training data (for OCR)
COPY --chown=mcpuser:mcpuser eng.traineddata /usr/share/tessdata/

# Create directory for optional config mounts
RUN mkdir -p /config && chown mcpuser:mcpuser /config

# Switch to non-root user
USER mcpuser

# Environment variables with defaults
ENV NODE_ENV=production
ENV DEBUG=false
ENV EXPERIMENTAL_FEATURES=false
ENV MAX_PAGE_SIZE=100
ENV DEFAULT_PAGE_SIZE=10
ENV ENABLE_RULES_ENGINE=false

# Required environment variables (must be provided at runtime)
# ENV ZEBRUNNER_URL=
# ENV ZEBRUNNER_LOGIN=
# ENV ZEBRUNNER_TOKEN=

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start MCP server (stdio transport)
CMD ["node", "dist/server.js"]
