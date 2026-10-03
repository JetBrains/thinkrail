import { expect, test } from "bun:test";
import type { NativeCommand, NativeQuitHint } from "@thinkrail/contracts";
import { createShortcutsBridge } from "./shortcutsBridge";

test("every subscriber gets hints and commands until it unsubscribes", () => {
	const { bridge, emitQuitHint, emitCommand } = createShortcutsBridge(async () => {});
	const firstHints: NativeQuitHint[] = [];
	const secondHints: NativeQuitHint[] = [];
	const firstCommands: NativeCommand[] = [];
	const unsubscribeHint = bridge.subscribeQuitHint((hint) => firstHints.push(hint));
	bridge.subscribeQuitHint((hint) => secondHints.push(hint));
	const unsubscribeCommand = bridge.subscribeCommand((command) => firstCommands.push(command));

	emitQuitHint("armed");
	emitCommand("close-item");
	unsubscribeHint();
	unsubscribeCommand();
	emitQuitHint("hidden");
	emitCommand("close-item");

	expect(firstHints).toEqual(["armed"]);
	expect(secondHints).toEqual(["armed", "hidden"]);
	expect(firstCommands).toEqual(["close-item"]);
});

test("the bridge is frozen and quits through the injected function", async () => {
	let quits = 0;
	const { bridge } = createShortcutsBridge(async () => {
		quits += 1;
	});
	expect(Object.isFrozen(bridge)).toBe(true);
	await bridge.quit();
	expect(quits).toBe(1);
});
