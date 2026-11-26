import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { WorkspaceArtifact, WorkspaceArtifactsSnapshot } from "@thinkrail/contracts";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	loadPersistedWorkspaces,
	openFixtureProject,
	openPersistedChat,
	openWorkspaceChat,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const CONTEXT = ".thinkrail/context";

function artifact(page: Page, path: string) {
	return page.locator(`[data-testid="artifact-row"][data-path="${CONTEXT}/${path}"]`);
}

function writeArtifact(root: string, path: string, content: string): void {
	const file = join(root, CONTEXT, path);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, content);
}

type View = "outputs" | "smart" | "list" | "tree";

async function chooseView(page: Page, view: View): Promise<void> {
	await page.getByTestId("artifacts-view").click();
	await page.getByTestId(`artifacts-view-${view}`).click();
	await expectView(page, view);
}

async function expectView(page: Page, view: View): Promise<void> {
	await expect(page.getByTestId("artifacts-view")).toHaveAttribute("data-view", view);
}

async function showArtifacts(page: Page, view: "list" | "remembered" = "list"): Promise<void> {
	await revealWorkbenchTool(page, "artifacts");
	await page.getByTestId("artifacts-filter-all").click();
	await expect(page.getByTestId("artifacts-filter-all")).toHaveAttribute("data-active", "true");
	if (view === "list") await chooseView(page, "list");
}

function parseFrame(message: string | Buffer): Record<string, unknown> | null {
	if (typeof message !== "string") return null;
	try {
		const frame: unknown = JSON.parse(message);
		return frame !== null && typeof frame === "object" ? (frame as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

async function publishOnWire(page: Page, published: ReadonlySet<string>): Promise<void> {
	const lists = new Set<string>();
	await page.routeWebSocket(/\/ws(?:\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = parseFrame(message);
			if (frame?.method === "artifacts.list" && typeof frame.id === "string") lists.add(frame.id);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = parseFrame(message);
			if (typeof frame?.id !== "string" || !lists.delete(frame.id) || frame.ok !== true) {
				browser.send(message);
				return;
			}
			const snapshot = frame.result as WorkspaceArtifactsSnapshot;
			const mark = (entry: WorkspaceArtifact): WorkspaceArtifact =>
				published.has(entry.path.slice(CONTEXT.length + 1))
					? { ...entry, published: true, role: "result", reason: "published" }
					: entry;
			browser.send(
				JSON.stringify({
					...frame,
					result: { ...snapshot, artifacts: snapshot.artifacts.map(mark) },
				}),
			);
		});
	});
}

function writeArtifactAt(root: string, path: string, minutesAgo: number): void {
	writeArtifact(root, path, `${path}\n`);
	const time = new Date(Date.now() - minutesAgo * 60_000);
	utimesSync(join(root, CONTEXT, path), time, time);
}

function folder(page: Page, path: string) {
	return page.locator(`[data-testid="artifact-folder"][data-path="${CONTEXT}/${path}"]`);
}

function folderRow(page: Page, path: string) {
	return folder(page, path).getByTestId("artifact-folder-row").first();
}

async function rowAction(page: Page, path: string, action: string): Promise<void> {
	await artifact(page, path).getByTestId("artifact-open").click({ button: "right" });
	await page.getByTestId(action).click();
}

test("the Artifacts tab keeps what the agent left: a deleted file stays restorable, the user's delete and rename stick", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifact(root, "report.md", "# Report\n");
	writeArtifact(root, "mockups/a.html", "<h1>a</h1>\n");
	await revealWorkbenchTool(page, "artifacts");
	await chooseView(page, "list");

	await expect(page.getByTestId("artifacts-filter-chat")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("artifact-row")).toHaveCount(0);
	await expect(page.getByTestId("artifacts-other-chats")).toContainText("2 more from other chats");
	await page.getByTestId("artifacts-show-all").click();
	await expect(artifact(page, "report.md")).toBeVisible();
	await expect(page.getByTestId("artifacts-other-chats")).toHaveCount(0);
	await expect(artifact(page, "report.md").locator("[title^='Changed ']")).toHaveCount(1);
	await expect(artifact(page, "report.md")).not.toContainText("just now");
	await expect(artifact(page, "mockups/a.html")).toContainText("mockups");
	await expect(page.locator('[data-testid="artifact-row"][data-path$="/.gitignore"]')).toHaveCount(
		0,
	);

	rmSync(join(root, CONTEXT, "report.md"));
	await expect(artifact(page, "report.md")).toHaveAttribute("data-state", "deleted", {
		timeout: 10_000,
	});
	await expect(artifact(page, "report.md")).toContainText("Deleted, not by you");
	await artifact(page, "report.md").getByTestId("artifact-restore").click();
	await expect(artifact(page, "report.md")).toHaveAttribute("data-state", "live");
	expect(readFileSync(join(root, CONTEXT, "report.md"), "utf8")).toBe("# Report\n");

	await rowAction(page, "report.md", "artifact-rename");
	const input = page.getByTestId("artifact-name-input");
	await input.fill("summary.md");
	await input.press("Enter");
	await expect(artifact(page, "summary.md")).toBeVisible();
	await expect(artifact(page, "report.md")).toHaveCount(0);
	expect(readFileSync(join(root, CONTEXT, "summary.md"), "utf8")).toBe("# Report\n");

	await rowAction(page, "mockups/a.html", "artifact-delete");
	await expect(page.getByTestId("confirm-dialog")).toContainText("Delete a.html?");
	await page.getByTestId("artifact-delete-confirm").click();
	await expect(artifact(page, "mockups/a.html")).toHaveCount(0);
	expect(existsSync(join(root, CONTEXT, "mockups", "a.html"))).toBe(false);

	await artifact(page, "summary.md").getByTestId("artifact-open").click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]').filter({ hasText: "summary.md" }),
	).toBeVisible();
});

