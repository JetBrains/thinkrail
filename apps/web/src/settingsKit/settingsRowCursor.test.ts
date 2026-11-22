import { expect, test } from "bun:test";
import { h, row } from "./settingsFakeDom.test";
import { createSettingsRowCursor } from "./settingsRowCursor";

function section() {
	const rows = ["theme", "font", "width"].map((id) => row(id));
	h("div", { "data-settings-content": "" }, ...rows);
	const [theme, font, width] = rows;
	if (!theme || !font || !width) throw new Error("fake DOM: rows are missing");
	return { theme, font, width };
}

test("with no row remembered, or the remembered one not rendered, the first rendered row holds the stop", () => {
	const { theme, font, width } = section();
	const cursor = createSettingsRowCursor();
	cursor.mount("width", width);
	expect(cursor.active()).toBe("width");
	cursor.mount("font", font);
	const unmountTheme = cursor.mount("theme", theme);
	expect(cursor.active()).toBe("theme");
	cursor.set("gone");
	expect(cursor.current()).toBe("gone");
	expect(cursor.active()).toBe("theme");
	unmountTheme();
	expect(cursor.active()).toBe("font");
});

test("the remembered row holds the stop while it is rendered, and gets it back when it renders again", () => {
	const { theme, font, width } = section();
	const cursor = createSettingsRowCursor();
	cursor.mount("theme", theme);
	cursor.mount("font", font);
	cursor.set("width");
	expect(cursor.active()).toBe("theme");
	const unmountWidth = cursor.mount("width", width);
	expect(cursor.active()).toBe("width");
	unmountWidth();
	expect(cursor.active()).toBe("theme");
	cursor.set(null);
	expect(cursor.active()).toBe("theme");
});

test("listeners hear only a change of the row holding the stop, and a stale unmount keeps a newer mount", () => {
	const { theme, font, width } = section();
	const cursor = createSettingsRowCursor();
	let calls = 0;
	const unsubscribe = cursor.subscribe(() => {
		calls += 1;
	});
	cursor.mount("theme", theme);
	const unmountOld = cursor.mount("font", font);
	expect(calls).toBe(1);
	cursor.set("font");
	cursor.set("font");
	expect(calls).toBe(2);
	const unmountNew = cursor.mount("font", width);
	unmountOld();
	expect(cursor.active()).toBe("font");
	expect(calls).toBe(2);
	unmountNew();
	expect(cursor.active()).toBe("theme");
	unsubscribe();
});
