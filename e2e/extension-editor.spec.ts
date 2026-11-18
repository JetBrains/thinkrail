import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { writePiPackageFixture } from "./fixtures/piPackage";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

const MARKER = join(E2E_DATA_DIR, "editor-extension-marker");

const EXTENSION_SOURCE = `import { existsSync, rmSync } from "node:fs";
export default function (pi) {
  pi.registerCommand("fixture-set-editor", {
    description: "Replace the composer draft",
    handler: async (_args, ctx) => { ctx.ui.setEditorText("Extension draft 中文\\nnext line"); },
  });
  pi.registerCommand("fixture-editor-later", {
    description: "Edit the composer once the marker file appears",
    handler: async (args, ctx) => {
      const mode = args.slice(0, args.indexOf(" "));
      const text = args.slice(args.indexOf(" ") + 1);
      const timer = setInterval(() => {
        if (!existsSync(${JSON.stringify(MARKER)})) return;
        clearInterval(timer);
        if (mode === "paste") ctx.ui.pasteToEditor(text);
        else ctx.ui.setEditorText(text);
        rmSync(${JSON.stringify(MARKER)});
      }, 20);
    },
  });
}
`;

function chatTab(page: Page, title: string): Locator {
	return page.locator('[data-testid="editor-tab"][data-kind="chat"]').filter({ hasText: title });
}

async function runCommand(page: Page, command: string): Promise<void> {
	const input = page.getByTestId("chat-input");
	await input.fill(command);
	await page.getByTestId("chat-send").click();
	await expect(input).toHaveValue("");
}

async function releaseExtensionEdit(): Promise<void> {
	writeFileSync(MARKER, "");
	await expect.poll(() => existsSync(MARKER)).toBe(false);
}

test("an installed extension replaces and pastes into its own chat's composer", async ({
	page,
}) => {
	test.setTimeout(90_000);
	const sentPrompts: string[] = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			try {
				const frame = JSON.parse(String(payload)) as {
					method?: unknown;
					params?: { text?: unknown };
				};
				if (frame.method === "session.prompt" && typeof frame.params?.text === "string")
					sentPrompts.push(frame.params.text);
			} catch {}
		});
	});
	rmSync(MARKER, { force: true });
	await openFixtureProject(page);
	const source = writePiPackageFixture(join(E2E_DATA_DIR, "editor-extension"), {
		name: "@e2e/editor-extension",
		extension: { file: "editor.ts", tool: "unused", source: EXTENSION_SOURCE },
	});
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	let installed = false;
	try {
		await wire.request("packages.install", { source, scope: "user" }, 30_000);
		installed = true;
		const worktree = realpathSync(E2E_FIXTURE_REPO);
		const session = seedWorkspaceSession(worktree, {
			name: "Extension editor control",
			messages: [{ role: "user", text: "A saved conversation", timestamp: Date.now() }],
		});
		seedWorkspaceSession(worktree, {
			name: "Extension editor neighbour",
			messages: [{ role: "user", text: "Another saved conversation", timestamp: Date.now() }],
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "Extension editor control");
		await expect
			.poll(async () =>
				(await wire.request("session.getCommands", { sessionId: session.id })).map(
					(command) => command.name,
				),
			)
			.toContain("fixture-editor-later");
		const input = page.getByTestId("chat-input");

		await test.step("setEditorText replaces the draft", async () => {
			await input.fill("/fixture-set-editor");
			await expect(
				page.getByTestId("slash-command").filter({ hasText: "/fixture-set-editor" }),
			).toBeVisible();
			await page.getByTestId("chat-send").click();
			await expect(input).toHaveValue("Extension draft 中文\nnext line");
			await shot(page, "extension-editor", "replaced-draft");
		});

		await test.step("pasteToEditor inserts at the caret of the focused composer", async () => {
			await runCommand(page, "/fixture-editor-later paste  big");
			await input.fill("Hello world");
			await input.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(5, 5));
			await releaseExtensionEdit();
			await expect(input).toHaveValue("Hello big world");
			await expect(input).toBeFocused();
			expect(
				await input.evaluate((el) => {
					const textarea = el as HTMLTextAreaElement;
					return [textarea.selectionStart, textarea.selectionEnd];
				}),
			).toEqual([9, 9]);
			await shot(page, "extension-editor", "pasted-at-caret");
		});

		await test.step("an edit for a chat that is not shown waits for its composer", async () => {
			await runCommand(page, "/fixture-editor-later paste  appended");
			await input.fill("Kept draft");
			await openPersistedChat(page, "Extension editor neighbour");
			await chatTab(page, "Extension editor neighbour").click();
			await expect(chatTab(page, "Extension editor neighbour")).toHaveAttribute(
				"data-active",
				"true",
			);
			await input.fill("Neighbour draft");
			await releaseExtensionEdit();
			await expect(input).toHaveValue("Neighbour draft");
			await expect(input).toBeFocused();
			await chatTab(page, "Extension editor control").click();
			await expect(input).toHaveValue("Kept draft appended");
			await chatTab(page, "Extension editor neighbour").click();
			await expect(input).toHaveValue("Neighbour draft");
			await chatTab(page, "Extension editor control").click();
		});

		await test.step("a replacement ends a live template slot session", async () => {
			await runCommand(page, "/fixture-editor-later set Extension draft");
			await input.fill("/rev");
			await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
			await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);
			await expect(page.getByTestId("slot-hint")).toContainText("slot 1/2");
			await releaseExtensionEdit();
			await expect(input).toHaveValue("Extension draft");
			await expect(page.getByTestId("slot-hint")).toHaveCount(0);
			await expect(page.getByTestId("slot-backdrop")).toHaveCount(0);
			await page.getByTestId("chat-send").click();
			await expect.poll(() => sentPrompts.at(-1)).toBe("Extension draft");
		});
	} finally {
		if (installed) await wire.request("packages.remove", { source, scope: "user" }, 30_000);
		wire.close();
		rmSync(source, { recursive: true, force: true });
		rmSync(MARKER, { force: true });
	}
});
