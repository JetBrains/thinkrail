import { cn } from "@thinkrail/ext/view";
import { DRIFT_LABEL, type Drift, type RailmapChannel } from "./model";

export const Empty = ({ text }: { text: string }) => (
	<div
		data-testid="railmap-empty"
		className="flex h-full flex-1 items-center justify-center p-24 text-center tr-text-ui text-text-muted"
	>
		{text}
	</div>
);

export const StatusChip = ({ channel }: { channel: RailmapChannel }) => {
	const { status } = channel;
	const text =
		status.state === "building"
			? `building ${status.done}/${status.total || "…"}${channel.stale ? " · showing last graph" : ""}`
			: status.state === "error"
				? "error"
				: `${channel.graph?.modules.length ?? 0} modules · ${channel.graph?.files ?? 0} files`;
	return (
		<span
			data-testid="railmap-status"
			data-state={status.state}
			className={cn(
				"shrink-0 whitespace-nowrap rounded-sm px-8 py-2 tr-text-metadata",
				status.state === "building" && "bg-feedback-info-subtle text-feedback-info",
				status.state === "error" && "bg-feedback-error-subtle text-feedback-error",
				status.state === "ready" && "bg-control-bg text-text-muted",
			)}
		>
			{text}
		</span>
	);
};

export const DriftLine = ({ item }: { item: Drift }) => (
	<div className="flex min-w-0 flex-col gap-2">
		<span className="tr-text-metadata text-feedback-error">{DRIFT_LABEL[item.kind]}</span>
		<span className="break-all tr-text-ui text-text-default">{item.detail}</span>
	</div>
);
