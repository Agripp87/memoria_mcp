// Pin embeddings to the deterministic n-gram provider for the whole suite.
// Set before any test module imports embeddings.ts (which reads this at load).
process.env.MEMORIA_EMBEDDINGS = "hash";
