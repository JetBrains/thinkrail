import { RiChatHistoryLine, RiFileTextLine, RiListCheck3, RiNodeTree } from "@remixicon/react";
import {
	MATCH_TIER,
	type MatchField,
	type MatchRange,
	type MatchTerm,
	matchFields,
	type SearchGroup,
	type SearchHit,
	type SearchKind,
} from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import type { PaletteItem, PaletteMatch } from "./model";

export const HOST_GROUP_OF_KIND: Readonly<Record<SearchKind, string>> = {
	transcript: "transcripts",
	file: "files",
	spec: "specs",
	plan: "plans",
};

export function hostOverflow(groups: readonly SearchGroup[]): Record<string, number> {
	const overflow: Record<string, number> = {};
	for (const group of groups) {
		overflow[HOST_GROUP_OF_KIND[group.kind]] = Math.max(0, group.total - group.hits.length);
	}
	return overflow;
}

export interface HostItemContext {
	readonly t: Translator;
	readonly openHit: (hit: SearchHit) => void;
	readonly projectName: (projectId: string) => string | undefined;
	readonly workspaceName: (workspaceId: string) => string | undefined;
	readonly late: ReadonlyMap<string, number>;
	readonly staleTerms: readonly MatchTerm[] | null;
}

function hostFields(hit: SearchHit): MatchField[] {
	switch (hit.kind) {
		case "file":
			return [{ key: "path", text: hit.path, path: true }];
		case "spec":
			return [
				{ key: "title", text: hit.title },
				{ key: "id", text: hit.specId, secondary: true },
				{ key: "path", text: hit.path, path: true, secondary: true },
			];
		case "plan":
		case "transcript":
			return [{ key: "title", text: hit.title }];
	}
}

function rangesOf(fields: readonly { key: string; ranges: readonly MatchRange[] }[]) {
	const ranges: Record<string, [number, number][]> = {};
	for (const field of fields) ranges[field.key] = field.ranges.map(([a, b]) => [a, b]);
	return ranges;
}

function contentRanges(text: string, terms: readonly MatchTerm[]): [number, number][] | null {
	const lower = text.toLowerCase();
	const found: [number, number][] = [];
	for (const term of terms) {
		const needle = term.text.toLowerCase();
		const at = lower.indexOf(needle);
		if (at === -1) return null;
		found.push([at, at + needle.length]);
	}
	found.sort((a, b) => a[0] - b[0]);
	const ranges: [number, number][] = [];
	for (const [start, end] of found) {
		const last = ranges.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else ranges.push([start, end]);
	}
	return ranges;
}

export function rematchHit(hit: SearchHit, terms: readonly MatchTerm[]): SearchHit | null {
	if (hit.tier === MATCH_TIER.content) {
		const [key, text] = hit.kind === "spec" ? ["snippet", hit.snippet ?? ""] : ["title", hit.title];
		const ranges = contentRanges(text, terms);
		return ranges ? { ...hit, score: 0, ranges: { [key]: ranges } } : null;
	}
	const match = matchFields(terms, hostFields(hit));
	if (!match) return null;
	return { ...hit, tier: match.tier, score: match.score, ranges: rangesOf(match.fields) };
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

function matchOf(hit: SearchHit, ranges: PaletteMatch["ranges"]): { match: PaletteMatch } {
	return { match: { tier: hit.tier, score: hit.score, ranges } };
}

function lateOf(context: HostItemContext, id: string): { late?: number } {
	const late = context.late.get(id);
	return late === undefined ? {} : { late };
}

function where(context: HostItemContext, hit: SearchHit): string {
	const project = context.projectName(hit.projectId) ?? "";
	const workspace = context.workspaceName(hit.workspaceId);
	return workspace ? context.t("search.item.inWorkspace", { project, workspace }) : project;
}

function hostItem(context: HostItemContext, hit: SearchHit): PaletteItem {
	const base = {
		id: hit.id,
		...lateOf(context, hit.id),
		run: () => context.openHit(hit),
	};
	switch (hit.kind) {
		case "file": {
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
				...matchOf(hit, {
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
			return {
				...base,
				kind: "spec",
				title: hit.title,
				subtitle: hit.snippet ?? hit.path,
				group: "specs",
				scope: "specs",
				icon: RiNodeTree,
				...matchOf(
					hit,
					hit.snippet
						? { subtitle: hit.ranges?.snippet ?? [] }
						: { title: hit.ranges?.title ?? [], subtitle: hit.ranges?.path ?? [] },
				),
				file: { workspaceId: hit.workspaceId, path: hit.path, size: hit.size },
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
				...matchOf(hit, { title: hit.ranges?.title ?? [] }),
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
				...matchOf(hit, { title: hit.ranges?.title ?? [] }),
				previewTarget: {
					kind: "chat",
					sessionId: hit.sessionId,
					messageIndex: hit.messageIndex,
					anchorText: hit.anchorText,
				},
			};
	}
}

export function hostItems(context: HostItemContext, groups: readonly SearchGroup[]): PaletteItem[] {
	const items: PaletteItem[] = [];
	for (const group of groups) {
		for (const hit of group.hits) {
			const current = context.staleTerms ? rematchHit(hit, context.staleTerms) : hit;
			if (current) items.push(hostItem(context, current));
		}
	}
	return items;
}
