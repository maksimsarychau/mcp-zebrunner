#!/usr/bin/env bash
# Multi-architecture Docker build and push (linux/amd64 + linux/arm64).
# Requires: Docker Buildx, logged in to Docker Hub (`docker login`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${DOCKER_IMAGE:-msarychau/mcp-zebrunner}"
VERSION="$(node -p "require('./package.json').version")"
PLATFORMS="${DOCKER_PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${DOCKER_BUILDX_BUILDER:-mcp-zebrunner-builder}"
PUSH="${DOCKER_PUSH:-1}"

echo "==> Version: ${VERSION}"
echo "==> Image:   ${IMAGE}"
echo "==> Platforms: ${PLATFORMS}"

echo "==> npm run build && npm run sign-release"
npm run build
npm run sign-release

if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  echo "==> Creating buildx builder: ${BUILDER}"
  docker buildx create --name "${BUILDER}" --driver docker-container --use
else
  docker buildx use "${BUILDER}"
fi
docker buildx inspect --bootstrap

TAG_ARGS=(-t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest")
if [[ "${PUSH}" == "1" ]]; then
  TAG_ARGS+=(--push)
else
  echo "==> DOCKER_PUSH=0: building without push (manifest list only in buildx cache)"
  TAG_ARGS+=(--load)
  if [[ "${PLATFORMS}" == *","* ]]; then
    echo "ERROR: --load supports a single platform. Set DOCKER_PLATFORMS=linux/arm64 (or amd64) or DOCKER_PUSH=1."
    exit 1
  fi
fi

echo "==> docker buildx build"
docker buildx build \
  --platform "${PLATFORMS}" \
  --build-arg "APP_VERSION=${VERSION}" \
  "${TAG_ARGS[@]}" \
  .

echo "==> Done. Verify manifest:"
echo "    docker buildx imagetools inspect ${IMAGE}:${VERSION}"
