/** Worktree change notifier: lazy per-workspace fs watchers → debounced `workspace.fsChanged` push. */
export { ensureWatch, isIgnoredPath, setWatchPublisher, stopAllWatches, stopWatch } from "./watch";
