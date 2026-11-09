import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openPersistedChat,
	PHONE_VIEWPORT,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

test.use({ launchOptions: { args: ["--js-flags=--jitless"] } });

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
const SCRIPT = ["export const first = 1;", "export const second = 2;"];

async function openWorkspaceWithScript(page: Page) {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	expect(await page.evaluate(() => typeof Reflect.get(globalThis, "WebAssembly"))).toBe(
		"undefined",
	);
	writeFileSync(join(worktree(), "script.ts"), `${SCRIPT.join("\n")}\n`);
	return workspace;
}

test("without WebAssembly a code diff shows its lines as plain text", async ({ page }) => {
	await openWorkspaceWithScript(page);
	writeFileSync(join(worktree(), "notes.txt"), "a note edited by e2e\n");
	await revealWorkbenchTool(page, "changes");

	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).dblclick();
	const diff = page.getByTestId("diff-view");
	const added = diff.getByTestId("plain-code").locator('[data-kind="addition"] > span:last-child');
	await expect(added).toBeVisible();
	await expect(added).toHaveText(SCRIPT.join("\n"));

	await page.getByTestId("change-item").filter({ hasText: "notes.txt" }).dblclick();
	await expect(diff.getByText("plain-text-fixture", { exact: true })).toBeVisible();
	await expect(diff.getByText("a note edited by e2e", { exact: true })).toBeVisible();
});

test("without WebAssembly a 20k-line added file stays a handful of DOM nodes", async ({ page }) => {
	await openWorkspaceWithScript(page);
	const lines = Array.from({ length: 20_000 }, (_, line) => `export const v${line} = ${line};`);
	writeFileSync(join(worktree(), "big.ts"), `${lines.join("\n")}\n`);
	await revealWorkbenchTool(page, "changes");

	await page.getByTestId("change-item").filter({ hasText: "big.ts" }).dblclick();
	const plain = page.getByTestId("diff-view").getByTestId("plain-code");
	await expect(plain).toContainText(lines.at(-1) ?? "");
	expect(await plain.evaluate((pre) => pre.querySelectorAll("*").length)).toBeLessThan(10);
});

test("without WebAssembly a phone-class code file shows its lines as plain text, and Monaco still shows the file", async ({
	page,
}) => {
	await openWorkspaceWithScript(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "script.ts" }).dblclick();
	const monaco = page.locator(".monaco-editor .view-lines").first();
	for (const line of SCRIPT) await expect(monaco).toContainText(line);

	await page.setViewportSize(PHONE_VIEWPORT);
	await hideAuxiliaryWorkbench(page);
	const fileView = page.getByTestId("file-view");
	const plain = fileView.getByTestId("plain-code");
	await expect(plain).toBeVisible();
	await expect(plain).toHaveText(SCRIPT.join("\n"));
});

test("without WebAssembly a chat code block shows its lines as plain text", async ({ page }) => {
	await openFixtureProject(page);
	const at = Date.now();
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Plain fence",
		messages: [
			{ role: "user", text: "show the script", timestamp: at },
			{
				role: "assistant",
				text: ["```ts", ...SCRIPT, "```"].join("\n"),
				timestamp: at + 1_000,
			},
		],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Plain fence");
	const code = page.locator("pre", { hasText: SCRIPT[0] ?? "" }).last();
	for (const line of SCRIPT) await expect(code).toContainText(line);
});

test("without WebAssembly a line thread on a plain diff or phone file is listed as unplaced", async ({
	page,
}) => {
	const workspace = await openWorkspaceWithScript(page);
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("review.commentAdd", {
			workspaceId: workspace.id,
			kind: "inline",
			anchor: {
				path: "script.ts",
				side: "worktree",
				selectors: [{ kind: "lineRange", startLine: 2, endLine: 2 }],
			},
			body: "A remark on a plain line.",
		});
	} finally {
		wire.close();
	}
	const strip = page.getByTestId("review-unplaced-strip");

	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).dblclick();
	const diff = page.getByTestId("diff-view");
	await expect(diff.getByTestId("plain-code")).toContainText(SCRIPT[1] ?? "");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(0);
	await expect(strip).toBeVisible();

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "script.ts" }).dblclick();
	await page.setViewportSize(PHONE_VIEWPORT);
	await hideAuxiliaryWorkbench(page);
	const fileView = page.getByTestId("file-view");
	await expect(fileView.getByTestId("plain-code")).toContainText(SCRIPT[1] ?? "");
	await expect(fileView.getByTestId("review-thread-card")).toHaveCount(0);
	await expect(strip).toBeVisible();
});
