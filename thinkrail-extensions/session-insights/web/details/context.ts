import { createContext, useContext } from "react";
import type { DetailTab } from "./tabs";

/** `stale`: a later pick asked for another event first. */
export type ShowOutcome = "shown" | "notInChat" | "failed" | "stale";

/** What the call details of one session view share: the last picked tab, and in a chat pane the chat beside it. */
export interface DetailsHost {
	tab: DetailTab | null;
	onTab: (tab: DetailTab) => void;
	/** In a chat pane: reveals the event's message in the chat beside the pane (`null` in a tab). */
	showInChat: ((eventId: string) => Promise<ShowOutcome>) | null;
	/** The event whose message the chat beside the pane shows. */
	shown: string | null;
}

export const DetailsContext = createContext<DetailsHost | null>(null);

export function useDetailsHost(): DetailsHost | null {
	return useContext(DetailsContext);
}
