import { expect, test } from "bun:test";
import type { WorkbenchTabCommands } from "./layout";
import { activeTabActions, registerTabCommands, runActiveTabAction } from "./workbenchCommands";

function recorder(runs: string[]): WorkbenchTabCommands {
	return { list: () => [], run: (_groupId, actionId) => runs.push(actionId) };
}

test("tab commands reach only the mounted workbench", () => {
	const runs: string[] = [];
	runActiveTabAction("tab.close");
	expect(activeTabActions()).toEqual([]);
	const first = recorder(runs);
	const unregisterFirst = registerTabCommands(first);
	const unregisterSecond = registerTabCommands(recorder(runs));
	unregisterFirst();
	runActiveTabAction("group.splitRight");
	unregisterSecond();
	runActiveTabAction("tab.close");
	expect(runs).toEqual(["group.splitRight"]);
});
