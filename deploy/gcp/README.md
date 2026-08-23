# Deploying Memoria to Google Cloud Run

Reference deployment: Cloud Run (gen2) + a GCS FUSE volume for durable storage
+ Secret Manager for the three secrets. This is how the maintainer runs it; it
is a template, not a managed offering — substitute your own project, bucket and
URL. Nothing in the server is GCP-specific (it only needs a directory at
`MEMORIA_DIR`), so the same image runs on Fly.io, Railway, a VPS with Docker,
or anywhere else with a persistent volume.

```
Cloud Run (gen2, max 1 instance)
  ├── container: node dist/http.js (port 3100)
  └── volume: GCS FUSE → /data
        └── gs://<your-bucket>/memoria/
              ├── memories/**/*.md          (canonical store — plain Markdown)
              ├── data/memoria.sqlite       (derived search index, rebuildable)
              ├── data/event-buffer.sqlite  (encrypted collector ring buffer)
              └── data/collector-config.enc (encrypted source credentials)
```

> **Why `max-instances 1`:** the derived SQLite/FTS5 index lives on the FUSE
> volume and concurrent writers across instances corrupt the WAL. Horizontal
> scale needs the index moved off FUSE. For one person's memory this is fine.

## Files

| File | What it is |
|------|------------|
| `cloudbuild.yaml` | Cloud Build: build image → push to Artifact Registry → `gcloud run deploy`. Single source of truth for the deployed config (memory, volume, secrets, scaling, SA). Takes `_BUCKET` and `_PUBLIC_URL` substitutions. |
| `github-deploy.yml.example` | GitHub Actions workflow: after CI passes on `main`, run Cloud Build, smoke-test the live revision (health + dashboard + auth gate = 401), auto-rollback traffic on failure. Copy to `.github/workflows/deploy.yml` to enable. |
| `deploy-demo.sh` | Deploys a **public demo** service with throwaway generated data under a zero-privilege service account, so a demo compromise cannot reach real secrets or memories. |

## One-time setup

```bash
PROJECT_ID=your-project        # gcloud config set project $PROJECT_ID
REGION=us-central1
BUCKET=your-memoria-bucket

# 1. APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

# 2. Artifact Registry repo (name must match _REPO in cloudbuild.yaml)
gcloud artifacts repositories create memoria --repository-format=docker --location=$REGION

# 3. Secrets — all three are required; generate them locally and pipe them in
#    (never paste secrets on a command line or into chat).
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" \
  | gcloud secrets create memoria-api-key --data-file=-
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" \
  | gcloud secrets create memoria-oauth-client-secret --data-file=-
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" \
  | gcloud secrets create memoria-encryption-key --data-file=-

# 4. Bucket for the store
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access

# 5. Least-privilege runtime service account (resource-scoped grants only)
gcloud iam service-accounts create memoria-runtime --display-name="Memoria Cloud Run runtime"
RUNTIME_SA="memoria-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
for s in memoria-api-key memoria-oauth-client-secret memoria-encryption-key; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor
done
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/storage.objectUser

# 6. Let the Cloud Build deployer act as the runtime SA
PROJECT_NUM=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser
```

## Deploy

The service URL is only known after the first deploy, and `MEMORIA_PUBLIC_URL`
must be pinned to it — so deploy twice the first time:

```bash
# First deploy (placeholder URL; OAuth discovery will be wrong until step 2)
gcloud builds submit . --config deploy/gcp/cloudbuild.yaml \
  --substitutions "SHORT_SHA=$(git rev-parse --short HEAD),_BUCKET=$BUCKET,_PUBLIC_URL=https://placeholder.invalid"

SERVICE_URL=$(gcloud run services describe memoria --region=$REGION --format='value(status.url)')

# Re-deploy with the real URL
gcloud builds submit . --config deploy/gcp/cloudbuild.yaml \
  --substitutions "SHORT_SHA=$(git rev-parse --short HEAD),_BUCKET=$BUCKET,_PUBLIC_URL=$SERVICE_URL"

curl "$SERVICE_URL/health"
```

Then in claude.ai → Settings → Connectors → Add custom connector:
URL `$SERVICE_URL/mcp`, OAuth client id `memoria`, client secret = the value
of `memoria-oauth-client-secret`.

## Continuous deployment

Copy `github-deploy.yml.example` to `.github/workflows/deploy.yml`, then set
repository **variables** `GCP_PROJECT_ID`, `MEMORIA_SERVICE_URL`,
`MEMORIA_BUCKET` and either the **secrets** `GCP_WIF_PROVIDER` +
`GCP_DEPLOY_SA` (Workload Identity Federation, preferred) or `GCP_SA_KEY`.
The workflow is gated on those secrets: with none set it skips silently, so a
fork never emails deploy failures.

## Security notes

* The service is `--allow-unauthenticated` at the network level and
  `BIND_ALL=true`; the bearer API key / OAuth are the **only** access control.
  See `SECURITY.md` at the repo root for the full trust model.
* The encryption key is pinned from Secret Manager so it never sits on the same
  bucket as the ciphertext it protects.
* Keep `max-instances 1` (see above).