test("the Tree view groups artifacts into folders, marks new and deleted ones on them, and is remembered across a reload", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifact(root, "report.md", "# Report\n");
	writeArtifact(root, "mockups/features/a.html", "<h1>a</h1>\n");
	writeArtifact(root, "mockups/features/b.png", "png\n");
	writeArtifact(root, "mockups/onboarding/c.html", "<h1>c</h1>\n");
	writeArtifact(root, "gallery/analyzers/shot.png", "png\n");
	await showArtifacts(page);
	await expect(artifact(page, "report.md")).toBeVisible();
	await expectView(page, "list");

	await chooseView(page, "tree");
	await expect(page.getByTestId("artifact-folder")).toHaveCount(2);
	await expect(folderRow(page, "gallery/analyzers")).toContainText("gallery/analyzers");
	await expect(folderRow(page, "mockups").getByTestId("artifact-folder-files")).toHaveText("3");
	await expect(artifact(page, "report.md")).toBeVisible();
	await expect(artifact(page, "mockups/features/a.html")).toHaveCount(0);
	await expect(page.getByTestId("artifacts-collapse-all")).toHaveCount(0);

	writeArtifact(root, "mockups/features/new.png", "png\n");
	await expect(folderRow(page, "mockups").getByTestId("artifact-new")).toBeVisible({
		timeout: 10_000,
	});
	await folderRow(page, "mockups").click();
	await expect(folderRow(page, "mockups").getByTestId("artifact-new")).toHaveCount(0);
	await folderRow(page, "mockups/features").click();
	await expect(artifact(page, "mockups/features/new.png")).toHaveAttribute("data-fresh", "true");
	await artifact(page, "mockups/features/a.html").getByTestId("artifact-open").click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]').filter({ hasText: "a.html" }),
	).toBeVisible();
	await expect(
		artifact(page, "mockups/features/a.html").getByTestId("artifact-open"),
	).toHaveAttribute("data-active", "true");

	rmSync(join(root, CONTEXT, "gallery"), { recursive: true });
	await expect(folder(page, "gallery/analyzers")).toHaveAttribute("data-deleted", "true", {
		timeout: 10_000,
	});
	await expect(folderRow(page, "gallery/analyzers")).toContainText("Deleted");
	await folderRow(page, "gallery/analyzers").click({ button: "right" });
	await expect(page.getByTestId("artifact-copy-relative-path")).toBeVisible();
	await expect(page.getByTestId("artifact-rename")).toHaveCount(0);
	await expect(page.getByTestId("artifact-mention")).toHaveCount(0);
	await page.keyboard.press("Escape");

	await page.reload();
	await showArtifacts(page, "remembered");
	await expectView(page, "tree");
	await expect(artifact(page, "mockups/features/a.html")).toBeVisible();
	await page.getByTestId("artifacts-collapse-all").click();
	await expect(artifact(page, "mockups/features/a.html")).toHaveCount(0);
	await expect(page.getByTestId("artifacts-collapse-all")).toHaveCount(0);

	await chooseView(page, "list");
	await expect(page.getByTestId("artifact-folder")).toHaveCount(0);
	await expect(artifact(page, "mockups/features/a.html")).toBeVisible();
});

