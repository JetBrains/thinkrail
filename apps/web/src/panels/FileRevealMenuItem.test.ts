import { afterEach, expect, test } from "bun:test";
import { WORKSPACE_ITEM_REVEAL_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { selectCanRevealWorkspaceItem, useAppStore } from "../store";
import { revealWorkspaceItem } from "./FileRevealMenuItem";

const initial = useAppStore.getState();

afterEach(() => useAppStore.setState(initial, true));

test("reveal rechecks connectivity when a menu opened before disconnect", async () => {
	useAppStore.setState({
		status: "connected",
		protocolVersion: WORKSPACE_ITEM_REVEAL_PROTOCOL_VERSION,
		toasts: [],
	});
	expect(selectCanRevealWorkspaceItem(useAppStore.getState())).toBe(true);
	useAppStore.setState({ status: "disconnected" });
	await revealWorkspaceItem("workspace", "src/App.tsx");
	expect(useAppStore.getState().toasts).toEqual([]);
});

test("reveal never sends a path to an older host that would ignore it", async () => {
	useAppStore.setState({
		status: "connected",
		protocolVersion: WORKSPACE_ITEM_REVEAL_PROTOCOL_VERSION - 1,
		toasts: [],
	});
	await revealWorkspaceItem("workspace", "src/App.tsx");
	expect(useAppStore.getState().toasts).toEqual([]);
});
