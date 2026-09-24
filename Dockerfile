# Debian (glibc), not Alpine (musl). onnxruntime-node, which runs the local
# embedding model, ships glibc binaries only: on Alpine it cannot load
# (ld-linux-x86-64.so.2 missing), so MiniLM, the default provider, failed on
# every embedding, and a container started on a non-empty store exited at its
# first reindex. The swallowed model prefetch hid this until 2026-09.
FROM node:26-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

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
# doesn't download it on first request. A failed download fails the build: it
# used to be swallowed, shipping an image that quietly fetched the model from
# the network on its first search. Building for OpenAI or hash embeddings, or
# without network? Pass --build-arg PREFETCH_MODEL=false to skip it on purpose.
ARG PREFETCH_MODEL=true
ENV MEMORIA_MODEL_CACHE=/app/mcp-server/.models
RUN mkdir -p /app/mcp-server/.models && \
    if [ "$PREFETCH_MODEL" = "true" ]; then node scripts/prefetch-model.mjs; \
    else echo "prefetch: skipped (PREFETCH_MODEL=$PREFETCH_MODEL)"; fi

# Ship runtime dependencies only. The optional embedding dependency stays;
# TypeScript, Vitest, ESLint and the rest of the toolchain go.
RUN npm prune --omit=dev

# --- Production stage ---
FROM node:26-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user (use GID/UID 1001 since 1000 is taken by 'node'), with
# a home of its own (-m): enabling an email or Google source runs npm install
# at runtime, and npm needs a writable ~/.npm for its cache.
RUN groupadd -g 1001 memoria && \
    useradd -u 1001 -g memoria -m -s /usr/sbin/nologin memoria

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

# Copy the generic helper scripts (sync hooks etc). NOTE: memory files are deliberately NOT baked
# into the image — at runtime MEMORIA_DIR=/data/memoria (the mounted volume) is
# the store, so a baked /app/memories would only be stale personal data shipped
# inside the container image. The runtime memories dir is created below.
COPY scripts /app/scripts

# The runtime user owns its data and the model cache, and nothing else: the
# application code under /app stays root-owned, so a compromised process
# cannot rewrite the server it runs as.
RUN mkdir -p /data/memoria/memories /data/memoria/data && \
    chown -R memoria:memoria /data /app/mcp-server/.models

ENV NODE_ENV=production
ENV DOCKER=true
ENV BIND_ALL=true
ENV PORT=3100
ENV MEMORIA_DIR=/data/memoria
# Local semantic embeddings (all-MiniLM-L6-v2) from the pre-baked model cache
# (a one-time download instead if the image was built with
# PREFETCH_MODEL=false). Set
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
