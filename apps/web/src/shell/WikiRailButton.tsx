import { RiShareCircleFill, RiShareCircleLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { useWikiPageState } from "../panels/wikiPageState";
import { AuxiliaryRailActionButton, type AuxiliaryRailControlProps } from "./layout";

export function WikiRailButton({
	workspaceId,
	control,
}: {
	workspaceId: string;
	control: AuxiliaryRailControlProps;
}) {
	const t = useT();
	const open = useWikiPageState((state) => state.openFor === workspaceId);
	return (
		<AuxiliaryRailActionButton
			region="right"
			icon={open ? RiShareCircleFill : RiShareCircleLine}
			label={t("shell.topbar.wiki")}
			testId="open-wiki-rail"
			active={open}
			control={control}
			onClick={() => useWikiPageState.getState().toggle(workspaceId)}
		/>
	);
}
