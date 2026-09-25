import { existsSync, type FSWatcher, watch } from "node:fs";

const IGNORED_SEGMENTS = new Set(["node_modules", ".git"]);

export const changedExtension = (filename: string | null) => {
	if (!filename) return undefined;
	const segments = filename.split(/[\\/]/);
	if (segments.length < 2 || segments.some((segment) => IGNORED_SEGMENTS.has(segment)))
		return undefined;
	return segments[0] || undefined;
};

export const createExtWatcher = ({
	debounceMs,
	onChange,
	warn,
}: {
	debounceMs: number;
	onChange: (name: string) => void;
	warn?: (message: string) => void;
}) => {
	const watchers = new Map<string, FSWatcher>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let closed = false;

	const schedule = (name: string) => {
		clearTimeout(timers.get(name));
		timers.set(
			name,
			setTimeout(() => {
				timers.delete(name);
				if (!closed) onChange(name);
			}, debounceMs),
		);
	};

	const arm = (root: string) => {
		try {
			const watcher = watch(root, { recursive: true }, (_event, filename) => {
				const name = changedExtension(filename);
				if (name) schedule(name);
			});
			watcher.on("error", (error) => warn?.(`extension watcher ${root}: ${String(error)}`));
			watchers.set(root, watcher);
		} catch (error) {
			warn?.(`extension watcher ${root}: ${String(error)}`);
		}
	};

	return {
		sync(roots: readonly string[]) {
			if (closed) return;
			const wanted = new Set(roots.filter((root) => existsSync(root)));
			for (const [root, watcher] of watchers) {
				if (wanted.has(root)) continue;
				watcher.close();
				watchers.delete(root);
			}
			for (const root of wanted) if (!watchers.has(root)) arm(root);
		},
		watched: () => [...watchers.keys()],
		dispose() {
			closed = true;
			for (const watcher of watchers.values()) watcher.close();
			watchers.clear();
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		},
	};
};
