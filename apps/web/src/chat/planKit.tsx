import { Check, Circle, CircleDot } from "lucide-react";

export function SectionLabel({ label }: { label: string }) {
	return <div className="px-xs py-xs tr-text-eyebrow text-text-muted">{label}</div>;
}

export function PlanStatusIcon({ kind }: { kind: "pending" | "active" | "done" }) {
	if (kind === "done") return <Check className="size-4 shrink-0 text-primary" />;
	if (kind === "active") return <CircleDot className="size-4 shrink-0 text-primary" />;
	return <Circle className="size-4 shrink-0 text-text-muted" />;
}
