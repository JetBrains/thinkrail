import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, type Route, test } from "@playwright/test";
import type { NativeClipboardContent, Workspace } from "@thinkrail/contracts";
import {
	CLIPBOARD_LIMITS,
	type ClipboardReader,
	type HelperProcess,
	readNativeClipboard,
} from "../apps/desktop/src/nativeClipboard";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { seedExternalCwdSessions } from "./fixtures/sessions";

declare global {
	interface Window {
		__readSystemClipboard?: () => Promise<NativeClipboardContent>;
		__answerClipboardRead?: (content: NativeClipboardContent) => boolean;
	}
}

const ATTACHMENTS = ".thinkrail/context/attachments";
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);
const PDF = Buffer.from("%PDF-1.7 attachment fixture\n");

async function openChatComposer(page: Page): Promise<Workspace> {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	return workspace;
}

function userMessages(page: Page) {
	return page.locator('[data-testid="chat-message"][data-role="user"]');
}

function lastUserMessage(page: Page) {
	return userMessages(page).last();
}

const chatTabs = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="chat"]');

async function attach(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
	await page.getByTestId("composer-attach-input").setInputFiles(files);
}

async function holdUploads(page: Page): Promise<() => void> {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/attachments/**", async (route: Route) => {
		await gate;
		await route.continue().catch(() => undefined);
	});
	return release;
}

function frameOf(message: string | Buffer): Record<string, unknown> | null {
	if (typeof message !== "string") return null;
	try {
		const value: unknown = JSON.parse(message);
		return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

async function holdSocket(page: Page, method: string, part: "request" | "reply") {
	const ids = new Set<string>();
	const acked = new Set<string>();
	let open = false;
	const waiting: (() => void)[] = [];
	const later = (send: () => void) => {
		if (open) send();
		else waiting.push(send);
	};
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = frameOf(message);
			const ack = frame?.ack;
			if (Array.isArray(ack)) {
				for (const id of ack) if (typeof id === "string" && ids.has(id)) acked.add(id);
			}
			if (frame?.method !== method || typeof frame.id !== "string") {
				server.send(message);
				return;
			}
			ids.add(frame.id);
			if (part === "request") later(() => server.send(message));
			else server.send(message);
		});
		server.onMessage((message) => {
			const id = frameOf(message)?.id;
			if (part === "reply" && typeof id === "string" && ids.has(id))
				later(() => browser.send(message));
			else browser.send(message);
		});
	});
	return {
		seen: () => ids.size,
		acked: () => acked.size,
		release: () => {
			open = true;
			for (const send of waiting.splice(0)) send();
		},
	};
}

type ClipboardTargets = Record<string, string | Uint8Array<ArrayBuffer>>;

const IMAGE_BUDGET = 64 * 1024;
const GTK_TEXT_TARGETS = [
	"UTF8_STRING",
	"COMPOUND_TEXT",
	"TEXT",
	"STRING",
	"text/plain;charset=utf-8",
	"text/plain",
];
const NO_ELECTROBUN: ClipboardReader = {
	availableFormats: () => [],
	readImage: () => null,
	readText: () => null,
};

const fileUri = (path: string) => pathToFileURL(path).href;

function textCopy(text: string): ClipboardTargets {
	return Object.fromEntries(GTK_TEXT_TARGETS.map((target) => [target, text]));
}

function fileManagerCopy(paths: string[]): ClipboardTargets {
	const uris = paths.map(fileUri);
	return {
		"text/uri-list": `${uris.join("\r\n")}\r\n`,
		"x-special/gnome-copied-files": `copy\n${uris.join("\n")}`,
		"application/x-kde-cutselection": "0",
	};
}

async function installSystemClipboard(page: Page): Promise<(targets: ClipboardTargets) => void> {
	let offered: ClipboardTargets = {};
	const xclip = (command: string[]): HelperProcess => {
		const target = command.at(-1) ?? "";
		const names = Object.keys(offered);
		const data =
			target === "TARGETS"
				? names.length > 0
					? ["TIMESTAMP", "TARGETS", ...names].join("\n")
					: undefined
				: offered[target];
		return {
			stdout: new Blob(data === undefined ? [] : [data]).stream(),
			exited: Promise.resolve(data === undefined ? 1 : 0),
			kill: () => undefined,
		};
	};
	await page.exposeFunction("__readSystemClipboard", () =>
		readNativeClipboard(NO_ELECTROBUN, {
			env: { DISPLAY: ":e2e" },
			spawn: xclip,
			limits: { ...CLIPBOARD_LIMITS, imageBudgetBytes: IMAGE_BUDGET },
		}),
	);
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", {
			value: Object.freeze({
				read: () => window.__readSystemClipboard?.() ?? Promise.resolve({ kind: "none" }),
			}),
		});
	});
	return (targets) => {
		offered = targets;
	};
}

async function installDeferredClipboard(
	page: Page,
): Promise<(content: NativeClipboardContent) => Promise<void>> {
	await page.addInitScript(() => {
		const waiting: ((content: NativeClipboardContent) => void)[] = [];
		Object.defineProperty(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", {
			value: Object.freeze({
				read: () => new Promise<NativeClipboardContent>((resolve) => waiting.push(resolve)),
			}),
		});
		window.__answerClipboardRead = (content) => {
			const next = waiting.shift();
			next?.(content);
			return next !== undefined;
		};
	});
	return async (content) => {
		const answered = await page.evaluate(
			(answer) => window.__answerClipboardRead?.(answer) ?? false,
			content,
		);
		expect(answered).toBe(true);
	};
}

async function pasteText(page: Page, text: string) {
	await page.getByTestId("chat-input").evaluate((el, copied) => {
		const dt = new DataTransfer();
		dt.setData("text/plain", copied);
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
		);
	}, text);
}

async function pasteEmptied(page: Page, announced: string[]) {
	await page.getByTestId("chat-input").evaluate((el, types) => {
		const dt = new DataTransfer();
		for (const type of types) dt.setData(type, "");
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
		);
	}, announced);
}

test("the paperclip attaches an image and a PDF; Send copies only the PDF into the worktree and lists its path", async ({
	page,
}) => {
	const workspace = await openChatComposer(page);
	const input = page.getByTestId("chat-input");
	await input.focus();
	await page.keyboard.press("Tab");
	await expect(page.getByTestId("composer-attach")).toBeFocused();

	await attach(page, [
		{ name: "screenshot.png", mimeType: "image/png", buffer: PNG },
		{ name: "design.pdf", mimeType: "application/pdf", buffer: PDF },
	]);
	await expect(input).toBeFocused();
	await expect(page.getByTestId("composer-image")).toHaveCount(1);
	await expect(page.getByTestId("composer-image")).toContainText("screenshot.png");
	const fileChip = page.getByTestId("composer-file");
	await expect(fileChip).toHaveCount(1);
	await expect(fileChip).toContainText("design.pdf");
	await expect(fileChip).toContainText("→ workspace");

	await input.fill("Here is the new design");
	await page.getByTestId("chat-send").click();

	const sent = lastUserMessage(page);
	await expect(sent).toContainText("Here is the new design");
	await expect(sent).toContainText("Attached files:");
	await expect(sent).toContainText(`- ${ATTACHMENTS}/design.pdf`);
	await expect(sent.getByTestId("chat-attachment-chip")).toHaveCount(1);
	await expect(page.getByTestId("composer-file")).toHaveCount(0);
	await expect(page.getByTestId("composer-image")).toHaveCount(0);
	const folder = join(workspace.worktreePath, ATTACHMENTS);
	expect(readFileSync(join(folder, "design.pdf"))).toEqual(PDF);
	expect(readdirSync(folder)).toEqual(["design.pdf"]);

	await expect(page.getByTestId("chat-composer")).toHaveAttribute("data-streaming", "false");
	await attach(page, [{ name: "design.pdf", mimeType: "application/pdf", buffer: PDF }]);
	await input.fill("And again");
	await input.press("Enter");
	await expect(lastUserMessage(page)).toContainText(`- ${ATTACHMENTS}/design-2.pdf`);
	expect(readdirSync(folder).sort()).toEqual(["design-2.pdf", "design.pdf"]);
});

test("the chips are one Tab stop between the field and the model picker; arrows walk them and Delete/Backspace remove them", async ({
	page,
}) => {
	await openChatComposer(page);
	const input = page.getByTestId("chat-input");
	const picker = page.getByTestId("model-selector");
	await input.focus();
	await page.keyboard.press("Shift+Tab");
	await expect(picker).toBeFocused();

	await attach(page, [
		{ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
		{ name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
	]);
	const chips = page.getByTestId("composer-chip");
	await expect(chips).toHaveCount(2);
	await expect(input).toBeFocused();

	await page.keyboard.press("Shift+Tab");
	await expect(chips.nth(0)).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(picker).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(chips.nth(0)).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(input).toBeFocused();

	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("ArrowRight");
	await expect(chips.nth(1)).toBeFocused();
	await expect(chips.nth(1)).toContainText("b.txt");
	await page.keyboard.press("Delete");
	await expect(chips).toHaveCount(1);
	await expect(chips.nth(0)).toContainText("a.txt");
	await expect(chips.nth(0)).toBeFocused();
	await page.keyboard.press("Backspace");
	await expect(chips).toHaveCount(0);
	await expect(input).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(picker).toBeFocused();
});

test("a file dropped anywhere on the composer attaches, one over 100 MB is refused on its chip, and an emptied drop explains itself", async ({
	page,
}) => {
	await openChatComposer(page);
	await page.getByTestId("chat-composer-shell").evaluate((el) => {
		const dt = new DataTransfer();
		dt.items.add(new File(["hello"], "notes.md", { type: "text/markdown" }));
		el.dispatchEvent(
			new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }),
		);
		el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	});
	await expect(page.getByTestId("composer-file")).toContainText("notes.md");

	await page.getByTestId("chat-input").evaluate((el) => {
		const dt = new DataTransfer();
		dt.items.add(new File([new ArrayBuffer(100 * 1024 * 1024 + 1)], "recording.mov"));
		el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
	});
	const error = page.getByTestId("composer-image-error");
	await expect(error).toContainText("recording.mov");
	await expect(error).toContainText("larger than 100 MB");
	await expect(page.getByTestId("composer-file")).toHaveCount(1);

	await page.getByTestId("chat-input").evaluate((el) => {
		const dt = new DataTransfer();
		dt.setData("text/uri-list", "");
		el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	});
	await expect(
		page.getByTestId("toast").filter({
			hasText: "The dropped files didn't come through — attach them with the paperclip",
		}),
	).toBeVisible();
	await expect(page.getByTestId("toast").filter({ hasText: "Linux" })).toHaveCount(0);
	await expect(page.getByTestId("composer-file")).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toHaveValue("");
});

test("a file manager's copy the webview emptied is read natively and copied by the host; files it cannot list explain themselves", async ({
	page,
}) => {
	const copy = await installSystemClipboard(page);
	const workspace = await openChatComposer(page);
	const outside = join(E2E_DATA_DIR, "file-manager");
	mkdirSync(outside, { recursive: true });
	const source = join(outside, "From Files.pdf");
	const shot = join(outside, "shot.png");
	writeFileSync(source, PDF);
	writeFileSync(shot, PNG);
	const input = page.getByTestId("chat-input");
	await input.focus();
	copy(fileManagerCopy([source, shot]));
	await pasteEmptied(page, ["text/uri-list"]);
	await expect(page.getByTestId("composer-file")).toContainText("From Files.pdf");
	await expect(page.getByTestId("composer-image")).toContainText("shot.png");
	await expect(input).toHaveValue("");

	copy(fileManagerCopy([join(outside, "gone.pdf")]));
	await pasteEmptied(page, ["text/uri-list"]);
	await expect(
		page.getByTestId("toast").filter({ hasText: "Couldn't read the copied files" }),
	).toBeVisible();
	await expect(page.getByTestId("composer-chip")).toHaveCount(2);
	await expect(input).toHaveValue("");
	await input.evaluate((el) => {
		const dt = new DataTransfer();
		dt.setData("text/uri-list", "");
		el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	});
	await expect(
		page.getByTestId("toast").filter({
			hasText: "Drag and drop isn't available on Linux — use the paperclip or paste",
		}),
	).toBeVisible();
	await input.fill("From the file manager");
	await input.press("Enter");
	await expect(lastUserMessage(page)).toContainText(`- ${ATTACHMENTS}/From Files.pdf`);
	expect(readFileSync(join(workspace.worktreePath, ATTACHMENTS, "From Files.pdf"))).toEqual(PDF);
	expect(existsSync(join(workspace.worktreePath, ATTACHMENTS, "shot.png"))).toBe(false);
});

test("copied paths paste as text, while a file manager's text-only copy (GNOME's copied-files text) gives chips", async ({
	page,
}) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	const copy = await installSystemClipboard(page);
	const workspace = await openChatComposer(page);
	const outside = join(E2E_DATA_DIR, "file-manager-text");
	mkdirSync(outside, { recursive: true });
	const design = join(outside, "design.pdf");
	const shot = join(outside, "shot.png");
	const notes = join(outside, "notes.md");
	writeFileSync(design, PDF);
	writeFileSync(shot, PNG);
	writeFileSync(notes, "# notes\n");
	const input = page.getByTestId("chat-input");
	const chips = page.getByTestId("composer-chip");
	const pasteText = async (text: string) => {
		copy(textCopy(text));
		await page.evaluate((copied) => navigator.clipboard.writeText(copied), text);
		await input.focus();
		await page.keyboard.press("ControlOrMeta+V");
	};

	await pasteText(`${design}\n${shot}`);
	await expect(input).toHaveValue(`${design}\n${shot}`);
	await expect(chips).toHaveCount(0);
	await input.fill("");

	await pasteText(`x-special/nautilus-clipboard\ncopy\n${fileUri(design)}\n${fileUri(shot)}\n`);
	await expect(page.getByTestId("composer-file")).toContainText("design.pdf");
	await expect(page.getByTestId("composer-image")).toContainText("shot.png");
	await expect(input).toHaveValue("");
	await pasteText(`copy\n${fileUri(notes)}`);
	await expect(page.getByTestId("composer-file").filter({ hasText: "notes.md" })).toHaveCount(1);
	await expect(chips).toHaveCount(3);
	await expect(input).toHaveValue("");

	await pasteText("Plain words to paste");
	await expect(input).toHaveValue("Plain words to paste");
	await expect(chips).toHaveCount(3);
	await input.press("Enter");
	const sent = lastUserMessage(page);
	await expect(sent).toContainText("Plain words to paste");
	await expect(sent).toContainText(`- ${ATTACHMENTS}/design.pdf`);
	await expect(sent).toContainText(`- ${ATTACHMENTS}/notes.md`);
	const folder = join(workspace.worktreePath, ATTACHMENTS);
	expect(readdirSync(folder).sort()).toEqual(["design.pdf", "notes.md"]);
	expect(readFileSync(join(folder, "design.pdf"))).toEqual(PDF);
});

test("the New Workspace dialog's paperclip keeps files under the host data dir and lists their absolute paths", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("ws-prompt").fill("Start from this brief");
	await dialog
		.getByTestId("ws-attach-input")
		.setInputFiles([{ name: "brief.pdf", mimeType: "application/pdf", buffer: PDF }]);
	await expect(dialog.getByTestId("ws-prompt")).toBeFocused();
	const chip = dialog.getByTestId("composer-file");
	await expect(chip).toContainText("brief.pdf");
	await expect(chip).toContainText("→ attachments");
	await expect(chip).not.toContainText("workspace");
	await expect(chip).toHaveAttribute(
		"title",
		"brief.pdf — copied to ThinkRail's attachments folder when you start",
	);
	const stored = join(E2E_DATA_DIR, "attachments");
	const before = new Set(existsSync(stored) ? readdirSync(stored) : []);
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	const added = readdirSync(stored).filter((entry) => !before.has(entry));
	expect(added).toHaveLength(1);
	const path = join(stored, added[0] ?? "");
	expect(readFileSync(path)).toEqual(PDF);
	await expect(lastUserMessage(page)).toContainText(`- ${path}`);
});

test("while Create copies the files, the dialog's chips take no removals or additions; Esc gives the draft back, and the start lists exactly the chips shown", async ({
	page,
}) => {
	const startCreate = await holdSocket(page, "workspace.startCreate", "request");
	await openFixtureProject(page);
	const release = await holdUploads(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	const prompt = dialog.getByTestId("ws-prompt");
	const chips = dialog.getByTestId("composer-chip");
	const uploading = dialog.getByTestId("composer-files-uploading");
	await prompt.fill("Start from the plan and the notes");
	await dialog.getByTestId("ws-attach-input").setInputFiles([
		{ name: "plan.pdf", mimeType: "application/pdf", buffer: PDF },
		{ name: "plan-notes.md", mimeType: "text/markdown", buffer: Buffer.from("# notes\n") },
	]);
	await expect(chips).toHaveCount(2);
	const stored = join(E2E_DATA_DIR, "attachments");
	const before = new Set(existsSync(stored) ? readdirSync(stored) : []);

	await page.getByTestId("create-workspace").click();
	await chips.last().focus();
	await page.keyboard.press("Delete");
	await expect(chips).toHaveCount(2);
	await expect(uploading).toBeVisible();
	await expect(chips.last().getByRole("button")).toBeDisabled();
	await dialog
		.getByTestId("ws-attach-input")
		.setInputFiles([{ name: "late.txt", mimeType: "text/plain", buffer: Buffer.from("late") }]);
	await prompt.evaluate((el) => {
		const dt = new DataTransfer();
		dt.items.add(new File(["pasted"], "pasted.txt", { type: "text/plain" }));
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
		);
		el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	});
	await expect(chips).toHaveCount(2);
	await expect(dialog.getByTestId("ws-attach")).toBeDisabled();

	await page.keyboard.press("Escape");
	await expect(uploading).toHaveCount(0);
	await expect(dialog).toBeVisible();
	await expect(prompt).toBeEnabled();
	await expect(prompt).toHaveValue("Start from the plan and the notes");
	await expect(chips).toHaveCount(2);
	await expect(page.getByTestId("toast").filter({ hasText: "Couldn't copy" })).toHaveCount(0);

	release();
	await page.unroute("**/attachments/**");
	await page.getByTestId("create-workspace").click();
	await expect.poll(startCreate.seen).toBe(1);
	await expect(uploading).toHaveCount(0);
	await chips.first().focus();
	await page.keyboard.press("Delete");
	await expect(chips).toHaveCount(2);
	await expect(chips.first().getByRole("button")).toBeDisabled();
	startCreate.release();
	await expect(dialog).toBeHidden();

	const added = readdirSync(stored).filter((entry) => !before.has(entry));
	expect(added.sort()).toEqual(["plan-notes.md", "plan.pdf"]);
	const sent = lastUserMessage(page);
	await expect(sent).toContainText(`- ${join(stored, "plan.pdf")}`);
	await expect(sent).toContainText(`- ${join(stored, "plan-notes.md")}`);
	await expect(sent).not.toContainText("late.txt");
	await expect(sent).not.toContainText("pasted.txt");
});

test("a slow copy holds the draft: text put in meanwhile stays after the send, and only the sent text and chips go", async ({
	page,
}) => {
	const workspace = await openChatComposer(page);
	seedExternalCwdSessions();
	const release = await holdUploads(page);
	const input = page.getByTestId("chat-input");
	await attach(page, [{ name: "design.pdf", mimeType: "application/pdf", buffer: PDF }]);
	await input.fill("With the file");
	await input.press("Enter");
	await expect(page.getByTestId("composer-files-uploading")).toBeVisible();
	await expect(input).toHaveAttribute("readonly", "");

	const query = page.getByTestId("history-query");
	await input.press("Control+r");
	await query.fill("fix");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(
		page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "fix the flaky watcher test" }),
	).toBeVisible();
	await query.press("ControlOrMeta+Enter");
	await expect(page.getByTestId("history-overlay")).toBeHidden();
	await expect(input).toHaveValue("fix the flaky watcher test\n\nWith the file");
	await expect(page.getByTestId("composer-files-uploading")).toBeVisible();

	release();
	const sent = lastUserMessage(page);
	await expect(sent).toContainText("With the file");
	await expect(sent).toContainText(`- ${ATTACHMENTS}/design.pdf`);
	await expect(sent).not.toContainText("fix the flaky watcher test");
	await expect(page.getByTestId("composer-files-uploading")).toHaveCount(0);
	await expect(page.getByTestId("composer-file")).toHaveCount(0);
	await expect(input).toHaveValue("fix the flaky watcher test");
	await expect(input).not.toHaveAttribute("readonly", "");
	expect(readdirSync(join(workspace.worktreePath, ATTACHMENTS))).toEqual(["design.pdf"]);
});

test("Esc or × stops a slow copy and leaves the draft as it was", async ({ page }) => {
	const workspace = await openChatComposer(page);
	const release = await holdUploads(page);
	const input = page.getByTestId("chat-input");
	const uploading = page.getByTestId("composer-files-uploading");
	await attach(page, [{ name: "design.pdf", mimeType: "application/pdf", buffer: PDF }]);
	await input.fill("Keep this draft");

	await input.press("Enter");
	await expect(uploading).toBeVisible();
	await input.press("Escape");
	await expect(uploading).toHaveCount(0);
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("Keep this draft");
	await expect(input).not.toHaveAttribute("readonly", "");
	await expect(page.getByTestId("composer-file")).toContainText("design.pdf");
	await expect(page.getByTestId("composer-command-error")).toHaveCount(0);

	await input.press("Enter");
	await expect(uploading).toBeVisible();
	await page.getByTestId("composer-files-uploading-cancel").click();
	await expect(uploading).toHaveCount(0);
	await expect(input).toHaveValue("Keep this draft");
	await expect(page.getByTestId("composer-file")).toContainText("design.pdf");
	await expect(page.getByTestId("composer-command-error")).toHaveCount(0);

	release();
	await page.unroute("**/attachments/**");
	await input.press("Enter");
	await expect(lastUserMessage(page)).toContainText(`- ${ATTACHMENTS}/design.pdf`);
	await expect(input).toHaveValue("");
	expect(readdirSync(join(workspace.worktreePath, ATTACHMENTS))).toEqual(["design.pdf"]);
});

test("after a failed copy the retry skips the files already copied, and the failure names the file", async ({
	page,
}) => {
	const workspace = await openChatComposer(page);
	let failNext = true;
	await page.route("**/attachments/**", async (route) => {
		if (failNext && route.request().url().includes("/b.txt")) {
			failNext = false;
			await route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" });
			return;
		}
		await route.continue();
	});
	const input = page.getByTestId("chat-input");
	await attach(page, [
		{ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
		{ name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
	]);
	await input.fill("Two files");
	await input.press("Enter");
	await expect(page.getByTestId("composer-command-error")).toHaveText(
		"Couldn't copy b.txt — the host answered HTTP 502",
	);
	await expect(page.getByTestId("composer-file")).toHaveCount(2);
	await expect(input).toHaveValue("Two files");
	const folder = join(workspace.worktreePath, ATTACHMENTS);
	expect(readdirSync(folder)).toEqual(["a.txt"]);

	await input.press("Enter");
	const sent = lastUserMessage(page);
	await expect(sent).toContainText(`- ${ATTACHMENTS}/a.txt`);
	await expect(sent).toContainText(`- ${ATTACHMENTS}/b.txt`);
	expect(readdirSync(folder).sort()).toEqual(["a.txt", "b.txt"]);
});

test("pasted images the desktop could not inline, or the webview cannot decode, end on error chips and never reach the workspace", async ({
	page,
}) => {
	const copy = await installSystemClipboard(page);
	const workspace = await openChatComposer(page);
	const outside = join(E2E_DATA_DIR, "file-manager-images");
	mkdirSync(outside, { recursive: true });
	const huge = join(outside, "huge.png");
	const heic = join(outside, "photo.heic");
	const notes = join(outside, "notes.pdf");
	writeFileSync(huge, new Uint8Array(IMAGE_BUDGET + 1));
	writeFileSync(heic, new Uint8Array(3));
	writeFileSync(notes, PDF);
	await page.getByTestId("chat-input").focus();
	copy(fileManagerCopy([huge, heic, notes]));
	await pasteEmptied(page, ["text/uri-list"]);
	const errors = page.getByTestId("composer-image-error");
	await expect(errors.filter({ hasText: "huge.png" })).toContainText(
		"too large to paste — use the paperclip",
	);
	await expect(errors.filter({ hasText: "photo.heic" })).toContainText("unsupported image format");
	await expect(page.getByTestId("composer-file")).toHaveCount(1);
	await expect(page.getByTestId("composer-file")).toContainText("notes.pdf");

	copy({ "image/png": new Uint8Array(IMAGE_BUDGET + 1) });
	await pasteEmptied(page, []);
	await expect(errors.filter({ hasText: "image.png" })).toContainText(
		"too large to paste — use the paperclip",
	);

	await page.getByTestId("chat-input").fill("Only the notes");
	await page.getByTestId("chat-input").press("Enter");
	await expect(lastUserMessage(page)).toContainText(`- ${ATTACHMENTS}/notes.pdf`);
	await expect(errors).toHaveCount(0);
	expect(readdirSync(join(workspace.worktreePath, ATTACHMENTS))).toEqual(["notes.pdf"]);
});

test("a paste the desktop is still reading holds Send, and its late answer lands only on the chat it was pasted into", async ({
	page,
}) => {
	const answer = await installDeferredClipboard(page);
	await openChatComposer(page);
	const input = page.getByTestId("chat-input");
	const pending = page.getByTestId("composer-image-pending");
	const image = page.getByTestId("composer-image");
	const screenshot = {
		kind: "image",
		mimeType: "image/png",
		data: PNG.toString("base64"),
	} as const;
	await input.fill("Here is the screenshot");
	await pasteEmptied(page, []);
	await expect(pending).toBeVisible();
	await expect(page.getByTestId("chat-send")).toBeDisabled();
	await input.press("Enter");
	await answer(screenshot);
	await expect(image).toContainText("image.png");
	await expect(pending).toHaveCount(0);
	await expect(input).toHaveValue("Here is the screenshot");
	await expect(userMessages(page)).toHaveCount(0);

	await input.press("Enter");
	await expect(lastUserMessage(page)).toContainText("Here is the screenshot");
	await expect(lastUserMessage(page).getByTestId("chat-attachment-chip")).toHaveCount(1);
	await expect(image).toHaveCount(0);
	await expect(page.getByTestId("chat-composer")).toHaveAttribute("data-streaming", "false");

	await pasteEmptied(page, []);
	await pasteText(page, fileUri(join(E2E_DATA_DIR, "copied-and-gone.pdf")));
	await expect(pending).toContainText("Attaching 2…");
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs(page)).toHaveCount(2);
	await expect(input).toHaveValue("");
	await input.focus();
	await answer(screenshot);
	await answer({ kind: "none" });
	await expect(image).toHaveCount(0);
	await expect(pending).toHaveCount(0);

	await chatTabs(page).first().getByRole("tab").click();
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");
	await expect(image).toHaveCount(1);
	await expect(pending).toHaveCount(0);
	await expect(input).toHaveValue("");
	await chatTabs(page).last().getByRole("tab").click();
	await expect(chatTabs(page).last()).toHaveAttribute("data-active", "true");
	await expect(input).toHaveValue("");
	await expect(image).toHaveCount(0);
});

test("while a slow copy holds the draft, recall and @-mention keys leave it alone and Esc gives back exactly what was held", async ({
	page,
}) => {
	const workspace = await openChatComposer(page);
	const input = page.getByTestId("chat-input");
	const uploading = page.getByTestId("composer-files-uploading");
	const mentions = page.getByTestId("mention-menu");
	await input.fill("Read the design");
	await input.press("Enter");
	await expect(lastUserMessage(page)).toContainText("Read the design");
	await expect(page.getByTestId("chat-composer")).toHaveAttribute("data-streaming", "false");

	const release = await holdUploads(page);
	await input.press("ArrowUp");
	await expect(input).toHaveValue("Read the design");
	await attach(page, [{ name: "design.pdf", mimeType: "application/pdf", buffer: PDF }]);
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect(uploading).toBeVisible();
	await input.press("ArrowDown");
	await expect(input).toHaveValue("Read the design");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("Read the design");
	await input.press("Escape");
	await expect(uploading).toHaveCount(0);
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("Read the design");
	await expect(page.getByTestId("composer-file")).toContainText("design.pdf");

	await input.fill("See @READ");
	await expect(mentions).toBeVisible();
	await input.press("ControlOrMeta+Enter");
	await expect(uploading).toBeVisible();
	await expect(mentions).toHaveCount(0);
	await input.press("Enter");
	await expect(input).toHaveValue("See @READ");
	await page.keyboard.press("Shift+Tab");
	await expect(page.getByTestId("composer-chip").first()).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(input).toBeFocused();
	await input.press("Escape");
	await expect(uploading).toHaveCount(0);
	await expect(input).toHaveValue("See @READ");
	await expect(mentions).toBeVisible();

	release();
	await page.unroute("**/attachments/**");
	await input.press("Escape");
	await expect(mentions).toHaveCount(0);
	await input.press("Enter");
	await expect(lastUserMessage(page)).toContainText("See @READ");
	await expect(lastUserMessage(page)).toContainText(`- ${ATTACHMENTS}/design.pdf`);
	await expect(input).toHaveValue("");
	expect(readdirSync(join(workspace.worktreePath, ATTACHMENTS))).toEqual(["design.pdf"]);
});

test("Esc or × lets go of a pasted file's slow host copy at once; its late answer sends nothing, and the retry copies it once", async ({
	page,
}) => {
	const copyReply = await holdSocket(page, "attachments.copyLocal", "reply");
	const copy = await installSystemClipboard(page);
	const workspace = await openChatComposer(page);
	const outside = join(E2E_DATA_DIR, "slow-copy");
	mkdirSync(outside, { recursive: true });
	const source = join(outside, "slow.pdf");
	writeFileSync(source, PDF);
	const input = page.getByTestId("chat-input");
	const send = page.getByTestId("chat-send");
	const uploading = page.getByTestId("composer-files-uploading");
	const file = page.getByTestId("composer-file");
	await input.focus();
	copy(fileManagerCopy([source]));
	await pasteEmptied(page, ["text/uri-list"]);
	await expect(file).toContainText("slow.pdf");
	await input.fill("Read the slow file");

	await input.press("Enter");
	await expect(uploading).toBeVisible();
	await expect.poll(copyReply.seen).toBe(1);
	await input.press("Escape");
	await expect(uploading).toHaveCount(0);
	await expect(input).not.toHaveAttribute("readonly", "");
	await expect(input).toHaveValue("Read the slow file");
	await expect(send).toBeEnabled();
	await expect(page.getByTestId("composer-command-error")).toHaveCount(0);

	await input.press("Enter");
	await expect(uploading).toBeVisible();
	await page.getByTestId("composer-files-uploading-cancel").click();
	await expect(uploading).toHaveCount(0);
	await expect(input).toHaveValue("Read the slow file");
	await expect(send).toBeEnabled();
	expect(copyReply.seen()).toBe(1);

	copyReply.release();
	await expect.poll(copyReply.acked).toBe(1);
	await expect(userMessages(page)).toHaveCount(0);
	await expect(input).toHaveValue("Read the slow file");
	await expect(file).toHaveCount(1);
	await expect(uploading).toHaveCount(0);

	await input.press("Enter");
	const sent = lastUserMessage(page);
	await expect(sent).toContainText("Read the slow file");
	await expect(sent).toContainText(`- ${ATTACHMENTS}/slow.pdf`);
	await expect(userMessages(page)).toHaveCount(1);
	await expect(input).toHaveValue("");
	expect(copyReply.seen()).toBe(1);
	expect(readdirSync(join(workspace.worktreePath, ATTACHMENTS))).toEqual(["slow.pdf"]);
});
