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
  const { pipeline, env } = await import("@huggingface/transformers");
  if (process.env.MEMORIA_MODEL_CACHE) {
    env.cacheDir = process.env.MEMORIA_MODEL_CACHE;
  }
  // Must match the dtype embeddings.ts requests, or the image pre-bakes
  // weights the runtime will not use and downloads the real ones anyway.
  await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  process.stderr.write(`prefetch: cached ${MODEL} to ${env.cacheDir}\n`);
} catch (err) {
  process.stderr.write(
    `prefetch: skipped (${err?.message ?? err}); runtime will download ${MODEL} on first use\n`,
  );
}
