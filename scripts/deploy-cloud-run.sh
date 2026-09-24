#!/usr/bin/env bash
# Build, tag, push, and deploy this service to Cloud Run.
# Usage: npm run deploy:gcp — override any var below by exporting it first.
set -euo pipefail

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

GCP_PROJECT="${GCP_PROJECT:-gcp-rttforcxocoeten-prd-24305}"
GCP_REGION="${GCP_REGION:-us-central1}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:-wxcc-byoc}"
ARTIFACT_REGISTRY_REPO="${ARTIFACT_REGISTRY_REPO:-wxcc-demos}"
IMAGE_TAG="${IMAGE_TAG:-amd64}"
IMAGE="us-central1-docker.pkg.dev/${GCP_PROJECT}/${ARTIFACT_REGISTRY_REPO}/${CLOUD_RUN_SERVICE}:${IMAGE_TAG}"

PODMAN="${PODMAN:-$(command -v /opt/podman/bin/podman || command -v podman)}"

echo "==> Building ${IMAGE}"
"$PODMAN" build --platform linux/amd64 -t "${CLOUD_RUN_SERVICE}:${IMAGE_TAG}" . # amd64: Cloud Run doesn't run arm64

echo "==> Tagging"
"$PODMAN" tag "localhost/${CLOUD_RUN_SERVICE}:${IMAGE_TAG}" "$IMAGE"

echo "==> Logging in to Artifact Registry"
gcloud auth print-access-token | "$PODMAN" login us-central1-docker.pkg.dev \
  --username oauth2accesstoken --password-stdin

echo "==> Pushing"
"$PODMAN" push "$IMAGE"

echo "==> Deploying"
gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image="$IMAGE" \
  --region "$GCP_REGION" \
  --project "$GCP_PROJECT" \
  --no-invoker-iam-check \
  --platform managed \
  --port=8080 \
  --min-instances=0 \
  --max-instances=1 # required: correlation store + file relay are in-memory, single-instance only

echo "==> Done."
