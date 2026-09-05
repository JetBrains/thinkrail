import {
	RiErrorWarningLine as CircleAlert,
	RiRecordCircleLine as CircleDot,
	RiQuestionnaireLine as MessageCircleQuestion,
	RiTimeLine as Timer,
} from "@remixicon/react";
import type { ActivityStatus } from "@thinkrail/contracts";
import { IconTooltip } from "@/components/ui/tooltip";

const PRESENTATION: Record<
	ActivityStatus,
	{ Icon: typeof CircleDot; label: string; plural: string; className: string }
> = {
	failed: {
		Icon: CircleAlert,
		label: "Last run failed",
		plural: "failed",
		className: "text-feedback-error",
	},
	waiting: {
		Icon: MessageCircleQuestion,
		label: "Waiting for your answer",
		plural: "waiting for your answer",
		className: "text-feedback-warning",
	},
	running: {
		Icon: CircleDot,
		label: "Agent is working",
		plural: "working",
		className: "text-feedback-info",
	},
	queued: {
		Icon: Timer,
		label: "Message queued",
		plural: "queued",
		className: "text-text-subtle",
	},
};

const BREAKDOWN_ORDER: readonly ActivityStatus[] = ["failed", "waiting", "running", "queued"];

export function activityChatCount(counts: Partial<Record<ActivityStatus, number>>): number {
	return BREAKDOWN_ORDER.reduce((total, status) => total + (counts[status] ?? 0), 0);
}

export function activityBreakdown(counts: Partial<Record<ActivityStatus, number>>): string[] {
	return BREAKDOWN_ORDER.flatMap((status) => {
		const count = counts[status] ?? 0;
		if (count === 0) return [];
		return [`${count} ${count === 1 ? "chat" : "chats"} ${PRESENTATION[status].plural}`];
	});
}

export function ActivityGlyph({
	status,
	counts,
}: {
	status: ActivityStatus;
	counts?: Partial<Record<ActivityStatus, number>>;
}) {
	const { Icon, label, className } = PRESENTATION[status];
	const lines = counts ? activityBreakdown(counts) : [];
	const detailed = counts !== undefined && activityChatCount(counts) > 1;
	return (
		<IconTooltip
			wrapTrigger
			label={
				detailed ? (
					<span className="flex flex-col gap-2">
						{lines.map((line) => (
							<span key={line}>{line}</span>
						))}
					</span>
				) : (
					label
				)
			}
		>
			<span
				data-testid="activity-glyph"
				role="img"
				aria-label={detailed ? lines.join(", ") : label}
				className="flex size-20 shrink-0 items-center justify-center"
			>
				<Icon className={`size-14 ${className}`} />
			</span>
		</IconTooltip>
	);
}
