import { INITIAL_TERMINAL_TAB_KEY, type Workspace } from "@thinkrail/contracts";
import { logger } from "../log";
import { reserveTerminal } from "../terminal";
import { completeInitialTerminalReservation } from "../workspaces";

const log = logger("host");

export function provisionInitialTerminal(workspace: Workspace): Workspace {
	if (!workspace.initialTerminalPending) return workspace;
	try {
		reserveTerminal(workspace.id, INITIAL_TERMINAL_TAB_KEY, "Terminal 1");
		return completeInitialTerminalReservation(workspace.id);
	} catch {
		log.warn(`could not reserve the initial terminal for workspace ${workspace.id}`);
		return workspace;
	}
}
