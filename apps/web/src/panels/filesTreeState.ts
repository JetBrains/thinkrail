import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { isRecord } from "../lib";
import { type FilesScrollView, type FilesTreeView, useAppStore } from "../store";
import { getTransport } from "../transport";

const DOCUMENT_VERSION = 1;
const STABLE_KEY = "files-tree";
const WRITE_DELAY_MS = 300;
const MAX_PATHS = 5000;
const SCROLL_VIEWS: readonly FilesScrollView[] = ["all", "changedList", "changedTree"];

interface FilesTreeStorage {
	read: () => string | null;
	write: (value: string) => void;
}

function pathList(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((path): path is string => typeof path === "string").slice(0, MAX_PATHS);
}

function scrollEntries(value: unknown): FilesTreeView["scroll"] {
	const scroll: FilesTreeView["scroll"] = {};
	if (!isRecord(value)) return scroll;
	for (const view of SCROLL_VIEWS) {
		const entry = value[view];
		if (
			isRecord(entry) &&
			typeof entry.top === "number" &&
			Number.isFinite(entry.top) &&
			entry.top >= 0 &&
			typeof entry.scope === "string"
		) {
			scroll[view] = { top: entry.top, scope: entry.scope };
		}
	}
	return scroll;
}

export function parseFilesTreeDocument(raw: string | null): Record<string, FilesTreeView> {
	if (!raw) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!isRecord(parsed) || parsed.version !== DOCUMENT_VERSION || !isRecord(parsed.workspaces)) {
		return {};
	}
	const views: Record<string, FilesTreeView> = {};
	for (const [workspaceId, view] of Object.entries(parsed.workspaces)) {
		if (!isRecord(view)) continue;
		views[workspaceId] = {
			expanded: pathList(view.expanded),
			changedCollapsed: pathList(view.changedCollapsed),
			scroll: scrollEntries(view.scroll),
			seenActivePath: typeof view.seenActivePath === "string" ? view.seenActivePath : null,
		};
	}
	return views;
}

export function serializeFilesTreeDocument(views: Record<string, FilesTreeView>): string {
	return JSON.stringify({ version: DOCUMENT_VERSION, workspaces: views });
}

function stableStorage(adapter: StablePreferenceAdapter): FilesTreeStorage {
	return {
		read: () => adapter.getItem(STABLE_KEY),
		write: (value) => adapter.setItem(STABLE_KEY, value),
	};
}

function browserStorage(): FilesTreeStorage | null {
	try {
		const storage = window.localStorage;
		const key = `${STORAGE_PREFIX}files-tree:${getTransport().httpBase()}`;
		return {
			read: () => storage.getItem(key),
			write: (value) => storage.setItem(key, value),
		};
	} catch {
		return null;
	}
}

export function initFilesTreePersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = stablePreferences ? stableStorage(stablePreferences) : browserStorage();
	if (!storage) return () => {};
	let initial: Record<string, FilesTreeView> = {};
	try {
		initial = parseFilesTreeDocument(storage.read());
	} catch {}
	useAppStore.getState().hydrateFilesTree(initial);

	let written = useAppStore.getState().filesTreeByWorkspace;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		const current = useAppStore.getState().filesTreeByWorkspace;
		if (current === written) return;
		written = current;
		try {
			storage.write(serializeFilesTreeDocument(current));
		} catch {}
	};
	const unsubscribe = useAppStore.subscribe((state) => {
		if (state.filesTreeByWorkspace === written || timer !== null) return;
		timer = setTimeout(flush, WRITE_DELAY_MS);
	});
	const canListen = typeof window !== "undefined";
	if (canListen) window.addEventListener("pagehide", flush);
	return () => {
		unsubscribe();
		if (canListen) window.removeEventListener("pagehide", flush);
		flush();
	};
}
