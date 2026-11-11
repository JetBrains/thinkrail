import {
	type RemixiconComponentType,
	RiChat3Fill,
	RiChat3Line,
	RiComputerFill,
	RiComputerLine,
	RiSettings3Fill,
	RiSettings3Line,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { Tab } from "./navigation";

const TAB_ICONS: Record<Tab, { line: RemixiconComponentType; fill: RemixiconComponentType }> = {
	computers: { line: RiComputerLine, fill: RiComputerFill },
	chats: { line: RiChat3Line, fill: RiChat3Fill },
	settings: { line: RiSettings3Line, fill: RiSettings3Fill },
};

const TAB_LABEL = {
	computers: "mobile.devices.title",
	chats: "mobile.chats.title",
	settings: "settings.dialog.title",
} as const satisfies Record<Tab, string>;

export const tabLabelKey = (tab: Tab) => TAB_LABEL[tab];

/** The bottom tab bar: Devices, Sessions (badged with the sessions waiting on you), Settings. */
export function TabBar({
	tabs,
	active,
	badge,
	onSelect,
}: {
	tabs: readonly Tab[];
	active: Tab;
	badge: number;
	onSelect: (tab: Tab) => void;
}) {
	const t = useT();
	return (
		<nav
			data-testid="tab-bar"
			className="flex shrink-0 border-t border-border-default bg-container-header-bg pb-safe-bottom"
		>
			{tabs.map((tab) => {
				const selected = tab === active;
				const Icon = selected ? TAB_ICONS[tab].fill : TAB_ICONS[tab].line;
				return (
					<button
						key={tab}
						type="button"
						data-testid={`tab-${tab}`}
						aria-current={selected ? "page" : undefined}
						onClick={() => onSelect(tab)}
						className={cn(
							"flex min-h-touch flex-1 flex-col items-center justify-center gap-2 border-0 bg-transparent pt-8 pb-4",
							selected ? "text-primary" : "text-text-muted",
						)}
					>
						<span className="relative">
							<Icon aria-hidden className="size-22" />
							{tab === "chats" && badge > 0 ? (
								<span
									data-testid="tab-badge"
									className="absolute -top-4 -right-12 flex min-w-16 items-center justify-center rounded-full bg-feedback-error px-4 text-text-on-primary tr-text-metadata"
								>
									{badge}
								</span>
							) : null}
						</span>
						<span className="tr-text-metadata">{t(TAB_LABEL[tab])}</span>
					</button>
				);
			})}
		</nav>
	);
}
