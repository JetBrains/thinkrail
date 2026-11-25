import { afterEach, expect, test } from "bun:test";
import { TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { createTerminalCopyOnSelect } from "./terminalCopyOnSelect";

const disposers: (() => void)[] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

function fixture() {
	const state = {
		terminalCopyOnSelect: true,
		protocolVersion: TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION as number | null,
		selection: "",
	};
	const copied: string[] = [];
	const selectionCopy = createTerminalCopyOnSelect({
		getSelection: () => state.selection,
		getConfig: () => state,
		copy: async (text) => {
			copied.push(text);
		},
	});
	disposers.push(selectionCopy.dispose);
	const select = (text: string) => {
		state.selection = text;
		selectionCopy.selectionChanged();
	};
	return { state, copied, selectionCopy, select };
}

test("copy on select is inert when off or connected to an old or unnegotiated host", async () => {
	const examples = [
		{ terminalCopyOnSelect: false, protocolVersion: TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION },
		{ terminalCopyOnSelect: true, protocolVersion: TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION - 1 },
		{ terminalCopyOnSelect: true, protocolVersion: null },
	].map((config) => {
		const example = fixture();
		Object.assign(example.state, config);
		example.select("keep the clipboard");
		return example;
	});
	await settle();
	for (const example of examples) expect(example.copied).toEqual([]);
});

test("rapid selection changes coalesce into one write of the latest text", async () => {
	const { select, copied } = fixture();
	for (const text of ["a", "ab", "abc", "the whole line"]) select(text);
	expect(copied).toEqual([]);
	await settle();
	expect(copied).toEqual(["the whole line"]);
	await settle();
	expect(copied).toEqual(["the whole line"]);
});

test("pausing a drag never copies before mouseup, and the release copies the final selection", async () => {
	const { select, copied, selectionCopy } = fixture();
	selectionCopy.startSelection();
	select("partial");
	await settle();
	expect(copied).toEqual([]);
	select("the completed drag");
	selectionCopy.endSelection();
	expect(copied).toEqual([]);
	await settle();
	expect(copied).toEqual(["the completed drag"]);
});

test("a cleared selection never replaces the clipboard with empty text", async () => {
	const { select, copied, state } = fixture();
	select("cleared through xterm's event");
	select("");
	await settle();
	expect(copied).toEqual([]);
	select("cleared before the callback");
	state.selection = "";
	await settle();
	expect(copied).toEqual([]);
});

test("turning off cancels queued work; turning on does not copy an existing selection", async () => {
	const { select, copied, selectionCopy, state } = fixture();
	select("old selection");
	state.terminalCopyOnSelect = false;
	selectionCopy.settingsChanged();
	state.terminalCopyOnSelect = true;
	selectionCopy.settingsChanged();
	await settle();
	expect(copied).toEqual([]);
	select("new selection");
	await settle();
	expect(copied).toEqual(["new selection"]);
});

test("settings changes during a held drag keep its mouseup boundary", async () => {
	const { select, copied, selectionCopy, state } = fixture();
	selectionCopy.startSelection();
	select("before switching off");
	state.terminalCopyOnSelect = false;
	selectionCopy.settingsChanged();
	state.terminalCopyOnSelect = true;
	selectionCopy.settingsChanged();
	select("after switching on");
	await settle();
	expect(copied).toEqual([]);
	selectionCopy.endSelection();
	await settle();
	expect(copied).toEqual(["after switching on"]);
});

test("the callback rechecks the current host capability and preference", async () => {
	const disabled = fixture();
	const downgraded = fixture();
	disabled.select("pending when switched off");
	downgraded.select("pending when downgraded");
	disabled.state.terminalCopyOnSelect = false;
	downgraded.state.protocolVersion = TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION - 1;
	await settle();
	expect(disabled.copied).toEqual([]);
	expect(downgraded.copied).toEqual([]);
});

test("focus loss and disposal cancel a pending write", async () => {
	const blurred = fixture();
	const disposed = fixture();
	blurred.select("before blur");
	disposed.select("before disposal");
	blurred.selectionCopy.cancel();
	disposed.selectionCopy.dispose();
	await settle();
	expect(blurred.copied).toEqual([]);
	expect(disposed.copied).toEqual([]);
	blurred.selectionCopy.startSelection();
	blurred.select("a new gesture after focus returns");
	blurred.selectionCopy.endSelection();
	await settle();
	expect(blurred.copied).toEqual(["a new gesture after focus returns"]);
});

test("mouse gestures without a selection change do not copy an old selection", async () => {
	const { state, copied, selectionCopy } = fixture();
	state.selection = "unchanged";
	selectionCopy.startSelection();
	selectionCopy.endSelection();
	await settle();
	expect(copied).toEqual([]);
});
