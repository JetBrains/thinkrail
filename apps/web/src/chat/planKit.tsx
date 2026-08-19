import { Check, Circle, CircleDot } from "lucide-react";

/**
 * The plan-list presentational atoms shared by every "work items in sections" surface — the chat's
 * TODO plan (`TodoList`) and the Review panel's per-file comment list — so the two read identically:
 * eyebrow section labels, and the pending / active / done status glyphs.
 */

/** A section's quiet eyebrow label ("To do", "Done", "In progress", "Drafts", "Resolved"). */
export function SectionLabel({ label }: { label: string }) {
	return <div className="px-4 py-4 tr-text-eyebrow text-text-muted">{label}</div>;
}

/** The base status glyphs: pending = open circle, active = primary dot, done = primary check.
 * (TodoList layers its glance-aware variants over `active` itself.) */
export function PlanStatusIcon({ kind }: { kind: "pending" | "active" | "done" }) {
	if (kind === "done") return <Check className="size-16 shrink-0 text-primary" />;
	if (kind === "active") return <CircleDot className="size-16 shrink-0 text-primary" />;
	return <Circle className="size-16 shrink-0 text-text-muted" />;
}
