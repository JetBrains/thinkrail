import { expect, test } from "bun:test";
import { shortcutSurfaceOf } from "./shortcutSurface";

const inside = (...ancestors: string[]) => ({
	closest: (selector: string) =>
		selector.split(", ").some((part) => ancestors.includes(part)) ? ({} as Element) : null,
});

test("the focused element names the surface the cheatsheet lists first", () => {
	expect(shortcutSurfaceOf(inside('[role="tree"]'))).toBe("trees");
	expect(shortcutSurfaceOf(inside('[role="tab"]'))).toBe("tabs");
	expect(shortcutSurfaceOf(inside('[role="tablist"]'))).toBe("tabs");
	expect(shortcutSurfaceOf(inside('[data-testid="changes-review"]'))).toBe("review");
	expect(shortcutSurfaceOf(inside('[data-testid="chat-composer"]'))).toBe("composer");
	expect(shortcutSurfaceOf(inside(".xterm"))).toBe("terminal");
	expect(shortcutSurfaceOf(inside("[data-rail-entry]"))).toBe("panels");
	expect(shortcutSurfaceOf(inside("[data-rail-action]"))).toBeNull();
	expect(shortcutSurfaceOf(inside())).toBeNull();
	expect(shortcutSurfaceOf(null)).toBeNull();
});

test("a feature surface outranks a generic tree or tab role around it", () => {
	expect(shortcutSurfaceOf(inside('[role="tree"]', '[data-testid="changes-review"]'))).toBe(
		"review",
	);
	expect(shortcutSurfaceOf(inside(".xterm", '[role="tabpanel"]'))).toBe("terminal");
});
