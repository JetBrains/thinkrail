import type { StatsInput } from "../src/crossSession.ts";
import { DigestStore, digestOf } from "../src/digest.ts";
import type { SessionPlacement } from "../src/list.ts";
import { SessionIndex } from "../src/sessionIndex.ts";
import { TraceStore } from "../src/traceStore.ts";

export const PROJECTS = [
	{ id: "p1", name: "Alpha", kind: "repository" as const },
	{ id: "p2", name: "Beta", kind: "repository" as const },
];

/** `/work/a…` → Alpha (open), `/work/b…` → Beta (open), anything else outside every project. */
export function placeByFolder(cwd: string): SessionPlacement | null {
	if (cwd.startsWith("/work/a"))
		return { projectId: "p1", workspaceId: "w1", workspaceName: "main", workspace: "open" };
	if (cwd.startsWith("/work/b"))
		return { projectId: "p2", workspaceId: "w2", workspaceName: "main", workspace: "open" };
	return { projectId: null, workspaceId: null, workspaceName: null, workspace: "none" };
}

/** A statistics input over the given session files, with every digest built before answering. */
export async function statsOver(
	files: readonly string[],
	options: {
		place?: (cwd: string) => SessionPlacement | null;
		contextWindow?: StatsInput["contextWindow"];
		budgetMs?: number;
		/** An index of the caller's, used as it is (it may still be building). */
		index?: SessionIndex;
	} = {},
): Promise<{ input: StatsInput; index: SessionIndex; builds: () => number }> {
	const index =
		options.index ??
		new SessionIndex({
			sessionFiles: async () => [...files],
			childTranscriptDirs: async () => [],
		});
	if (!options.index) await index.ensureFresh(10_000);
	const traces = new TraceStore({ sliceMs: 1000 });
	let builds = 0;
	const digests = new DigestStore(async (summary) => {
		builds += 1;
		const trace = await traces.peek(summary.file);
		return trace ? digestOf(trace, summary) : null;
	});
	return {
		index,
		builds: () => builds,
		input: {
			index,
			projects: PROJECTS,
			place: options.place ?? placeByFolder,
			status: () => ({ live: false, outcome: null }),
			digests,
			...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
			budgetMs: options.budgetMs ?? 60_000,
		},
	};
}
