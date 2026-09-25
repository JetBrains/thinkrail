import { type FSWatcher, watch } from "node:fs";
import { defineExtension } from "@thinkrail/ext";
import { fetchRemotes, gitDirOf, readPulse } from "./git";
import { CHANNEL_PREFIX, channelKey, type FetchResult, type Pulse } from "./model";

const POLL_MS = 4_000;
const WATCH_DEBOUNCE_MS = 250;

interface Tracked {
	workspaceId: string;
	path: string | undefined;
	watcher: FSWatcher | undefined;
	debounce: ReturnType<typeof setTimeout> | undefined;
	running: boolean;
	again: boolean;
	published: string | undefined;
	fetching: Promise<FetchResult> | undefined;
	abort: AbortController;
}

export default defineExtension((tr) => {
	const tracked = new Map<string, Tracked>();
	const generation = new AbortController();

	const publish = (entry: Tracked, pulse: Pulse) => {
		if (tracked.get(entry.workspaceId) !== entry) return;
		const text = JSON.stringify(pulse);
		if (text === entry.published) return;
		entry.published = text;
		tr.publish(channelKey(entry.workspaceId), pulse);
	};

	const closeWatcher = (entry: Tracked) => {
		entry.watcher?.close();
		entry.watcher = undefined;
		if (entry.debounce) clearTimeout(entry.debounce);
		entry.debounce = undefined;
	};

	const watchGitDir = async (entry: Tracked, path: string) => {
		const found = await gitDirOf(path, entry.abort.signal);
		if (!("gitDir" in found) || entry.watcher || entry.path !== path) return;
		if (tracked.get(entry.workspaceId) !== entry) return;
		try {
			entry.watcher = watch(found.gitDir, { persistent: false }, () => {
				if (entry.debounce) clearTimeout(entry.debounce);
				entry.debounce = setTimeout(() => void refresh(entry), WATCH_DEBOUNCE_MS);
			});
			entry.watcher.on("error", () => closeWatcher(entry));
		} catch (error) {
			tr.log(`watch ${found.gitDir} failed`, error);
		}
	};

	const refresh = async (entry: Tracked): Promise<void> => {
		if (entry.running) {
			entry.again = true;
			return;
		}
		entry.running = true;
		try {
			const path = tr.workspaces.get(entry.workspaceId)?.path;
			if (!path) {
				publish(entry, { state: "error", message: "This workspace is not open." });
				return;
			}
			if (entry.path !== path) {
				closeWatcher(entry);
				entry.path = path;
			}
			const pulse = await readPulse(path, entry.abort.signal);
			publish(entry, pulse);
			if (pulse.state === "ready" && !entry.watcher) await watchGitDir(entry, path);
		} catch (error) {
			publish(entry, { state: "error", message: String(error) });
		} finally {
			entry.running = false;
		}
		if (entry.again && tracked.get(entry.workspaceId) === entry) {
			entry.again = false;
			await refresh(entry);
		}
	};

	const start = (workspaceId: string) => {
		if (tracked.has(workspaceId)) return;
		const entry: Tracked = {
			workspaceId,
			path: undefined,
			watcher: undefined,
			debounce: undefined,
			running: false,
			again: false,
			published: undefined,
			fetching: undefined,
			abort: new AbortController(),
		};
		tracked.set(workspaceId, entry);
		publish(entry, { state: "loading" });
		void refresh(entry);
	};

	const stop = (workspaceId: string) => {
		const entry = tracked.get(workspaceId);
		if (!entry) return;
		closeWatcher(entry);
		entry.abort.abort();
		tracked.delete(workspaceId);
		tr.unpublish(channelKey(workspaceId));
	};

	tr.onWatch((key, watching) => {
		if (!key.startsWith(CHANNEL_PREFIX)) return;
		const workspaceId = key.slice(CHANNEL_PREFIX.length);
		if (watching) start(workspaceId);
		else stop(workspaceId);
	});

	tr.every(POLL_MS, () => {
		for (const entry of tracked.values()) void refresh(entry);
	});

	tr.action("refresh", async (_payload, ctx) => {
		const entry = ctx.workspaceId ? tracked.get(ctx.workspaceId) : undefined;
		if (!entry) return { refreshed: false };
		await refresh(entry);
		return { refreshed: true };
	});

	tr.action("fetch", async (_payload, ctx): Promise<FetchResult> => {
		const workspaceId = ctx.workspaceId;
		const path = workspaceId ? tr.workspaces.get(workspaceId)?.path : undefined;
		if (!workspaceId || !path)
			return { ok: false, output: "No open workspace to fetch.", at: Date.now() };
		const entry = tracked.get(workspaceId);
		if (entry?.fetching) return entry.fetching;
		const fetching = fetchRemotes(path, (entry?.abort ?? generation).signal);
		if (entry) entry.fetching = fetching;
		try {
			const result = await fetching;
			tr.log(`fetch ${path}: ${result.ok ? "ok" : "failed"}`);
			if (entry) await refresh(entry);
			return result;
		} finally {
			if (entry?.fetching === fetching) entry.fetching = undefined;
		}
	});

	return () => {
		generation.abort();
		for (const entry of tracked.values()) {
			closeWatcher(entry);
			entry.abort.abort();
		}
		tracked.clear();
	};
});
