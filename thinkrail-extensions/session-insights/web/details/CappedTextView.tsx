import { RiFileCopyLine, RiScissorsCutLine } from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import type { CappedText } from "@thinkrail/pi-session-insights/core";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { formatCount } from "../format";
import { Highlighted } from "./JsonViewer";

function Omitted({ chars, lines }: { chars: number; lines: number }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<span
			data-testid="capped-omitted"
			className="my-2 flex items-center gap-4 border-border-default border-y border-dashed py-2 tr-text-caption text-text-subtle"
		>
			<RiScissorsCutLine aria-hidden className="size-12 shrink-0" />
			{t("sessionInsights.details.omitted", {
				lines: t("sessionInsights.details.lines", {
					count: lines,
					n: formatCount(locale, lines),
				}),
				chars: t("sessionInsights.details.characters", {
					count: chars,
					n: formatCount(locale, chars),
				}),
			})}
		</span>
	);
}

/** Redacted text as recorded, with the cut the server made marked where it was and the original size. */
export function CappedTextView({
	value,
	label,
	query,
	tone = "default",
	prose = false,
	testId,
}: {
	value: CappedText;
	label: string;
	query: string;
	tone?: "default" | "error";
	prose?: boolean;
	testId?: string;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { text, cut } = value;
	const head = cut ? text.slice(0, cut.at) : text;
	const tail = cut ? text.slice(cut.at) : "";
	const toneClass = tone === "error" ? "text-feedback-error" : "text-text-default";
	const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
	const onCopy = () => {
		if (!navigator.clipboard) {
			setCopy("failed");
			return;
		}
		navigator.clipboard.writeText(text).then(
			() => setCopy("copied"),
			() => setCopy("failed"),
		);
	};
	return (
		<section
			data-testid={testId}
			aria-label={label}
			className={cn(
				"flex min-w-0 flex-col rounded-sm border",
				tone === "error"
					? "border-feedback-error-muted bg-feedback-error-subtle"
					: "border-border-default",
			)}
		>
			<div className="flex min-w-0 items-center gap-8 border-border-default border-b px-8 py-2">
				<span className="tr-text-eyebrow text-text-muted">{label}</span>
				<span className="tr-text-caption text-text-subtle tabular-nums">
					{t("sessionInsights.details.chars", {
						count: value.chars,
						n: formatCount(locale, value.chars),
					})}
				</span>
				<IconButton
					icon={RiFileCopyLine}
					size="s"
					className="ml-auto"
					label={t("sessionInsights.details.copyText")}
					onClick={onCopy}
				/>
			</div>
			<span
				role="status"
				className={copy === "failed" ? "px-8 pt-4 tr-text-caption text-feedback-error" : "sr-only"}
			>
				{copy === "failed"
					? t("sessionInsights.json.copyFailed")
					: copy === "copied"
						? t("sessionInsights.json.copiedValue")
						: null}
			</span>
			{cut ? (
				<p data-testid="capped-notice" className="px-8 pt-4 tr-text-caption text-text-subtle">
					{t("sessionInsights.details.cutNotice", {
						shown: formatCount(locale, text.length),
						chars: formatCount(locale, value.chars),
					})}
				</p>
			) : null}
			<div className="max-h-480 overflow-auto px-8 py-4">
				{prose ? (
					<div className={cn("whitespace-pre-wrap break-words tr-text-ui", toneClass)}>
						<Highlighted text={head} query={query} />
					</div>
				) : (
					<pre className={cn("whitespace-pre-wrap break-words tr-code-text-small", toneClass)}>
						<Highlighted text={head} query={query} />
					</pre>
				)}
				{cut ? <Omitted chars={cut.chars} lines={cut.lines} /> : null}
				{tail ? (
					<pre className={cn("whitespace-pre-wrap break-words tr-code-text-small", toneClass)}>
						<Highlighted text={tail} query={query} />
					</pre>
				) : null}
			</div>
		</section>
	);
}
