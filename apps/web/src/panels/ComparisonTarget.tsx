import type { BranchList, GitDiffScope, RemoteState } from "@thinkrail/contracts";
import { BranchPicker } from "./BranchPicker";
import { comparisonTargetLabel } from "./changesModel";
import { RemoteIndicator } from "./RemoteIndicator";

/**
 * The Changes header's **comparison target** — what the current scope is diffed *against*. A live
 * `BranchPicker` for the branch scope (whose target is re-pointable per workspace) and inert text
 * otherwise, because the other three scopes' opposite side is a fact, not a choice. Deliberately not a
 * disabled button: a disabled control still advertises "there is something to pick here".
 *
 * Both renderings occupy the same 24px-high slot with the same `vs` prefix, so switching scope never
 * reflows the toolbar. Both also carry the `↓` behind-the-remote indicator as a trailing sibling — it
 * needs no scope of its own (it tracks the workspace's resolved diff base, not the active scope), so it
 * sits beside the picker/text rather than inside either branch's conditional.
 */
export function ComparisonTarget({
	scope,
	baseRef,
	branches,
	refreshing,
	onSelect,
	onRefresh,
	remoteState,
	fetching,
	onFetch,
}: {
	scope: GitDiffScope;
	baseRef: string;
	branches: BranchList | null;
	refreshing: boolean;
	onSelect: (ref: string) => void;
	onRefresh: () => void;
	remoteState: RemoteState | null;
	fetching: boolean;
	onFetch: () => void;
}) {
	const { label, interactive } = comparisonTargetLabel(scope, baseRef);
	const indicator = (
		<RemoteIndicator
			remoteState={remoteState}
			fetching={fetching}
			onFetch={onFetch}
			testid="changes-target-remote"
		/>
	);

	if (interactive) {
		return (
			<>
				<BranchPicker
					branches={branches}
					selected={baseRef}
					refreshing={refreshing}
					label="vs"
					testid="changes-target-picker"
					triggerClassName="flex h-6 min-w-0 max-w-[200px] items-center gap-xs rounded-[var(--radius-sm)] px-xs outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-hovered"
					onSelect={onSelect}
					onRefresh={onRefresh}
				/>
				{indicator}
			</>
		);
	}

	return (
		<>
			<span
				data-testid="changes-target-static"
				data-scope={scope.kind}
				title={`This scope is diffed against ${label}`}
				className="flex h-6 min-w-0 max-w-[200px] items-center gap-xs px-xs tr-text-metadata text-text-subtle"
			>
				{/* A literal space, not just the flex `gap`: the CSS gap alone doesn't reach `textContent`, and
				    "vs" + label would otherwise run together as one word (e.g. "vs— (parent)"). */}
				<span className="shrink-0">vs</span> <span className="truncate">{label}</span>
			</span>
			{indicator}
		</>
	);
}
