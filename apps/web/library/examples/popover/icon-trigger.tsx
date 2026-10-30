import { RiArrowGoBackLine, RiHistoryLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { menuItemClass } from "@thinkrail/ui/menu-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import { useId, useState } from "react";

const CLOSED_CHATS = [
	"Fix flaky e2e login test",
	"Refactor popover docs",
	"Explain the build cache",
];

export default function IconTrigger() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const headingId = useId();
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<IconButton
					icon={RiHistoryLine}
					label={t("shell.chatHistory.reopen")}
					tooltip={t("shell.chatHistory.view")}
					wrapTrigger
				/>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				aria-labelledby={headingId}
				className="max-h-[min(60vh,var(--radix-popover-content-available-height))] min-w-[16rem] overflow-y-auto p-4"
			>
				<div id={headingId} className="px-8 py-4 tr-text-eyebrow text-text-muted">
					{t("shell.chatHistory.recentlyClosed")}
				</div>
				{CLOSED_CHATS.map((title) => (
					<button
						key={title}
						type="button"
						className={cn(menuItemClass, "w-full")}
						onClick={() => setOpen(false)}
					>
						<span className="flex-1 truncate text-left">{title}</span>
						<RiArrowGoBackLine aria-hidden />
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
