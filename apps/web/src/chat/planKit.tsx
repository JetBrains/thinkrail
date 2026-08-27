import {
	RiCheckLine as Check,
	RiCircleLine as Circle,
	RiErrorWarningLine as CircleAlert,
	RiRecordCircleLine as CircleDot,
	RiShieldCheckLine as ShieldCheck,
} from "@remixicon/react";
import { verificationStatus } from "./planView";

export function SectionLabel({ label }: { label: string }) {
	return <div className="px-4 py-4 tr-text-eyebrow text-text-muted">{label}</div>;
}

export function PlanStatusIcon({ kind }: { kind: "pending" | "active" | "done" }) {
	if (kind === "done") return <Check className="size-12 shrink-0 text-primary" />;
	if (kind === "active") return <CircleDot className="size-12 shrink-0 text-primary" />;
	return <Circle className="size-12 shrink-0 text-text-muted" />;
}

export function VerificationGlyph({ verification }: { verification: string }) {
	const status = verificationStatus(verification);
	const Icon = status === "claimed" ? ShieldCheck : CircleAlert;
	return (
		<Icon
			data-testid="todo-verification-glyph"
			data-status={status}
			aria-label={verification}
			className={`size-14 shrink-0 ${
				status === "claimed" ? "text-feedback-success" : "text-feedback-warning"
			}`}
		/>
	);
}

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
			className={`inline-flex min-w-0 items-center gap-4 tr-text-metadata ${
				status === "claimed" ? "text-feedback-success" : "text-feedback-warning"
			}`}
		>
			<Icon className="size-14 shrink-0" />
			<span className="truncate">{verification}</span>
		</span>
	);
}