test("a folder in the Tree offers no Delete and renames from the keyboard, its artifacts with it", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifact(root, "mockups/onboarding/c.html", "<h1>c</h1>\n");
	writeArtifact(root, "mockups/features/a.html", "<h1>a</h1>\n");
	await showArtifacts(page);
	await chooseView(page, "tree");
	await folderRow(page, "mockups").click();

	await folderRow(page, "mockups/onboarding").click({ button: "right" });
	const menu = page.getByTestId("artifact-actions");
	await expect(menu.getByTestId("artifact-mention")).toBeVisible();
	await expect(menu.getByTestId("artifact-reveal-os")).toBeVisible();
	await expect(menu.getByTestId("artifact-reveal")).toBeVisible();
	await expect(menu.getByTestId("artifact-rename")).toBeVisible();
	await expect(menu.getByTestId("artifact-delete")).toHaveCount(0);
	await expect(menu.getByTestId("artifact-menu-restore")).toHaveCount(0);
	await page.keyboard.press("Escape");

	await folderRow(page, "mockups/onboarding").focus();
	await page.keyboard.press("Delete");
	await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
	await page.keyboard.press("F2");
	const input = page.getByTestId("artifact-name-input");
	await input.fill("welcome");
	await input.press("Enter");
	await expect(folder(page, "mockups/welcome")).toBeVisible();
	await expect(folder(page, "mockups/onboarding")).toHaveCount(0);
	expect(readFileSync(join(root, CONTEXT, "mockups/welcome/c.html"), "utf8")).toBe("<h1>c</h1>\n");
});

test("a narrow Artifacts toolbar folds its actions into a More menu and keeps the view dropdown", async ({
	page,
}) => {
	await page.setViewportSize({ width: 900, height: 800 });
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeArtifact(workspace.worktreePath, "mockups/a.html", "<h1>a</h1>\n");
	await showArtifacts(page, "remembered");
	await chooseView(page, "tree");
	await folderRow(page, "mockups").click();
	await expect(artifact(page, "mockups/a.html")).toBeVisible();
	const toolbar = page.getByRole("toolbar", { name: "Artifacts" });
	await expect(toolbar).toHaveAttribute("data-fold", "1");
	await expect(page.getByTestId("artifacts-collapse-all")).toHaveCount(0);
	await expect(page.getByTestId("artifacts-view")).toBeVisible();

	await page.getByTestId("artifacts-more").click();
	await page.getByTestId("artifacts-more-collapse-all").click();
	await expect(artifact(page, "mockups/a.html")).toHaveCount(0);

	await page.setViewportSize({ width: 1600, height: 800 });
	await folderRow(page, "mockups").click();
	await expect(toolbar).toHaveAttribute("data-fold", "0");
	await expect(page.getByTestId("artifacts-collapse-all")).toBeVisible();
	await expect(page.getByTestId("artifacts-more")).toHaveCount(0);
	await expectView(page, "tree");
});

