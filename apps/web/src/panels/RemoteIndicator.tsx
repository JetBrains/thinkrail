import type { RemoteState } from "@thinkrail/contracts";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { remoteIndicatorView } from "./changesModel";

/**
 * The workspace `↓` behind-the-remote indicator — the **one** component both `ComparisonTarget` (in both
 * its live and inert shapes) and the project rail's workspace row render, fed by the **one** selector,
 * `store.selectWorkspaceRemoteState`, so the two sites can never disagree about what a workspace's
 * indicator shows. Renders nothing when there is nothing to say: `remoteState` is `null` (unknown
 * workspace/project/ref), or `remoteIndicatorView` (`changesModel.ts`) decides the pair is up to date and
 * being checked automatically.
 *
 * A click opens a `Popover` — never a hover `Tooltip` (this app is mobile-first, where hover doesn't
 * exist, and the popover has to host a clickable action) — with the plain-English explanation
 * `remoteIndicatorView` already composed, plus a manual **Fetch** (`git.fetchNow`) that works regardless of
 * *why* the automatic scheduler isn't checking this pair — the affordance that matters most for
 * `"never-authenticated"` / `"ssh-agent-present"`, the two dormancy reasons that mean "only a manual fetch
 * will ever check this."
 */
export function RemoteIndicator({
	remoteState,
	fetching,
	onFetch,
	testid,
}: {
	remoteState: RemoteState | null;
	fetching: boolean;
	onFetch: () => void;
	testid: string;
}) {
	const view = remoteState ? remoteIndicatorView(remoteState) : null;
	if (!remoteState || !view) return null;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={view.reason}
					className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] px-1 tr-text-metadata tabular-nums outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
					data-testid={testid}
					data-behind={String(remoteState.behind)}
					data-dormant={remoteState.dormant ?? ""}
				>
					{view.kind === "warning" ? (
						<TriangleAlert className="size-3.5 text-feedback-warning" />
					) : (
						<span className={view.muted ? "text-text-subtle" : "text-text-muted"}>{view.text}</span>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-64 flex-col gap-sm p-md">
				<p className="tr-text-metadata text-text-muted">{view.reason}</p>
				<div className="flex justify-end">
					<Button
						variant="outline"
						size="sm"
						data-testid={`${testid}-fetch`}
						disabled={fetching}
						onClick={onFetch}
					>
						<RefreshCw className={fetching ? "size-3.5 animate-spin" : "size-3.5"} />
						{fetching ? "Fetching…" : "Fetch"}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
