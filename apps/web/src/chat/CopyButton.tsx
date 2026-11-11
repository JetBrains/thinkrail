import { RiCheckLine as Check, RiFileCopyLine as Copy } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib";

export function CopyButton({
	getText,
	label,
	className,
}: {
	getText: () => string;
	label?: string;
	className?: string | undefined;
}) {
	const t = useT();
	const accessibleLabel = label ?? t("chat.copyMessage");
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

	return (
		<IconButton
			size="s"
			icon={copied ? Check : Copy}
			data-testid="chat-copy"
			data-copied={copied || undefined}
			label={accessibleLabel}
			onClick={() => {
				void (async () => {
					if (!(await copyText(getText()))) return;
					setCopied(true);
					if (timer.current) clearTimeout(timer.current);
					timer.current = setTimeout(() => setCopied(false), 1200);
				})();
			}}
			className={cn(
				"shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[copied]:opacity-100",
				className,
			)}
		/>
	);
}
