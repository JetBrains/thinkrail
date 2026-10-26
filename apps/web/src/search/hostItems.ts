import {
	RiChat2Line,
	RiChatHistoryLine,
	RiFileTextLine,
	RiGitBranchLine,
	RiListCheck3,
	RiNodeTree,
} from "@remixicon/react";
import type { MatchRange, SearchGroup, SearchHit } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import type { PaletteItem, PaletteMatch } from "./model";

export interface HostItemContext {
	readonly t: Translator;
	readonly openHit: (hit: SearchHit) => void;
	readonly projectName: (projectId: string) => string | undefined;
	readonly workspaceName: (workspaceId: string) => string | undefined;
	readonly localIds: ReadonlySet<string>;
	readonly lateIds: ReadonlySet<string>;
}

function splitPathRanges(
	ranges: readonly MatchRange[] | undefined,
	dirLength: number,
): { title: MatchRange[]; subtitle: MatchRange[] } {
	const title: MatchRange[] = [];
	const subtitle: MatchRange[] = [];
	const nameStart = dirLength === 0 ? 0 : dirLength + 1;
	for (const [start, end] of ranges ?? []) {
		if (end <= dirLength) subtitle.push([start, end]);
		else if (start >= nameStart) title.push([start - nameStart, end - nameStart]);
		else {
			if (start < dirLength) subtitle.push([start, dirLength]);
			title.push([0, end - nameStart]);
		}
	}
	return { title, subtitle };
}

function matchOf(hit: SearchHit, ranges: PaletteMatch["ranges"]): PaletteMatch {
	return { tier: hit.tier, score: hit.score, ranges };
}

function where(context: HostItemContext, hit: SearchHit): string {
	const project = context.projectName(hit.projectId) ?? "";
	const workspace = hit.workspaceId ? context.workspaceName(hit.workspaceId) : undefined;
	return workspace ? context.t("search.item.inWorkspace", { project, workspace }) : project;
}

function hostItem(context: HostItemContext, hit: SearchHit): PaletteItem | null {
	const base = {
		id: hit.id,
		projectId: hit.projectId,
		...(hit.workspaceId ? { workspaceId: hit.workspaceId } : {}),
		...(hit.sessionId ? { sessionId: hit.sessionId } : {}),
		...(context.lateIds.has(hit.id) ? { late: true } : {}),
		run: () => context.openHit(hit),
	};
	switch (hit.kind) {
		case "file": {
			if (!hit.workspaceId || !hit.path) return null;
			const dir = hit.subtitle ?? "";
			const ranges = splitPathRanges(hit.ranges?.path, dir.length);
			const location = where(context, hit);
			return {
				...base,
				kind: "file",
				title: hit.title,
				subtitle: dir ? `${location} · ${dir}` : location,
				group: "files",
				scope: "files",
				icon: RiFileTextLine,
				match: matchOf(hit, {
					title: ranges.title,
					subtitle: ranges.subtitle.map(([start, end]) => [
						start + location.length + 3,
						end + location.length + 3,
					]),
				}),
				file: { workspaceId: hit.workspaceId, path: hit.path },
			};
		}
		case "spec":
			if (!hit.workspaceId || !hit.path) return null;
			return {
				...base,
				kind: "spec",
				title: hit.title,
				subtitle: hit.snippet ?? hit.path ?? "",
				group: "specs",
				scope: "specs",
				icon: RiNodeTree,
				match: matchOf(
					hit,
					hit.snippet
						? { subtitle: hit.ranges?.snippet ?? [] }
						: { title: hit.ranges?.title ?? [], subtitle: hit.ranges?.path ?? [] },
				),
				file: { workspaceId: hit.workspaceId, path: hit.path },
			};
		case "plan":
			return {
				...base,
				kind: "plan",
				title: hit.title,
				subtitle: [hit.subtitle, where(context, hit)].filter(Boolean).join(" · "),
				group: "plans",
				scope: "work",
				icon: RiListCheck3,
				match: matchOf(hit, { title: hit.ranges?.title ?? [] }),
			};
		case "transcript":
			return {
				...base,
				kind: "transcript",
				title: hit.title,
				subtitle: [hit.subtitle, where(context, hit)].filter(Boolean).join(" · "),
				group: "transcripts",
				scope: "work",
				icon: RiChatHistoryLine,
				match: matchOf(hit, { title: hit.ranges?.title ?? [] }),
				...(hit.sessionId
					? {
							previewTarget: {
								kind: "chat",
								sessionId: hit.sessionId,
								...(hit.messageIndex === undefined ? {} : { messageIndex: hit.messageIndex }),
							},
						}
					: {}),
			};
		case "chat":
			if (context.localIds.has(hit.id)) return null;
			return {
				...base,
				kind: "chat",
				title: hit.title,
				subtitle: where(context, hit),
				group: "chats",
				scope: "work",
				icon: RiChat2Line,
				match: matchOf(hit, { title: hit.ranges?.title ?? [] }),
				...(hit.sessionId ? { previewTarget: { kind: "chat", sessionId: hit.sessionId } } : {}),
			};
		case "workspace":
			if (context.localIds.has(hit.id)) return null;
			return {
				...base,
				kind: "workspace",
				title: hit.title,
				subtitle: [context.projectName(hit.projectId), hit.subtitle].filter(Boolean).join(" · "),
				group: "workspaces",
				scope: "work",
				icon: RiGitBranchLine,
				match: matchOf(hit, { title: hit.ranges?.title ?? [] }),
			};
	}
}

export function hostItems(context: HostItemContext, groups: readonly SearchGroup[]): PaletteItem[] {
	const items: PaletteItem[] = [];
	for (const group of groups) {
		for (const hit of group.hits) {
			const item = hostItem(context, hit);
			if (item) items.push(item);
		}
	}
	return items;
}
