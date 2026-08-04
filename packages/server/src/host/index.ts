/** The engine host: `Bun.serve` HTTP+WS, static SPA serving, the WS dispatch registry, and `bootHost`. */

// A launcher declares its own provenance when it boots us; re-exported here because `analytics` is
// host-private by spec (only `host` may import it).
export type { BuildKind } from "../analytics";
export * from "./boot";
export * from "./server";
