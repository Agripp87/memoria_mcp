FROM node:22-alpine AS builder

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install
COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
WORKDIR /app/mcp-server
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

# Copy source and build
COPY mcp-server/tsconfig.json ./
COPY mcp-server/src ./src
COPY mcp-server/scripts ./scripts
RUN npm run build

# Pre-bake the local embedding model (all-MiniLM-L6-v2) so the runtime image
# doesn't download it on first request. Best-effort — won't fail the build.
ENV MEMORIA_MODEL_CACHE=/app/mcp-server/.models
RUN mkdir -p /app/mcp-server/.models && (node scripts/prefetch-model.mjs || true)

# --- Production stage ---
FROM node:22-alpine

RUN apk add --no-cache tini curl

# Create non-root user (use GID/UID 1001 since 1000 is taken by 'node')
RUN addgroup -g 1001 memoria && adduser -D -u 1001 -G memoria memoria

WORKDIR /app/mcp-server

# Copy built output and production deps
COPY --from=builder /app/mcp-server/dist ./dist
COPY --from=builder /app/mcp-server/node_modules ./node_modules
COPY --from=builder /app/mcp-server/package.json ./

# mcp-server helper scripts (incl. the demo data generator + demo entrypoint).
# Unused by the main service; the separate `memoria-demo` service uses them to
# generate throwaway data at startup. Small + harmless to bake in.
COPY --from=builder /app/mcp-server/scripts ./scripts

# Pre-baked embedding model cache (may be empty if prefetch was skipped)
COPY --from=builder /app/mcp-server/.models ./.models

# Copy the generic helper scripts (sync library etc). NOTE: memory files are deliberately NOT baked
# into the image — at runtime MEMORIA_DIR=/data/memoria (the mounted volume) is
# the store, so a baked /app/memories would only be stale personal data shipped
# inside the container image. The runtime memories dir is created below.
COPY scripts /app/scripts

# Create data directory for SQLite persistence with correct ownership
RUN mkdir -p /data/memoria/memories /data/memoria/data && \
    chown -R memoria:memoria /data /app

ENV NODE_ENV=production
ENV DOCKER=true
ENV BIND_ALL=true
ENV PORT=3100
ENV MEMORIA_DIR=/data/memoria
# Local semantic embeddings (all-MiniLM-L6-v2). Uses the pre-baked model cache;
# falls back to a one-time download if the cache is empty. Set
# MEMORIA_EMBEDDINGS=hash to force the lexical fallback, or provide OPENAI_API_KEY.
ENV MEMORIA_MODEL_CACHE=/app/mcp-server/.models
# Token DB on container-local disk (NOT the gcsfuse MEMORIA_DIR) — SQLite WAL is
# unreliable on GCS FUSE. Tokens are ephemeral (24h); losing them on restart
# just forces a cheap re-auth. The .md memory files remain the durable store.
ENV MEMORIA_TOKEN_DB_DIR=/tmp/memoria

EXPOSE 3100

USER memoria

# Use tini for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/http.js"]
