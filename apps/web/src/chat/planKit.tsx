import { Check, Circle, CircleAlert, CircleDot, ShieldCheck } from "lucide-react";
import { verificationStatus } from "./planView";

/**
 * The plan-list presentational atoms shared by every "work items in sections" surface — the chat's
 * TODO plan (`TodoList`) and the Review panel's per-file comment list — so the two read identically:
 * eyebrow section labels, and the pending / active / done status glyphs.
 */

/** A section's quiet eyebrow label ("To do", "Done", "In progress", "Drafts", "Resolved"). */
export function SectionLabel({ label }: { label: string }) {
	return <div className="px-xs py-xs tr-text-eyebrow text-text-muted">{label}</div>;
}

/** The base status glyphs: pending = open circle, active = primary dot, done = primary check.
 * (TodoList layers its glance-aware variants over `active` itself.) */
export function PlanStatusIcon({ kind }: { kind: "pending" | "active" | "done" }) {
	if (kind === "done") return <Check className="size-4 shrink-0 text-primary" />;
	if (kind === "active") return <CircleDot className="size-4 shrink-0 text-primary" />;
	return <Circle className="size-4 shrink-0 text-text-muted" />;
}

/**
 * The agent's self-reported verification line as a status badge — the "Tests ✓" element, shared by
 * the plan popup, the plan page, and the review card so verification reads identically everywhere.
 * Check glyph = a named check (verified **as claimed** — the title says so; this is never a host-run
 * gate), warning glyph = the agent's honest "not verified". Absence of the field is the caller's case.
 */
export function VerificationBadge({ verification }: { verification: string }) {
	const status = verificationStatus(verification);
	const Icon = status === "claimed" ? ShieldCheck : CircleAlert;
	return (
		<span
			data-testid="todo-verification"
			data-status={status}
			title={
				status === "claimed"
					? "Verification as reported by the agent — not re-run by the host"
					: "The agent reports this step was not verified"
			}
			className={`inline-flex min-w-0 items-center gap-xs tr-text-metadata ${
				status === "claimed" ? "text-feedback-success" : "text-feedback-warning"
			}`}
		>
			<Icon className="size-3.5 shrink-0" />
			<span className="truncate">{verification}</span>
		</span>
	);
}
