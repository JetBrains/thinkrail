import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { IconButton } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";

export function CodeBlock({
	code,
	title = "tsx",
	label = "Copy code",
}: {
	code: string;
	title?: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<div className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-border-default bg-container-content-bg">
			<div className="flex h-32 shrink-0 items-center justify-between border-border-default border-b bg-container-header-bg pr-4 pl-12">
				<span className="tr-text-metadata text-text-muted">{title}</span>
				<IconButton
					icon={copied ? RiCheckLine : RiFileCopyLine}
					label={copied ? "Copied" : label}
					data-testid="library-copy"
					onClick={() => {
						void navigator.clipboard?.writeText(code).then(() => setCopied(true));
					}}
				/>
			</div>
			<pre className="overflow-x-auto p-12 tr-code-text text-text-default [tab-size:2]">
				<code>{code}</code>
			</pre>
		</div>
	);
}

export function CopyText({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<IconButton
			size="s"
			icon={copied ? RiCheckLine : RiFileCopyLine}
			label={copied ? "Copied" : label}
			onClick={() => {
				void navigator.clipboard?.writeText(text).then(() => setCopied(true));
			}}
		/>
	);
}
