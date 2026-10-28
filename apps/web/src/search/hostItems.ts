import {
	RiChat2Line,
	RiChatHistoryLine,
	RiFileTextLine,
	RiGitBranchLine,
	RiListCheck3,
	RiNodeTree,
} from "@remixicon/react";
import type { MatchRange, SearchGroup, SearchHit, SearchKind } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import type { PaletteItem, PaletteMatch } from "./model";

export const HOST_GROUP_OF_KIND: Readonly<Record<SearchKind, string>> = {
	chat: "chats",
	transcript: "transcripts",
	workspace: "workspaces",
	file: "files",
	spec: "specs",
	plan: "plans",
};

/** Per palette group, the host's true count and the ids of the page it returned. */
export interface HostTotal {
	readonly total: number;
	readonly ids: ReadonlySet<string>;
}

export function hostTotals(groups: readonly SearchGroup[]): Record<string, HostTotal> {
	const totals: Record<string, HostTotal> = {};
	for (const group of groups) {
		totals[HOST_GROUP_OF_KIND[group.kind]] = {
			total: group.total,
			ids: new Set(group.hits.map((hit) => hit.id)),
		};
	}
	return totals;
}

export interface HostItemContext {
	readonly t: Translator;
	readonly openHit: (hit: SearchHit) => void;
	readonly projectName: (projectId: string) => string | undefined;
	readonly workspaceName: (workspaceId: string) => string | undefined;
	readonly localIds: ReadonlySet<string>;
	readonly late: ReadonlyMap<string, number>;
	/** The hits answered an earlier input: ranked by the client's own match of the current one. */
	readonly stale: boolean;
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

function matchOf(
	context: HostItemContext,
	hit: SearchHit,
	ranges: PaletteMatch["ranges"],
): { match?: PaletteMatch } {
	return context.stale ? {} : { match: { tier: hit.tier, score: hit.score, ranges } };
}

function lateOf(context: HostItemContext, id: string): { late?: number } {
	const late = context.late.get(id);
	return late === undefined ? {} : { late };
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
		...lateOf(context, hit.id),
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
				...matchOf(context, hit, {
					title: ranges.title,
					subtitle: ranges.subtitle.map(([start, end]) => [
						start + location.length + 3,
						end + location.length + 3,
					]),
				}),
				file: {
					workspaceId: hit.workspaceId,
					path: hit.path,
					...(hit.size === undefined ? {} : { size: hit.size }),
				},
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
				...matchOf(
					context,
					hit,
					hit.snippet
						? { subtitle: hit.ranges?.snippet ?? [] }
						: { title: hit.ranges?.title ?? [], subtitle: hit.ranges?.path ?? [] },
				),
				file: {
					workspaceId: hit.workspaceId,
					path: hit.path,
					...(hit.size === undefined ? {} : { size: hit.size }),
				},
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
				...matchOf(context, hit, { title: hit.ranges?.title ?? [] }),
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
				...matchOf(context, hit, { title: hit.ranges?.title ?? [] }),
				...(hit.sessionId
					? {
							previewTarget: {
								kind: "chat",
								sessionId: hit.sessionId,
								...(hit.messageIndex === undefined ? {} : { messageIndex: hit.messageIndex }),
								...(hit.anchorText === undefined ? {} : { anchorText: hit.anchorText }),
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
				...matchOf(context, hit, { title: hit.ranges?.title ?? [] }),
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
				...matchOf(context, hit, { title: hit.ranges?.title ?? [] }),
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
