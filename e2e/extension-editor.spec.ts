import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { writePiPackageFixture } from "./fixtures/piPackage";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

test("an installed extension can replace and paste text into its chat composer", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await openFixtureProject(page);
	const source = writePiPackageFixture(join(E2E_DATA_DIR, "editor-extension"), {
		name: "@e2e/editor-extension",
		extension: {
			file: "editor.ts",
			tool: "unused",
			source: `export default function (pi) {
  pi.registerCommand("fixture-set-editor", {
    description: "Replace the composer draft",
    handler: async (_args, ctx) => { ctx.ui.setEditorText("Extension draft 中文\\nnext line"); },
  });
  pi.registerCommand("fixture-paste-editor", {
    description: "Paste a composer draft",
    handler: async (_args, ctx) => { ctx.ui.pasteToEditor("Pasted extension draft"); },
  });
}
`,
		},
	});
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	let installed = false;
	try {
		await wire.request("packages.install", { source, scope: "user" }, 30_000);
		installed = true;
		const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: "Extension editor control",
			messages: [{ role: "user", text: "A saved conversation", timestamp: Date.now() }],
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "Extension editor control");
		await expect
			.poll(async () =>
				(await wire.request("session.getCommands", { sessionId: session.id })).map(
					(command) => command.name,
				),
			)
			.toContain("fixture-set-editor");

		const input = page.getByTestId("chat-input");
		await input.fill("/fixture-set-editor");
		await expect(
			page.getByTestId("slash-command").filter({ hasText: "/fixture-set-editor" }),
		).toBeVisible();
		await page.getByTestId("chat-send").click();
		try {
			await expect(input).toHaveValue("Extension draft 中文\nnext line");
		} finally {
			await shot(page, "extension-editor", "replaced-draft");
		}

		await input.fill("/fixture-paste-editor");
		await page.getByTestId("chat-send").click();
		await expect(input).toHaveValue("Pasted extension draft");
		await shot(page, "extension-editor", "pasted-draft");
	} finally {
		if (installed) await wire.request("packages.remove", { source, scope: "user" }, 30_000);
		wire.close();
		rmSync(source, { recursive: true, force: true });
	}
});
