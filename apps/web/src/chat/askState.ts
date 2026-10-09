import { createContext, useContext } from "react";
// The pure ask-state derivation lives in `lib` (like `userText`) so `store`'s edge to `chat/` stays
// type-only; this module keeps only the React context that the ask-card renderers consume.
import { type AskState, deriveAskStates, readAskResult } from "@/lib";

export { type AskState, deriveAskStates, readAskResult };

export interface AskContextValue {
	states: Record<string, AskState>;
	focusScope: object;
}

export const AskStatesContext = createContext<AskContextValue | null>(null);

export function useAskState(toolCallId: string): AskState | undefined {
	return useContext(AskStatesContext)?.states[toolCallId];
}

export function useAskFocusScope(): object | null {
	return useContext(AskStatesContext)?.focusScope ?? null;
}
