import type { TabAction, WorkbenchTabCommands } from "./layout";
import { activeWorkbenchGroupId } from "./regions";

let provider: WorkbenchTabCommands | null = null;

export function registerTabCommands(commands: WorkbenchTabCommands): () => void {
	provider = commands;
	return () => {
		if (provider === commands) provider = null;
	};
}

export function activeTabActions(): readonly TabAction[] {
	return provider?.list(activeWorkbenchGroupId()) ?? [];
}

export function runActiveTabAction(actionId: string): void {
	provider?.run(activeWorkbenchGroupId(), actionId);
}