test("Outputs opens by default and lists only what the agent published, newest first, like Claude's Outputs", async ({
	page,
}) => {
	const published = new Set<string>();
	await publishOnWire(page, published);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifactAt(root, "notes.md", 30);
	writeArtifactAt(root, "mockups/_work/checkout-v1.html", 29);
	await showArtifacts(page, "remembered");
	await expectView(page, "outputs");
	await expect(page.getByTestId("artifacts-outputs-empty")).toContainText("No outputs yet");
	await page.getByTestId("artifacts-outputs-show-all").click();
	await expectView(page, "list");
	await expect(page.getByTestId("artifact-row")).toHaveCount(2);

	for (const path of [
		"round-3/FINDINGS.md",
		"proofs/NSCal.lean",
		"mockups/checkout.html",
		"round-4/BUG_REPORT_subset.md",
		"round-4/FINDINGS.md",
	])
		published.add(path);
	writeArtifactAt(root, "round-3/FINDINGS.md", 5);
	writeArtifactAt(root, "proofs/NSCal.lean", 4);
	writeArtifactAt(root, "mockups/checkout.html", 3);
	writeArtifactAt(root, "round-4/BUG_REPORT_subset.md", 2);
	writeArtifactAt(root, "round-4/FINDINGS.md", 1);
	await expect(page.getByTestId("artifact-row")).toHaveCount(7, { timeout: 10_000 });
	await chooseView(page, "outputs");
	const rows = page.getByTestId("artifact-output-file");
	await expect(rows).toHaveCount(5);
	await expect(page.getByTestId("artifacts-section")).toContainText("Outputs");
	await expect(rows.getByTestId("artifact-open")).toHaveText([
		"FINDINGSround-4MD",
		"BUG REPORT subsetMD",
		"checkoutHTML",
		"NSCal.leanFile",
		"FINDINGSround-3MD",
	]);
	await expect(page.getByTestId("artifact-new")).toHaveCount(0);
	await expect(rows.first().locator("[title^='round-4/FINDINGS.md · Changed ']")).toHaveCount(1);

	await page
		.locator(`[data-testid="artifact-output-file"][data-path="${CONTEXT}/mockups/checkout.html"]`)
		.getByTestId("artifact-open")
		.click();
	await expect(
		page
			.locator('[data-testid="editor-tab"][data-kind="file"]')
			.filter({ hasText: "checkout.html" }),
	).toBeVisible();
});

test("a present_files call shows the published files as cards in chat that open the file", async ({
	page,
}) => {
	await openFixtureProject(page);
	const root = realpathSync(E2E_FIXTURE_REPO);
	writeArtifact(root, "mockups/checkout.html", "<h1>checkout</h1>\n");
	writeArtifact(root, "round-4/BUG_REPORT_subset.md", "# Bug\n");
	const files = [`${CONTEXT}/mockups/checkout.html`, `${CONTEXT}/round-4/BUG_REPORT_subset.md`];
	const at = Date.now() - 60_000;
	seedWorkspaceSession(root, {
		name: "published outputs",
		messages: [
			{ role: "user", text: "Make the mockup.", timestamp: at },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Here it is." },
					{
						type: "toolCall",
						id: "present-1",
						name: "present_files",
						arguments: { filepaths: ["mockups/checkout.html", "round-4/BUG_REPORT_subset.md"] },
					},
				],
				stopReason: "toolUse",
				timestamp: at + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "present-1",
				toolName: "present_files",
				content: [{ type: "text", text: `Published to the user's Outputs: ${files.join(", ")}.` }],
				details: { files },
				isError: false,
				timestamp: at + 2_000,
			},
		],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "published outputs");
	const cards = page.getByTestId("tool-present-file");
	await expect(cards).toHaveCount(2);
	await expect(cards).toHaveText(["checkoutHTML", "BUG REPORT subsetMD"]);
	await cards.first().click();
	await expect(
		page
			.locator('[data-testid="editor-tab"][data-kind="file"]')
			.filter({ hasText: "checkout.html" }),
	).toBeVisible();
});

