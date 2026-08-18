/** A chat's TODO plan read/write (`todo.*`), scoped per session — powers the in-chat plan popup. */

/** Host-observed change-set capture: tee `todo_*` tool ends and commit each item's work on `done`. */
export { isTodoToolEnd, maybeAttachChangeArtifacts } from "./artifacts";
/** The stored review decision (host sidecar) — the host's requestFix/rollback round-trip carries it. */
export type { TodoReviewRecord } from "./reviews";
export * from "./todos";
