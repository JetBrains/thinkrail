import type { PanelHost } from "@thinkrail/extension-api/web";

/** Where an Overview card leads: a section of the session tab, or the list's Insights → What to do. */
export type OverviewLink =
	| { to: "trace"; mode?: "tree" | "turns" | "timeline"; events?: readonly string[] }
	| { to: "errors"; chain?: number }
	| { to: "cost" }
	| { to: "files"; path?: string }
	| { to: "subagents" }
	| { to: "findings" };

export interface OverviewViewProps {
	host: PanelHost;
	sessionId: string;
	onOpen: (link: OverviewLink) => void;
}

export function OverviewView(_props: OverviewViewProps) {
	return null;
}