test("Smart keeps what was shown, linked, picked or published; an unmarked document is a working file", async ({
	page,
}) => {
	await publishOnWire(page, new Set(["mockups/onboarding/welcome.html"]));
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifact(root, "unattached/r.md", "# r\n");
	writeArtifact(root, "mockups/onboarding/welcome.html", "<h1>w</h1>\n");
	writeArtifact(root, "mockups/onboarding/draft.html", "<h1>d</h1>\n");
	writeArtifact(root, "mockups/onboarding/_scratch/v1.png", "png\n");
	writeArtifact(root, "loose/shot.png", "png\n");
	await showArtifacts(page, "remembered");
	await chooseView(page, "smart");

	const smartGroup = (folder: string) =>
		page.locator(`[data-testid="artifact-smart-group"][data-folder="${folder}"]`);
	await expect(page.getByTestId("artifact-smart-group")).toHaveCount(1);
	await expect(smartGroup("mockups/onboarding").getByTestId("artifact-smart-summary")).toHaveText(
		"1 result",
	);
	await smartGroup("mockups/onboarding").getByTestId("artifact-smart-group-row").click();
	await expect(artifact(page, "mockups/onboarding/welcome.html")).toBeVisible();
	await expect(artifact(page, "mockups/onboarding/draft.html")).toHaveCount(0);
	const working = smartGroup("mockups/onboarding").getByTestId("artifact-working-files");
	await expect(working).toHaveText("2 working files");
	await working.click();
	await expect(artifact(page, "mockups/onboarding/draft.html")).toBeVisible();
	await expect(folderRow(page, "mockups/onboarding/_scratch")).toBeVisible();
	await expect(page.getByTestId("artifact-unattached")).toHaveText(
		"2 working files without a result",
	);
	await page.getByTestId("artifact-unattached").click();
	await expect(folderRow(page, "loose")).toBeVisible();
	await expect(folderRow(page, "unattached")).toBeVisible();
});

test("a new artifact lights the rail until the tab is opened, and a cut file pastes into artifacts", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	await revealWorkbenchTool(page, "artifacts");
	await expect(page.getByTestId("artifacts-empty")).toBeVisible();
	await revealWorkbenchTool(page, "files");

	const dot = page.getByTestId("tool-rail-artifacts").getByTestId("artifacts-new-dot");
	await expect(dot).toHaveCount(0);
	writeArtifact(root, "notes.md", "notes\n");
	await expect(dot).toBeVisible({ timeout: 10_000 });

	await showArtifacts(page);
	await expect(artifact(page, "notes.md")).toHaveAttribute("data-fresh", "true");
	await expect(dot).toHaveCount(0);

	writeFileSync(join(root, "todo.txt"), "move me\n");
	await revealWorkbenchTool(page, "files");
	const todo = page.getByTestId("file-node").filter({ hasText: /^todo\.txt/ });
	await todo.click({ button: "right" });
	await page.getByTestId("file-tree-cut").click();
	await showArtifacts(page);
	await page.getByTestId("artifacts-paste").click();
	await expect(artifact(page, "todo.txt")).toBeVisible();
	expect(existsSync(join(root, "todo.txt"))).toBe(false);
	expect(readFileSync(join(root, CONTEXT, "todo.txt"), "utf8")).toBe("move me\n");
	await expect(page.getByTestId("artifacts-paste")).toHaveCount(0);
});

test("Mention in chat from the keyboard puts the path into the open chat's composer, closing its history", async ({
	page,
}) => {
	const workspace = await openWorkspaceChat(page);
	writeArtifact(workspace.worktreePath, "plan.md", "plan\n");
	await showArtifacts(page);
	await page.getByTestId("chat-input").focus();
	await page.keyboard.press("Control+r");
	await expect(page.getByTestId("history-overlay")).toBeVisible();
	await artifact(page, "plan.md").getByTestId("artifact-open").focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("artifact-mention").press("Enter");
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await expect(page.getByTestId("chat-input")).toHaveValue(`@${CONTEXT}/plan.md `);
});

test("a workspace without agent runs shows no ignored outputs, and its remove dialog counts its artifacts", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeArtifact(workspace.worktreePath, "a.md", "a\n");
	writeArtifact(workspace.worktreePath, "b.md", "b\n");
	await showArtifacts(page);
	await expect(page.getByTestId("artifact-row")).toHaveCount(2);
	await expect(page.getByTestId("artifacts-outputs-section")).toHaveCount(0);

	await page.getByTestId("scope-workspace").click();
	await page.getByTestId("scope-workspace-menu").getByTestId("scope-workspace-remove").click();
	await expect(page.getByTestId("remove-workspace-artifacts")).toHaveText(
		"Its 2 artifacts are deleted with it.",
	);
	await page.getByRole("button", { name: "Cancel" }).click();
});

