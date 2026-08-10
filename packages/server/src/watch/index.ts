/** Worktree change notifier: lazy per-workspace fs watchers → debounced `workspace.fsChanged` push. */
export {
	ensureWatch,
	isIgnoredPath,
	setRepoMetaPublisher,
	setWatchPublisher,
	setWatchSkillSnapshotter,
	stopAllWatches,
	stopWatch,
} from "./watch";
