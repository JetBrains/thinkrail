import { Check, Copy, Globe, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

/** A copyable one-liner (command / auth URL): mono text that scrolls, pinned Copy button. */
export function CopyRow({
	text,
	prefix,
	testId,
}: {
	text: string;
	/** Optional shell-prompt glyph ("$") rendered before the text. */
	prefix?: string;
	testId?: string;
}) {
	const [copied, setCopied] = useState(false);
	const copy = () => {
		void navigator.clipboard?.writeText(text).catch(() => {});
		setCopied(true);
		setTimeout(() => setCopied(false), 1400);
	};
	return (
		<div
			data-testid={testId}
			className="flex min-w-0 items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-bg-dark px-md py-sm"
		>
			{prefix ? (
				<span className="shrink-0 font-[var(--font-mono)] text-primary text-sm">{prefix}</span>
			) : null}
			<span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-[var(--font-mono)] text-sm text-text [scrollbar-width:thin]">
				{text}
			</span>
			<button
				type="button"
				onClick={copy}
				aria-label="Copy"
				className={cn(
					"flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] border border-border2 px-sm py-xs text-xs transition-colors",
					copied ? "border-green text-green" : "text-muted hover:border-hint hover:text-text",
				)}
			>
				{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}

/** The "waiting for your browser" centerpiece: a pulsing globe + title + sub-line. */
export function WaitingPulse({ title, sub }: { title: string; sub?: ReactNode }) {
	return (
		<div className="flex flex-col items-center px-lg pt-xl pb-sm text-center">
			<div className="relative mb-lg grid size-14 place-items-center rounded-full border border-[var(--primary-40)] bg-[var(--primary-10)]">
				<span className="absolute inset-0 animate-ping rounded-full border border-[var(--primary-40)] opacity-40" />
				<Globe className="size-5 text-primary" />
			</div>
			<div className="font-semibold text-md text-text">{title}</div>
			{sub ? <div className="mt-xs max-w-[46ch] text-hint text-sm">{sub}</div> : null}
		</div>
	);
}

/** One row of the wizard's checklist: pending dot / spinner / green check / red cross + detail. */
export function StepRow({
	label,
	status,
	detail,
}: {
	label: string;
	status: "pending" | "start" | "ok" | "error";
	detail?: string | undefined;
}) {
	return (
		<div
			data-status={status}
			className={cn(
				"flex items-center gap-md px-xs py-sm text-sm transition-opacity",
				status === "pending" && "opacity-50",
			)}
		>
			<span className="grid size-5 shrink-0 place-items-center">
				{status === "start" ? (
					<Loader2 className="size-4 animate-spin text-primary" />
				) : status === "ok" ? (
					<Check className="size-4 text-green" />
				) : status === "error" ? (
					<span className="font-semibold text-red">✕</span>
				) : (
					<span className="text-hint">·</span>
				)}
			</span>
			<span className={cn("flex-1", status === "pending" ? "text-hint" : "text-text")}>
				{label}
			</span>
			{detail ? (
				<span className="max-w-[45%] truncate font-[var(--font-mono)] text-hint text-xs">
					{detail}
				</span>
			) : null}
		</div>
	);
}

/** The scrolling log tail under a wizard step (jbcentral output). */
export function LogTail({ lines }: { lines: string[] }) {
	if (lines.length === 0) return null;
	return (
		<pre className="mt-sm max-h-40 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-bg-dark p-md font-[var(--font-mono)] text-hint text-xs leading-relaxed [scrollbar-width:thin]">
			{lines.slice(-40).join("\n")}
		</pre>
	);
}
