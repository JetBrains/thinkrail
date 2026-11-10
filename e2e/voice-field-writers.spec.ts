import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { resolveBunExecutable } from "./fixtures/executables";

const ENTRY = fileURLToPath(new URL("./fixtures/speechFieldsEntry.ts", import.meta.url));

function bundle(): string {
	const built = spawnSync(
		resolveBunExecutable(),
		["build", ENTRY, "--format=iife", "--target=browser"],
		{
			encoding: "utf8",
		},
	);
	if (built.status !== 0) throw new Error(`could not bundle the field writers: ${built.stderr}`);
	return built.stdout;
}

const script = bundle();

async function page(page: Page, html: string): Promise<void> {
	await page.setContent(html);
	await page.addScriptTag({ content: script });
}

/** Drives one dictation the way the controller does: each update replaces everything recognized so far. */
async function dictate(page: Page, selector: string, updates: string[]): Promise<void> {
	await page.evaluate(
		({ selector, updates }) => {
			const element = document.querySelector<HTMLElement>(selector);
			const api = Reflect.get(window, "speechFields");
			if (!element || !api) throw new Error("field writers missing");
			const writer = api.fieldWriter(element);
			const unlock = writer.lock();
			for (const spoken of updates) writer.replace(spoken);
			unlock();
		},
		{ selector, updates },
	);
}

test("contenteditable dictation after a typed trailing space keeps every word", async ({
	page: p,
}) => {
	await page(p, '<div id="e" contenteditable="true"></div>');
	await p.locator("#e").click();
	await p.keyboard.type("hello ");
	await dictate(p, "#e", ["fix", "fix the", "fix the bug"]);
	await expect(p.locator("#e")).toHaveText("hello fix the bug");
});

test("contenteditable dictation in Devanagari or with emoji never eats the user's text", async ({
	page: p,
}) => {
	await page(p, '<div id="e" contenteditable="true"></div>');
	await p.locator("#e").click();
	await p.keyboard.type("hello");
	await dictate(p, "#e", ["नमस्ते", "नमस्ते दुनिया"]);
	await expect(p.locator("#e")).toHaveText("hello नमस्ते दुनिया");
	await page(p, '<div id="e" contenteditable="true"></div>');
	await p.locator("#e").click();
	await p.keyboard.type("hello");
	await dictate(p, "#e", ["ok 👍", "ok 👍 done"]);
	await expect(p.locator("#e")).toHaveText("hello ok 👍 done");
});

test("contenteditable dictation at the start of a new line adds no leading space", async ({
	page: p,
}) => {
	await page(p, '<div id="e" contenteditable="true"></div>');
	await p.locator("#e").click();
	await p.keyboard.type("abc");
	await p.keyboard.press("Enter");
	await dictate(p, "#e", ["fix", "fix def"]);
	expect(await p.locator("#e > div").last().textContent()).toBe("fix def");
});

test("contenteditable dictation between words spaces both sides", async ({ page: p }) => {
	await page(p, '<div id="e" contenteditable="true">hello world</div>');
	await p.locator("#e").evaluate((element) => {
		const text = element.firstChild;
		if (!text) return;
		element.focus();
		const range = document.createRange();
		range.setStart(text, 6);
		range.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	});
	await dictate(p, "#e", ["big", "big blue"]);
	await expect(p.locator("#e")).toHaveText("hello big blue world");
});

test("a textarea takes dictation through an input event and holds Enter while locked", async ({
	page: p,
}) => {
	await page(p, '<textarea id="t">Refactor</textarea>');
	const inputs = await p.locator("#t").evaluate((element) => {
		let count = 0;
		element.addEventListener("input", () => {
			count += 1;
		});
		const textarea = element as HTMLTextAreaElement;
		textarea.focus();
		textarea.setSelectionRange(8, 8);
		const api = Reflect.get(window, "speechFields");
		const writer = api.fieldWriter(element);
		const unlock = writer.lock();
		writer.replace("the store");
		const locked = textarea.readOnly;
		const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
		element.dispatchEvent(enter);
		unlock();
		return { count, locked, enterHeld: enter.defaultPrevented, readOnlyAfter: textarea.readOnly };
	});
	await expect(p.locator("#t")).toHaveValue("Refactor the store");
	expect(inputs).toEqual({ count: 1, locked: true, enterHeld: true, readOnlyAfter: false });
});

test("passwords, the code editor and the terminal are never dictation fields", async ({
	page: p,
}) => {
	await page(
		p,
		'<input id="pw" type="password"><div class="monaco-editor"><textarea id="m"></textarea></div><div class="xterm"><textarea id="x"></textarea></div><input id="ok">',
	);
	const eligible = await p.evaluate(() => {
		const api = Reflect.get(window, "speechFields");
		return ["pw", "m", "x", "ok"].map(
			(id) => api.dictationFieldOf(document.getElementById(id)) !== null,
		);
	});
	expect(eligible).toEqual([false, false, false, true]);
});
