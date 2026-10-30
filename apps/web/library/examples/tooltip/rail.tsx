import { RiFolderLine, RiListCheck3, RiTerminalBoxLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function Rail() {
	const t = useT();
	const group = t("workbench.rail.terminalGroup", { position: 1, count: 2 });
	return (
		<div className="flex items-center gap-24">
			<IconButton icon={RiFolderLine} label={t("workbench.rail.leftTools")} tooltipSide="right" />
			<IconButton
				icon={RiTerminalBoxLine}
				label={group}
				tooltip={
					<span>
						{group}
						<br />
						zsh, bun run dev
					</span>
				}
				tooltipSide="top"
			/>
			<IconButton icon={RiListCheck3} label={t("workbench.rail.rightTools")} tooltipSide="left" />
		</div>
	);
}
