/**
 * Pre-download the local embedding model into the build image so the runtime
 * container never has to fetch it (avoids first-request latency and a network
 * dependency on Cloud Run). Best-effort: if it fails during the build, the
 * runtime will download on first use instead.
 *
 * Honors MEMORIA_MODEL_CACHE for the destination directory.
 */
const MODEL = "Xenova/all-MiniLM-L6-v2";

try {
  const { pipeline, env } = await import("@xenova/transformers");
  if (process.env.MEMORIA_MODEL_CACHE) {
    env.cacheDir = process.env.MEMORIA_MODEL_CACHE;
  }
  await pipeline("feature-extraction", MODEL);
  process.stderr.write(`prefetch: cached ${MODEL} to ${env.cacheDir}\n`);
} catch (err) {
  process.stderr.write(
    `prefetch: skipped (${err?.message ?? err}); runtime will download ${MODEL} on first use\n`,
  );
}
