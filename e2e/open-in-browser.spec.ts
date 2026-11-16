import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { ToolCall } from "@thinkrail/contracts";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	revealWorkbenchTool,
} from "./fixtures/app";
import { clickTranscriptControl } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_890_000_000;
const DIR = ".thinkrail/context/mockups/site";

const page = (
	host: string,
) => `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>
<body><p id="styled">Styled by its sibling sheet</p>
<script>
document.body.dataset.ran = "yes";
fetch(${JSON.stringify(`${host}/health`)}).then(
	() => (document.body.dataset.fetch = "open"),
	() => (document.body.dataset.fetch = "blocked"),
);
</script></body></html>`;

async function showFile(browserPage: Page, path: string) {
	const args: ToolCall["arguments"] = { type: "file", title: "Site", path };
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "site preview",
		messages: [
			{ role: "user", text: "Show the site.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "visualize-1", name: "visualize", arguments: args }],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "visualize-1",
				toolName: "visualize",
				content: [{ type: "text", text: "Visualization complete." }],
				details: args,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	await enterDefaultWorkspace(browserPage);
	await openPersistedChat(browserPage, "site preview");
	const card = browserPage.locator('[data-testid="tool-card"][data-tool="visualize"]');
	await expect(card).toHaveAttribute("data-status", "done");
	return card;
}

test("Open in browser opens a page with its own sheet and scripts, sandboxed away from the host", async ({
	page: app,
}) => {
	await openFixtureProject(app);
	const host = new URL(app.url()).origin;
	mkdirSync(join(E2E_FIXTURE_REPO, DIR), { recursive: true });
	writeFileSync(join(E2E_FIXTURE_REPO, DIR, "index.html"), page(host));
	writeFileSync(join(E2E_FIXTURE_REPO, DIR, "style.css"), "#styled { color: rgb(255, 0, 0); }");
	try {
		const card = await showFile(app, `${DIR}/index.html`);
		const opened = app.context().waitForEvent("page");
		await clickTranscriptControl(card.getByTestId("open-in-browser"));
		const browserTab = await opened;
		await browserTab.waitForLoadState();
		expect(browserTab.url()).toMatch(
			new RegExp(`^${host}/view/[^/]+/\\.thinkrail/context/mockups/site/index\\.html$`),
		);
		await expect(browserTab.locator("#styled")).toHaveCSS("color", "rgb(255, 0, 0)");
		await expect(browserTab.locator("body")).toHaveAttribute("data-ran", "yes");
		await expect(browserTab.locator("body")).toHaveAttribute("data-fetch", "blocked");
		await browserTab.close();
	} finally {
		rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
	}
});

test("the Files tree offers Open in browser for an HTML file only, and its tab carries it", async ({
	page: app,
}) => {
	await openFixtureProject(app);
	const workspace = await createWorkspaceViaDialog(app);
	writeFileSync(join(workspace.worktreePath, "site.html"), "<!doctype html><p>site</p>");
	await revealWorkbenchTool(app, "files");

	const readme = app.getByTestId("file-node").filter({ hasText: "README.md" });
	await readme.click({ button: "right" });
	await expect(app.getByTestId("file-copy-path")).toBeVisible();
	await expect(app.getByTestId("file-tree-open-in-browser")).toHaveCount(0);
	await app.keyboard.press("Escape");

	const site = app.getByTestId("file-node").filter({ hasText: "site.html" });
	await site.click({ button: "right" });
	const opened = app.context().waitForEvent("page");
	await app.getByTestId("file-tree-open-in-browser").click();
	const browserTab = await opened;
	await browserTab.waitForLoadState();
	expect(new URL(browserTab.url()).pathname).toBe(
		`/view/${encodeURIComponent(workspace.id)}/site.html`,
	);
	await expect(browserTab.getByText("site")).toBeVisible();
	await browserTab.close();

	await site.click();
	const pane = app.getByTestId("resource-view-toggle");
	await expect(pane.getByTestId("open-in-browser")).toBeVisible();
});
