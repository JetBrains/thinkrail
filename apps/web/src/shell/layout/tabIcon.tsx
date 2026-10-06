import {
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
	RiTerminalBoxFill,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { ReactNode } from "react";
import { CustomIcon } from "../../components/CustomIcon";
import type { LayoutTab } from "./types";

export function tabIcon(tab: LayoutTab, active = false): ReactNode {
	const cls = "size-14 shrink-0";
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
				case "changes":
					return <CustomIcon name={active ? "file-diff-fill" : "file-diff-line"} className={cls} />;
				case "review":
					return active ? <RiDiscussFill className={cls} /> : <RiDiscussLine className={cls} />;
				default:
					return active ? <RiLayout2Fill className={cls} /> : <RiLayout2Line className={cls} />;
			}
	}
}
