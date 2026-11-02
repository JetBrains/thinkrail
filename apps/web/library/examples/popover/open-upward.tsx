import { RiArrowDownSLine } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { menuItemClass } from "@thinkrail/ui/menu-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";

const MODES: { name: MessageKey; meaning: MessageKey; keys: string }[] = [
	{ name: "chat.composer.mode.steer", meaning: "chat.composer.mode.steerMeaning", keys: "Enter" },
	{
		name: "chat.composer.mode.queue",
		meaning: "chat.composer.mode.queueMeaning",
		keys: "Cmd/Ctrl+Enter",
	},
	{
		name: "chat.composer.mode.interrupt",
		meaning: "chat.composer.mode.interruptMeaning",
		keys: "Cmd/Ctrl+Shift+Enter",
	},
];

export default function OpenUpward() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<IconButton
					variant="outline"
					icon={RiArrowDownSLine}
					label={t("chat.composer.sendOptions")}
					wrapTrigger
				/>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label={t("chat.composer.sendOptions")}
				className="flex w-320 flex-col gap-2 p-4"
			>
				{MODES.map((mode) => (
					<button
						key={mode.name}
						type="button"
						className={cn(menuItemClass, "w-full flex-col items-start gap-2")}
						onClick={() => setOpen(false)}
					>
						<span className="flex w-full items-baseline justify-between gap-8">
							<span>{t(mode.name)}</span>
							<span className="tr-text-metadata text-text-muted">{mode.keys}</span>
						</span>
						<span className="tr-text-metadata text-text-muted">{t(mode.meaning)}</span>
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
