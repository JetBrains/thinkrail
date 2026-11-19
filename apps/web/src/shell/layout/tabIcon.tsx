import {
	RiApps2Fill,
	RiApps2Line,
	RiBookOpenFill,
	RiBookOpenLine,
	RiChat2Fill,
	RiChat2Line,
	RiDiscussFill,
	RiDiscussLine,
	RiFileFill,
	RiFileLine,
	RiFolder2Fill,
	RiFolder2Line,
	RiGitPullRequestFill,
	RiGitPullRequestLine,
	RiLayout2Fill,
	RiLayout2Line,
	RiListCheck3,
	RiShapesFill,
	RiShapesLine,
	RiSparkling2Fill,
	RiSparkling2Line,
	RiTaskFill,
	RiTaskLine,
	RiTerminalBoxFill,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { ReactNode } from "react";
import { CustomIcon } from "../../components/CustomIcon";
import type { LayoutTab, LayoutToolCatalog } from "./types";

const NO_TOOLS: LayoutToolCatalog = {};

export function tabIcon(
	tab: LayoutTab,
	active = false,
	cls = "size-14 shrink-0",
	tools: LayoutToolCatalog = NO_TOOLS,
): ReactNode {
	switch (tab.kind) {
		case "file":
			return active ? <RiFileFill className={cls} /> : <RiFileLine className={cls} />;
		case "diff":
			return active ? (
				<RiGitPullRequestFill className={cls} />
			) : (
				<RiGitPullRequestLine className={cls} />
			);
		case "changes":
			return <CustomIcon name={active ? "file-diff-fill" : "file-diff-line"} className={cls} />;
		case "chat":
			return active ? <RiChat2Fill className={cls} /> : <RiChat2Line className={cls} />;
		case "document":
			return <RiListCheck3 className={cls} />;
		case "extension":
			return active ? <RiApps2Fill className={cls} /> : <RiApps2Line className={cls} />;
		case "terminal":
			return active ? <RiTerminalBoxFill className={cls} /> : <RiTerminalBoxLine className={cls} />;
		case "tool":
			switch (tab.tool) {
				case "projects":
					return active ? <RiFolder2Fill className={cls} /> : <RiFolder2Line className={cls} />;
				case "specs":
					return active ? <RiBookOpenFill className={cls} /> : <RiBookOpenLine className={cls} />;
				case "files":
					return active ? <RiFileFill className={cls} /> : <RiFileLine className={cls} />;
				case "review":
					return active ? <RiDiscussFill className={cls} /> : <RiDiscussLine className={cls} />;
				case "plan":
					return active ? <RiTaskFill className={cls} /> : <RiTaskLine className={cls} />;
				case "artifacts":
					return active ? <RiShapesFill className={cls} /> : <RiShapesLine className={cls} />;
				case "orchestrator":
					return active ? (
						<RiSparkling2Fill className={cls} />
					) : (
						<RiSparkling2Line className={cls} />
					);
				default: {
					const Icon = tools[tab.tool]?.icon;
					if (Icon) return <Icon className={cls} />;
					return active ? <RiLayout2Fill className={cls} /> : <RiLayout2Line className={cls} />;
				}
			}
	}
}
