#!/usr/bin/env bash
# Build + push the 2 images this fork needs for Headlamp/k8s deployment:
#   1. hieuduongnewai/hyperdx                 (API + App, target=prod)
#   2. hieuduongnewai/hyperdx-otel-collector   (OTel Collector, target=prod)
#
# Both are required — the official docker.hyperdx.io/hyperdx/hyperdx-otel-
# collector:2.7.1 image is NOT compatible with this fork's hyperdx-api: the
# app sends an OpAMP config with a "json" field in the ClickHouse exporter
# config that the 2.7.1 collector doesn't understand ('' has invalid keys:
# json), because this repo's source is newer than that release. Building the
# collector from this same source keeps both sides on the same config schema.
#
# Run this from the ROOT of the hyperdx repo, on a machine with Docker
# Desktop (or any Docker with Buildx) running, already logged in via:
#   docker login -u hieuduongnewai
#
# Usage:
#   ./k8s/headlamp/build-and-push.sh [tag]
# Default tag is "latest". Pass a specific tag (e.g. a short git sha) if you
# want a versioned rollback target instead of always overwriting :latest.

set -euo pipefail

DOCKERHUB_USER="hieuduongnewai"
TAG="${1:-latest}"

API_APP_IMAGE="${DOCKERHUB_USER}/hyperdx:${TAG}"
OTEL_IMAGE="${DOCKERHUB_USER}/hyperdx-otel-collector:${TAG}"

echo "=== Building ${API_APP_IMAGE} (API + App, target=prod) ==="
docker build \
  --build-context hyperdx=./docker/hyperdx \
  --build-context api=./packages/api \
  --build-context app=./packages/app \
  -f ./docker/hyperdx/Dockerfile \
  --target prod \
  -t "${API_APP_IMAGE}" \
  .

echo "=== Building ${OTEL_IMAGE} (OTel Collector, target=prod) ==="
docker build \
  -f ./docker/otel-collector/Dockerfile \
  --target prod \
  -t "${OTEL_IMAGE}" \
  .

echo "=== Pushing images to Docker Hub ==="
docker push "${API_APP_IMAGE}"
docker push "${OTEL_IMAGE}"

echo ""
echo "Done. Images pushed:"
echo "  - ${API_APP_IMAGE}"
echo "  - ${OTEL_IMAGE}"
echo ""
echo "If you used a versioned tag (not 'latest'), update the image: fields in"
echo "k8s/headlamp/08-otel-collector-deployment.yaml and"
echo "k8s/headlamp/10-hyperdx-api-deployment.yaml (and 00-all-in-one.yaml)"
echo "before applying them."
