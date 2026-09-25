import { cn, openSurface, remixicon, type SurfaceProps, startChat, ui } from "@thinkrail/ext/view";
import { useState } from "react";
import { useRailmap } from "./hooks";
import {
	DRIFT_KINDS,
	DRIFT_LABEL,
	type Drift,
	type DriftKind,
	driftCounts,
	fixPrompt,
} from "./model";
import { DriftLine, Empty, StatusChip } from "./parts";

const { RiSparkling2Line, RiNodeTree } = remixicon;
const SHOWN = 400;

const DriftItem = ({ item, root }: { item: Drift; root: string }) => (
	<li
		data-testid="railmap-drift-item"
		data-kind={item.kind}
		className="flex flex-col gap-8 border-b border-border-muted px-12 py-8"
	>
		<DriftLine item={item} />
		<div className="flex items-center gap-4">
			<ui.Button
				variant="outline"
				size="sm"
				data-testid="railmap-fix"
				onClick={() => void startChat(fixPrompt(item, root))}
			>
				<RiSparkling2Line className="size-14" /> Fix with agent
			</ui.Button>
			{item.from && (
				<ui.Button
					variant="ghost"
					size="sm"
					onClick={() => openSurface("railmap", "graph", { focus: item.from ?? "" })}
				>
					<RiNodeTree className="size-14" /> Show
				</ui.Button>
			)}
		</div>
	</li>
);

const DriftPanel = ({ host }: SurfaceProps) => {
	const channel = useRailmap(host);
	const [kind, setKind] = useState<DriftKind | null>(null);
	if (!host.workspaceId) return <Empty text="Open a workspace to check its specs." />;
	const graph = channel?.graph;
	const counts = driftCounts(graph?.drift ?? []);
	const items = (graph?.drift ?? []).filter((item) => kind === null || item.kind === kind);
	return (
		<div data-testid="railmap-drift" className="flex h-full flex-col bg-container-workspace-bg">
			<div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border-muted px-12 py-8">
				{DRIFT_KINDS.map((each) => (
					<button
						key={each}
						type="button"
						aria-pressed={kind === each}
						onClick={() => setKind(kind === each ? null : each)}
						className={cn(
							"rounded-sm px-8 py-2 tr-text-metadata",
							kind === each
								? "bg-primary-subtle text-text-default"
								: "text-text-muted hover:bg-control-bg-hovered",
						)}
					>
						{counts[each]} {DRIFT_LABEL[each].toLowerCase()}
					</button>
				))}
				<span className="ml-auto" />
				{channel && <StatusChip channel={channel} />}
			</div>
			{!graph ? (
				<Empty text="Reading SPEC.md files and imports…" />
			) : items.length === 0 ? (
				<Empty text="No drift: every import matches a spec." />
			) : (
				<ul className="min-h-0 flex-1 overflow-y-auto">
					{items.slice(0, SHOWN).map((item) => (
						<DriftItem key={item.key} item={item} root={graph.root} />
					))}
					{items.length > SHOWN && (
						<li className="px-12 py-8 tr-text-metadata text-text-muted">
							{items.length - SHOWN} more; filter by kind to see them.
						</li>
					)}
				</ul>
			)}
		</div>
	);
};

export default DriftPanel;
