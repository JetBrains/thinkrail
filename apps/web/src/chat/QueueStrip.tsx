import type { SessionQueueState } from "@thinkrail/contracts";

export function QueueStrip({
	queue,
	onDequeue,
}: {
	queue: SessionQueueState;
	onDequeue: () => void;
}) {
	const occurrences = new Map<string, number>();
	const items = [
		...queue.steering.map((text) => ({ kind: "steering" as const, label: "Steering", text })),
		...queue.followUp.map((text) => ({ kind: "followUp" as const, label: "Follow-up", text })),
	].map((item) => {
		const base = `${item.kind}:${item.text}`;
		const seen = occurrences.get(base) ?? 0;
		occurrences.set(base, seen + 1);
		return { ...item, key: `${base}:${seen}` };
	});
	if (items.length === 0) return null;
	return (
		<button
			type="button"
			data-testid="queue-strip"
			aria-label="Edit queued messages"
			onClick={onDequeue}
			className="flex w-full shrink-0 flex-col gap-2xs border-border-default border-t bg-container-elevated-bg px-md py-xs text-left text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
		>
			{items.map((item) => (
				<span
					key={item.key}
					data-testid="queue-item"
					data-kind={item.kind}
					className="w-full truncate"
				>
					<span className="text-text-default">{item.label}:</span> {item.text}
				</span>
			))}
			<span className="w-full truncate opacity-70">↳ click to edit queued messages</span>
		</button>
	);
}
