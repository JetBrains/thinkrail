import type { ReviewAnchor } from "@thinkrail/contracts";
import type { ResourceIntent, ResourceRenderer } from "./types";

export function anchorLabel(anchor: ReviewAnchor): string {
	const line = anchor.selectors.find((selector) => selector.kind === "lineRange");
	if (line?.kind === "lineRange") {
		return line.startLine === line.endLine
			? `L${line.startLine}`
			: `L${line.startLine}–${line.endLine}`;
	}
	const structural = anchor.selectors.find((selector) => selector.kind === "structural");
	if (structural?.kind === "structural") return `${structural.scheme} ${structural.ref}`;
	if (anchor.selectors.some((selector) => selector.kind === "region")) return "region";
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
