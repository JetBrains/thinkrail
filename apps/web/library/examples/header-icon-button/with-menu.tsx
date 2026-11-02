import { RiArrowGoBackLine, RiExternalLinkLine, RiMoreLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

const path = "src/app.ts";

export default function WithMenu() {
	const t = useT();
	return (
		<div className="flex items-center gap-4">
			<HeaderIconButton
				testid="changes-section-revert"
				label={t("changes.section.revertFile")}
				onClick={() => {}}
				icon={RiArrowGoBackLine}
			/>
			<HeaderIconButton
				testid="changes-section-open-tab"
				label={t("changes.section.openOwnTab")}
				onClick={() => {}}
				icon={RiExternalLinkLine}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton
						icon={RiMoreLine}
						label={t("changes.section.actions", { path })}
						data-testid="changes-section-menu"
						wrapTrigger
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => {}}>
						<RiExternalLinkLine />
						{t("changes.section.openAsTab")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => {}}>
						<RiArrowGoBackLine />
						{t("changes.section.revertFile")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
