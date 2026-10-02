import type { GitDiffScope } from "@thinkrail/contracts";
import { supportsChangeMutations } from "@/transport";

export function scopeHasMutableModifiedSide(scope: GitDiffScope): boolean {
	return scope.kind === "branch" || scope.kind === "uncommitted" || scope.kind === "pinned";
}

export function canOfferChangeMutations(
	scope: GitDiffScope,
	protocolVersion: number | null,
	metadataReady: boolean,
): boolean {
	return (
		scopeHasMutableModifiedSide(scope) && supportsChangeMutations(protocolVersion) && metadataReady
	);
}
