#!/bin/sh
# Reproducible deploy of the PUBLIC demo dashboard (service: memoria-demo).
# Throwaway fake data, ephemeral (regenerated on every cold start), running under
# a ZERO-privilege service account (no Secret Manager, no real bucket) so a demo
# compromise cannot reach the real "memoria" service's secrets or data.
#
# One-time setup (zero-priv SA):
#   gcloud iam service-accounts create memoria-demo-runtime \
#     --display-name="Memoria demo (zero-priv)" --project "$PROJECT"
#   # grant it NOTHING.
#
# Usage: PROJECT=your-gcp-project ./deploy/gcp/deploy-demo.sh
# Run from the repo root (gcloud builds submit . uses the root Dockerfile).
set -eu

PROJECT="${PROJECT:?Set PROJECT to your GCP project id}"
REGION="${REGION:-us-central1}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT}/memoria/memoria:demo}"
SA="memoria-demo-runtime@${PROJECT}.iam.gserviceaccount.com"
DEMO_KEY="${DEMO_KEY:-memoria-demo}"

# Build the demo image (includes mcp-server/scripts for the data generator).
# Build-only (--tag), so the real "memoria" service is never touched.
gcloud builds submit . --project "$PROJECT" --tag "$IMAGE" --timeout=20m

# Deploy. The container generates fake data into /tmp at startup, then serves.
gcloud run deploy memoria-demo \
  --project "$PROJECT" --region "$REGION" --platform managed --port 3100 \
  --image "$IMAGE" \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 2 \
  --set-env-vars "BIND_ALL=true,DOCKER=true,MEMORIA_EMBEDDINGS=hash,MEMORIA_API_KEY=${DEMO_KEY}" \
  --args="sh,-c,node scripts/generate-demo-data.mjs --out /tmp/demo && MEMORIA_DIR=/tmp/demo node dist/http.js" \
  --service-account "$SA" \
  --allow-unauthenticated

echo "Demo deployed. Key: ${DEMO_KEY}"
