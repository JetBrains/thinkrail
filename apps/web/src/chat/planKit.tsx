import {
	RiCheckLine as Check,
	RiCircleLine as Circle,
	RiErrorWarningLine as CircleAlert,
	RiRecordCircleLine as CircleDot,
	RiShieldCheckLine as ShieldCheck,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Markdown } from "./Markdown";
import { verificationStatus } from "./planView";

const VERIFICATION_PROSE = [
	"min-w-0 max-w-none break-words text-text-muted",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	"[&_p]:my-2 [&_strong]:text-text-default",
	"[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-16 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-16 [&_li]:my-2",
].join(" ");

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
		<span title={verification} className="inline-flex">
			<Icon
				data-testid="todo-verification-glyph"
				data-status={status}
				aria-label={verification}
				className={`size-14 shrink-0 ${
					status === "claimed" ? "text-feedback-success" : "text-feedback-warning"
				}`}
			/>
		</span>
	);
}

export function VerificationBadge({ verification }: { verification: string }) {
	const t = useT();
	const status = verificationStatus(verification);
	const Icon = status === "claimed" ? ShieldCheck : CircleAlert;
	return (
		<div
			data-testid="todo-verification"
			data-status={status}
			title={
				status === "claimed"
					? t("chat.plan.verificationClaimed")
					: t("chat.plan.verificationMissing")
			}
			className="flex min-w-0 items-start gap-4 tr-text-metadata"
		>
			<Icon
				className={`mt-2 size-14 shrink-0 ${
					status === "claimed" ? "text-feedback-success" : "text-feedback-warning"
				}`}
			/>
			<Markdown text={verification} className={`min-w-0 flex-1 ${VERIFICATION_PROSE}`} />
		</div>
	);
}
