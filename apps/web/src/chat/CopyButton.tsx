import { RiCheckLine as Check, RiFileCopyLine as Copy } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { cn, copyText } from "@/lib";

export function CopyButton({
	getText,
	label = "Copy message",
	className,
}: {
	getText: () => string;
	label?: string;
	className?: string | undefined;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

	return (
		<button
			type="button"
			data-testid="chat-copy"
			data-copied={copied || undefined}
			aria-label={label}
			title={label}
			onClick={() => {
				void (async () => {
					if (!(await copyText(getText()))) return;
					setCopied(true);
					if (timer.current) clearTimeout(timer.current);
					timer.current = setTimeout(() => setCopied(false), 1200);
				})();
			}}
			className={cn(
				"flex size-24 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-0 transition hover:bg-control-bg-hovered hover:text-text-default focus-visible:opacity-100 group-hover:opacity-100 data-[copied]:opacity-100",
				className,
			)}
		>
			{copied ? <Check className="size-14" /> : <Copy className="size-14" />}
		</button>
	);
}
