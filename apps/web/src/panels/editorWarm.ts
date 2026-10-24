import { type ResourceDescriptor, usePreloadResourceView } from "@thinkrail/resource-renderers";
import { isRecord, usePhoneViewport, whenIdle } from "../lib";

const HOVER_WARM_DELAY_MS = 150;

let loadingTrees = 0;
let hoverWarm: ReturnType<typeof setTimeout> | undefined;
const parked = new Set<() => void>();

function savesData(): boolean {
	const connection: unknown = Reflect.get(navigator, "connection");
	return isRecord(connection) && connection.saveData === true;
}

export function useEditorWarm(): ((resource: ResourceDescriptor) => void) | undefined {
	const preload = usePreloadResourceView();
	const phone = usePhoneViewport();
	return phone || savesData() ? undefined : preload;
}

export function holdEditorWarm(): () => void {
	loadingTrees += 1;
	let held = true;
	return () => {
		if (!held) return;
		held = false;
		loadingTrees -= 1;
		if (loadingTrees > 0) return;
		const ready = [...parked];
		parked.clear();
		for (const resume of ready) resume();
	};
}

export function whenFilesTreeIdle(
	task: () => void,
	options: { timeout: number; fallbackDelay: number },
): () => void {
	let cancelled = false;
	let cancel = () => {};
	function schedule() {
		if (!cancelled) cancel = whenIdle(attempt, options);
	}
	function attempt() {
		if (loadingTrees === 0) {
			task();
			return;
		}
		parked.add(schedule);
		cancel = () => parked.delete(schedule);
	}
	schedule();
	return () => {
		cancelled = true;
		cancel();
	};
}

export function warmOnHover(run: () => void, delay = HOVER_WARM_DELAY_MS): void {
	clearTimeout(hoverWarm);
	hoverWarm = setTimeout(run, delay);
}