test("F6 into the Artifacts group lands on its first row, not on its chat filter", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await publishOnWire(page, new Set(["notes.md"]));
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const root = loadPersistedWorkspaces().find((workspace) => workspace.kind === "default");
	if (!root) throw new Error("no Default workspace was persisted");
	writeArtifact(root.worktreePath, "notes.md", "notes\n");
	await revealWorkbenchTool(page, "artifacts");
	const firstRow = page.getByTestId("artifact-output-file").getByTestId("artifact-open").first();
	await expect(firstRow).toBeVisible();
	const body = page.locator('[data-tool-body="artifacts"]');
	for (let press = 0; press < 12; press++) {
		if (await body.evaluate((element) => element.contains(document.activeElement))) break;
		await page.keyboard.press("F6");
	}
	await expect(firstRow).toBeFocused();
});

test("deleting an artifact from the keyboard focuses the next artifact", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	for (const [index, name] of ["a.md", "b.md", "c.md"].entries()) {
		writeArtifact(workspace.worktreePath, name, `${name}\n`);
		const time = new Date(Date.now() - (3 - index) * 60_000);
		utimesSync(join(workspace.worktreePath, CONTEXT, name), time, time);
	}
	await showArtifacts(page);
	const open = (name: string) => artifact(page, name).getByTestId("artifact-open");
	await expect(page.getByTestId("artifact-open")).toHaveText(["c.md", "b.md", "a.md"]);

	await open("b.md").focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("artifact-delete").click();
	await page.getByTestId("artifact-delete-confirm").click();
	await expect(artifact(page, "b.md")).toHaveCount(0);
	await expect(open("a.md")).toBeFocused();

	await page.keyboard.press("Shift+F10");
	await page.getByTestId("artifact-delete").click();
	await page.getByTestId("artifact-delete-confirm").click();
	await expect(artifact(page, "a.md")).toHaveCount(0);
	await expect(open("c.md")).toBeFocused();
});

test("opening a deleted artifact restores it, once on a double click or Mod+Enter, and a failed restore opens nothing", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifact(root, "report.md", "# Report\n");
	writeArtifact(root, "notes.md", "notes\n");
	writeArtifact(root, "plan.md", "plan\n");
	await showArtifacts(page);
	await expect(artifact(page, "plan.md")).toBeVisible();
	for (const name of ["report.md", "notes.md", "plan.md"]) rmSync(join(root, CONTEXT, name));
	for (const name of ["report.md", "notes.md", "plan.md"]) {
		await expect(artifact(page, name)).toHaveAttribute("data-state", "deleted", {
			timeout: 10_000,
		});
	}
	const fileTab = (name: string) =>
		page.locator('[data-testid="editor-tab"][data-kind="file"]').filter({ hasText: name });

	await artifact(page, "report.md").getByTestId("artifact-open").dblclick();
	await expect(artifact(page, "report.md")).toHaveAttribute("data-state", "live");
	await expect(fileTab("report.md")).toHaveAttribute("data-preview", "false");
	expect(readFileSync(join(root, CONTEXT, "report.md"), "utf8")).toBe("# Report\n");
	await expect(page.getByTestId("toast")).toHaveCount(0);

	await artifact(page, "plan.md").getByTestId("artifact-open").focus();
	await page.keyboard.press("ControlOrMeta+Enter");
	await expect(artifact(page, "plan.md")).toHaveAttribute("data-state", "live");
	await expect(fileTab("plan.md")).toHaveAttribute("data-preview", "false");

	rmSync(join(E2E_DATA_DIR, "artifacts", workspace.id, "kept"), { recursive: true });
	await artifact(page, "notes.md").getByTestId("artifact-open").click();
	await expect(page.getByTestId("toast").filter({ hasText: "Couldn't restore" })).toBeVisible();
	await expect(fileTab("notes.md")).toHaveCount(0);
	expect(existsSync(join(root, CONTEXT, "notes.md"))).toBe(false);
});
