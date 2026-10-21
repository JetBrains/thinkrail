import type { ReviewAnchor } from "@thinkrail/contracts";
import type { ResourceIntent, ResourceRenderer, ReviewThread } from "./types";

export function anchorLabel(
	anchor: ReviewAnchor,
	ipynbCellOrdinals?: ReadonlyMap<string, number>,
): string {
	const structural = anchor.selectors.find((selector) => selector.kind === "structural");
	if (structural?.kind === "structural") {
		if (structural.scheme === "table-cell") {
			const cell = /^(\d+):(\d+)$/.exec(structural.ref);
			if (cell) return `R${cell[1]}C${cell[2]}`;
		}
		if (structural.scheme === "json-pointer") return structural.ref;
		if (structural.scheme === "ipynb-cell") {
			const index = /^index:(\d+)$/.exec(structural.ref);
			if (index) return `cell ${Number(index[1]) + 1}`;
			const ordinal = ipynbCellOrdinals?.get(structural.ref);
			return `cell ${ordinal ?? structural.ref}`;
		}
		return `${structural.scheme} ${structural.ref}`;
	}
	const line = anchor.selectors.find((selector) => selector.kind === "lineRange");
	if (line?.kind === "lineRange") {
		return line.startLine === line.endLine
			? `L${line.startLine}`
			: `L${line.startLine}–${line.endLine}`;
	}
	const region = anchor.selectors.find((selector) => selector.kind === "region");
	if (region?.kind === "region") {
		return region.page === undefined ? "region" : `p${region.page} region`;
	}
	return "file";
}

export function isPlaceable(
	renderer: ResourceRenderer,
	intent: ResourceIntent,
	anchor: ReviewAnchor,
): boolean {
	const capabilities = renderer.capabilities.anchors[intent];
	return anchor.selectors.some((selector) => {
		if (selector.kind === "lineRange") return capabilities.includes("line");
		if (selector.kind === "structural") {
			return capabilities.includes(`structural:${selector.scheme}`);
		}
		if (selector.kind === "region") return capabilities.includes("region");
		return false;
	});
}

export function threadLabel(t: Pick<ReviewThread, "status" | "anchorState" | "stale">): string {
	if (t.stale) return `${t.status} · stale`;
	if (t.anchorState === "outdated") return `${t.status} · outdated`;
	return t.status;
}

export function outdatedReason(anchor: ReviewAnchor | null | undefined): string {
	const kinds = new Set((anchor?.selectors ?? []).map((selector) => selector.kind));
	if (kinds.has("textQuote")) {
		return "The file changed or is gone, and this comment's text was not found again; it keeps its original snapshot.";
	}
	if (kinds.has("region") || kinds.has("structural") || kinds.has("lineRange")) {
		return "The file's bytes changed or it is gone; a position in an image, PDF or notebook cannot be re-verified, so the comment keeps its original snapshot.";
	}
	return "The file this comment was about is gone.";
}
