import type { ReviewAnchor, ReviewCommentStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
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

const STATUS_KEYS = {
	draft: "review.status.draft",
	sent: "review.status.sent",
	resolved: "review.status.resolved",
	dismissed: "review.status.dismissed",
} satisfies Record<ReviewCommentStatus, MessageKey>;

export function threadLabel(
	t: Translator,
	thread: Pick<ReviewThread, "status" | "anchorState" | "stale">,
): string {
	const status = t(STATUS_KEYS[thread.status]);
	if (thread.stale) return t("review.thread.stale", { status });
	if (thread.anchorState === "outdated") return t("review.thread.outdated", { status });
	return status;
}

export function outdatedReason(t: Translator, anchor: ReviewAnchor | null | undefined): string {
	const kinds = new Set((anchor?.selectors ?? []).map((selector) => selector.kind));
	if (kinds.has("textQuote")) {
		return t("review.outdated.textQuote");
	}
	if (kinds.has("region") || kinds.has("structural") || kinds.has("lineRange")) {
		return t("review.outdated.region");
	}
	return t("review.outdated.gone");
}
