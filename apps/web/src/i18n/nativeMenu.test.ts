import { afterEach, expect, test } from "bun:test";
import { applyLocale } from "@thinkrail/locales/react";
import { pushNativeMenuLabels } from "./nativeMenu";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "__THINKRAIL_NATIVE_MENU__");
	applyLocale("en", {});
});

test("pushes the active language's desktop menu and dialog labels when the native bridge exists", () => {
	const sent: Record<string, string>[] = [];
	Reflect.set(globalThis, "__THINKRAIL_NATIVE_MENU__", {
		setLabels: (labels: Record<string, string>) => sent.push(labels),
	});
	applyLocale("de", { de: { "desktop.menu.edit": "Bearbeiten" } });
	pushNativeMenuLabels();
	expect(sent[0]?.["desktop.menu.edit"]).toBe("Bearbeiten");
	expect(sent[0]?.["desktop.menu.window"]).toBe("Window");
	expect(sent[0]?.["desktop.dialog.startFailed"]).toBe("ThinkRail could not start");
});

test("is a no-op without the bridge", () => {
	expect(() => pushNativeMenuLabels()).not.toThrow();
});
