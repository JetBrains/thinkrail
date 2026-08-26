import {
	RiCheckLine as Check,
	RiCircleLine as Circle,
	RiRecordCircleLine as CircleDot,
} from "@remixicon/react";

export function SectionLabel({ label }: { label: string }) {
	return <div className="px-4 py-4 tr-text-eyebrow text-text-muted">{label}</div>;
}

export function PlanStatusIcon({ kind }: { kind: "pending" | "active" | "done" }) {
	if (kind === "done") return <Check className="size-12 shrink-0 text-primary" />;
	if (kind === "active") return <CircleDot className="size-12 shrink-0 text-primary" />;
	return <Circle className="size-12 shrink-0 text-text-muted" />;
}
