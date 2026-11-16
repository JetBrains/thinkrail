import { afterEach, describe, expect, test } from "bun:test";
import { type ExtensionCommandSet, resolveKeybindings } from "../keybindings";
import {
	claimKeyboard,
	deliverExtensionCommand,
	extensionHotkey,
	keyboardClaimed,
	subscribeExtensionCommands,
} from "./extensionCommands";

type Modifiers = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;

const press = (code: string, modifiers: Modifiers = {}, ime = false) => ({
	code,
	key: "",
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	isComposing: ime,
	keyCode: ime ? 229 : 0,
	...modifiers,
});

const hint = (enabled: boolean): ExtensionCommandSet => ({
	extension: "hint-mode",
	enabled,
	commands: [
		{
			id: "hint-mode.show",
			title: "hintMode.shortcuts.show",
			chords: [
				{ code: "KeyF", key: "f" },
				{ code: "Semicolon", key: ";", mod: true },
			],
		},
	],
});

const SHOW = { extension: "hint-mode", id: "hint-mode.show" };

describe("extensionHotkey", () => {
	const keybindings = resolveKeybindings({ platform: "Linux x86_64", extensions: [hint(true)] });

	test("a plain chord rebound onto an element key leaves that key to the element it acts in", () => {
		const onS = resolveKeybindings({
			platform: "Linux x86_64",
			overrides: { "hint-mode.show": ["KeyS"] },
			extensions: [hint(true)],
		});
		expect(extensionHotkey(press("KeyS"), onS, false, "trees")).toBeNull();
		expect(extensionHotkey(press("KeyS"), onS, false, "transcript")).toEqual(SHOW);
		expect(extensionHotkey(press("KeyS"), onS, false, null)).toEqual(SHOW);
		expect(extensionHotkey(press("KeyF"), keybindings, false, "trees")).toEqual(SHOW);
		expect(
			extensionHotkey(press("Semicolon", { ctrlKey: true }), keybindings, false, "trees"),
		).toEqual(SHOW);
	});

	test("plain F starts outside text entry only; Mod+; anywhere", () => {
		expect(extensionHotkey(press("KeyF"), keybindings, false)).toEqual(SHOW);
		expect(extensionHotkey(press("KeyF"), keybindings, true)).toBeNull();
		expect(extensionHotkey(press("Semicolon", { ctrlKey: true }), keybindings, true)).toEqual(SHOW);
		expect(extensionHotkey(press("Semicolon", { ctrlKey: true }), keybindings, false)).toEqual(
			SHOW,
		);
	});

	test("modifiers are exact, IME composition never fires, and app chords are not extension ones", () => {
		expect(extensionHotkey(press("KeyF", { shiftKey: true }), keybindings, false)).toBeNull();
		expect(extensionHotkey(press("KeyF", { altKey: true }), keybindings, false)).toBeNull();
		expect(extensionHotkey(press("KeyF", {}, true), keybindings, false)).toBeNull();
		expect(
			extensionHotkey(press("Semicolon", { ctrlKey: true }, true), keybindings, false),
		).toBeNull();
		expect(extensionHotkey(press("KeyK", { ctrlKey: true }), keybindings, false)).toBeNull();
	});

	test("a switched-off extension's chords do nothing", () => {
		const off = resolveKeybindings({ platform: "Linux x86_64", extensions: [hint(false)] });
		expect(extensionHotkey(press("KeyF"), off, false)).toBeNull();
		expect(extensionHotkey(press("Semicolon", { ctrlKey: true }), off, false)).toBeNull();
	});

	test("follows a rebind of the extension command", () => {
		const rebound = resolveKeybindings({
			platform: "Linux x86_64",
			overrides: { "hint-mode.show": ["Mod+Alt+KeyH"] },
			extensions: [hint(true)],
		});
		expect(extensionHotkey(press("KeyH", { ctrlKey: true, altKey: true }), rebound, true)).toEqual(
			SHOW,
		);
		expect(extensionHotkey(press("KeyF"), rebound, false)).toBeNull();
		expect(extensionHotkey(press("Semicolon", { ctrlKey: true }), rebound, false)).toBeNull();
	});
});

describe("command delivery and the keyboard claim", () => {
	afterEach(() => {
		claimKeyboard("hint-mode", false);
		claimKeyboard("other", false);
	});

	test("a command reaches only its own extension's listeners until they unsubscribe", () => {
		const hintSeen: string[] = [];
		const otherSeen: string[] = [];
		const stopHint = subscribeExtensionCommands("hint-mode", (id) => hintSeen.push(id));
		const stopOther = subscribeExtensionCommands("other", (id) => otherSeen.push(id));
		deliverExtensionCommand("hint-mode", "hint-mode.show");
		stopHint();
		deliverExtensionCommand("hint-mode", "hint-mode.show");
		stopOther();
		expect(hintSeen).toEqual(["hint-mode.show"]);
		expect(otherSeen).toEqual([]);
	});

	test("the keyboard stays claimed while any extension holds a claim", () => {
		expect(keyboardClaimed()).toBe(false);
		claimKeyboard("hint-mode", true);
		claimKeyboard("other", true);
		claimKeyboard("hint-mode", false);
		expect(keyboardClaimed()).toBe(true);
		claimKeyboard("other", false);
		expect(keyboardClaimed()).toBe(false);
	});
});
