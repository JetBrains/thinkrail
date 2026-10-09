import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { resolveBunExecutable } from "./fixtures/executables";
import { E2E_FIXTURE_REPO, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BUN = resolveBunExecutable();
const STDIO_SERVER = fileURLToPath(
	new URL("../packages/server/src/agent/mcp/fixtures/stdioServer.ts", import.meta.url),
);
const USER_CONFIG = join(E2E_PI_AGENT_DIR, "mcp.json");
const MCP_LOG = join(E2E_PI_AGENT_DIR, "mcp.log");
const PROJECT_CONFIG_DIR = join(E2E_FIXTURE_REPO, ".pi");

async function openMcpSettings(page: Page): Promise<void> {
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.getByTestId("settings-nav-mcp").click();
	await expect(page.getByTestId("settings-mcp")).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

function serverRow(page: Page, name: string) {
	return page.locator(`[data-testid="mcp-server-row"][data-name="${name}"]`);
}

test("a stdio server added through the form connects in a chat, is disabled there, and is removed", async ({
	page,
}) => {
	rmSync(USER_CONFIG, { force: true });
	try {
		await openFixtureProject(page);
		seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: "MCP chat",
			messages: [{ role: "user", text: "Use the fixture server.", timestamp: Date.now() }],
		});
		await enterDefaultWorkspace(page);

		await openMcpSettings(page);
		const settings = page.getByTestId("settings-mcp");
		await expect(settings.getByTestId("mcp-confirm-banner")).toHaveText(
			"ThinkRail asks before MCP calls that may change data (per chat); no saved rules yet.",
		);
		await settings.getByTestId("mcp-empty-add").click();
		const dialog = page.getByTestId("mcp-add-dialog");
		await dialog.getByTestId("mcp-form-name").fill("fixture");
		await dialog.getByTestId("mcp-form-command").fill(BUN);
		await dialog.getByTestId("mcp-form-args").fill(STDIO_SERVER);
		await dialog.getByTestId("mcp-form-add-value").click();
		await dialog.getByTestId("mcp-form-value-name").fill("FIXTURE_TOKEN");
		await dialog.getByTestId("mcp-form-value-value").fill("plain-secret");
		await dialog.getByTestId("mcp-add-submit").click();
		await expect(dialog.getByRole("alert")).toContainText('"FIXTURE_TOKEN" is not a reference');
		await expect(dialog.getByTestId("mcp-run-review")).toHaveCount(0);
		await dialog.getByTestId("mcp-form-value-value").fill(`\${HOME}`);
		await dialog.getByTestId("mcp-add-submit").click();
		await expect(dialog.getByTestId("mcp-run-item")).toContainText(STDIO_SERVER);
		await dialog.getByTestId("mcp-add-confirm").click();
		await expect(dialog).toBeHidden();
		await expect(settings.getByTestId("mcp-feedback")).toHaveText(
			"Saved — applies when a chat starts in this workspace.",
		);

		const row = serverRow(page, "fixture");
		await expect(row.getByTestId("mcp-server-scope")).toHaveText("User");
		await expect(row.getByTestId("mcp-server-transport")).toContainText("stdio");
		await expect(row.getByTestId("mcp-server-status")).toHaveText("Not running");
		await closeSettings(page);

		await openPersistedChat(page, "MCP chat");
		await openMcpSettings(page);
		await expect(row.getByTestId("mcp-server-status")).toHaveText("Connected · 4 tools", {
			timeout: 30_000,
		});
		await closeSettings(page);

		await page.getByTestId("resources-trigger").click();
		const inspector = page.getByTestId("resources-inspector");
		const chatRow = inspector.locator('[data-testid="resource-mcp"][data-name="fixture"]');
		await expect(chatRow.getByTestId("resource-mcp-state")).toHaveText("Connected · 4 tools", {
			timeout: 30_000,
		});
		await chatRow.getByTestId("resource-mcp-disable").click();
		await expect(chatRow).toHaveAttribute("data-state", "disabled-in-chat", { timeout: 30_000 });
		await expect(chatRow.getByTestId("resource-mcp-state")).toHaveText("Disabled in this chat");
		await expect(chatRow.getByTestId("resource-mcp-enable")).toBeVisible();
		await inspector.getByTestId("resources-inspector-close").click();

		await openMcpSettings(page);
		await row.getByTestId("mcp-server-menu").click();
		const edit = page.getByTestId("mcp-menu-edit");
		await expect(edit).toHaveAttribute("data-disabled", "");
		await expect(edit).toContainText("mcp.json directly");
		await page.getByTestId("mcp-menu-remove").click();
		await page.getByTestId("mcp-remove-confirm").click();
		await expect(row).toHaveCount(0);
		await expect(page.getByTestId("mcp-empty")).toBeVisible();
	} finally {
		rmSync(USER_CONFIG, { force: true });
	}
});

test("a not-running server opens a chat; a failed one reconnects per chat and shows its masked log", async ({
	page,
}) => {
	writeFileSync(
		USER_CONFIG,
		JSON.stringify({
			mcpServers: {
				broken: { command: BUN, args: ["-e", "console.error('fixture boom'); process.exit(1)"] },
			},
		}),
	);
	writeFileSync(
		MCP_LOG,
		[
			"2026-10-08T09:00:00.000Z [broken] error fixture log line api_key=fixture-log-secret",
			"2026-10-08T09:00:01.000Z [other] info unrelated line",
			"",
		].join("\n"),
	);
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openMcpSettings(page);
		const row = serverRow(page, "broken");
		await expect(row).toHaveAttribute("data-state", "not-running");
		const openChat = row.getByTestId("mcp-server-action");
		await expect(openChat).toHaveAttribute("data-action", "open-chat");
		await openChat.click();
		await expect(page.getByTestId("settings-dialog")).toBeHidden();
		await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

		await openMcpSettings(page);
		await expect(row).toHaveAttribute("data-state", "failed", { timeout: 30_000 });
		const reconnect = row.getByTestId("mcp-server-action");
		await expect(reconnect).toHaveAttribute("data-action", "reconnect");
		await reconnect.click();
		await expect(row.getByRole("alert")).toContainText("failed to connect", { timeout: 30_000 });

		const showLog = row.getByTestId("mcp-server-secondary");
		await expect(showLog).toHaveAttribute("data-action", "show-log");
		await showLog.click();
		const log = page.getByTestId("mcp-log-dialog");
		await expect(log.getByTestId("mcp-log-report")).toContainText("fixture boom");
		await expect(log.getByTestId("mcp-log-text")).toHaveText(
			"2026-10-08T09:00:00.000Z [broken] error fixture log line api_key=***",
		);
		await expect(log).toContainText(MCP_LOG);
		await expect(log).not.toContainText("fixture-log-secret");
		await expect(log).not.toContainText("unrelated line");
	} finally {
		rmSync(USER_CONFIG, { force: true });
		rmSync(MCP_LOG, { force: true });
	}
});

test("an unreadable user mcp.json is named in Settings with an edit hint while no server parses", async ({
	page,
}) => {
	writeFileSync(USER_CONFIG, '{ "mcpServers": { "fixture": ');
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openMcpSettings(page);
		const settings = page.getByTestId("settings-mcp");
		const notice = settings.getByTestId("mcp-config-error");
		await expect(notice).toHaveAttribute("data-source", USER_CONFIG);
		await expect(notice).toContainText(`Problem in ${USER_CONFIG}`);
		await expect(notice).toContainText("Edit the file directly");
		await expect(settings.getByTestId("mcp-empty")).toBeVisible();
	} finally {
		rmSync(USER_CONFIG, { force: true });
	}
});

test("a repository-defined server flags the chat, waits for approval and starts once approved", async ({
	page,
}) => {
	mkdirSync(PROJECT_CONFIG_DIR, { recursive: true });
	writeFileSync(
		join(PROJECT_CONFIG_DIR, "mcp.json"),
		JSON.stringify(
			{
				mcpServers: {
					"repo-fixture": {
						command: BUN,
						args: [STDIO_SERVER, "--api-key", "fixture-arg-secret"],
						env: { FIXTURE_HOME: `\${HOME}`, FIXTURE_SECRET: "fixture-literal-secret" },
					},
				},
			},
			null,
			2,
		),
	);
	try {
		await openFixtureProject(page);
		const notice = page.getByTestId("project-trust-notice");
		await expect(notice.getByTestId("project-trust-enables")).toContainText(
			"run code on this machine",
		);
		await notice.getByTestId("project-trust-button").click();
		await expect(notice).toHaveAttribute("data-state", "trusted");
		await notice.getByTestId("project-untrust-button").click();
		await page.getByTestId("project-untrust-confirm").click();
		await expect(notice).toHaveAttribute("data-state", "untrusted");
		await notice.getByTestId("project-trust-button").click();
		await expect(notice).toHaveAttribute("data-state", "trusted");
		seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: "Repo MCP chat",
			messages: [{ role: "user", text: "Use the repository server.", timestamp: Date.now() }],
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "Repo MCP chat");

		const attention = page.getByTestId("resources-mcp-attention");
		await expect(attention).toHaveAttribute("data-count", "1", { timeout: 30_000 });
		await attention.click();
		await expect(page.getByTestId("settings-mcp")).toBeVisible();
		const row = serverRow(page, "repo-fixture");
		await expect(row).toHaveAttribute("data-state", "pending-approval");
		await expect(row.getByTestId("mcp-server-scope")).toHaveText("Project");
		await expect(row.getByTestId("mcp-server-status")).toHaveText("Pending approval");
		await expect(row.getByTestId("mcp-server-toggle")).toBeDisabled();

		await row.getByTestId("mcp-server-action").click();
		const dialog = page.getByTestId("mcp-approve-dialog");
		await expect(dialog.getByTestId("mcp-approve-run")).toContainText(
			`${STDIO_SERVER} --api-key ***`,
		);
		const env = dialog.getByTestId("mcp-approve-env");
		await expect(env).toContainText(`FIXTURE_HOME=\${HOME}`);
		await expect(env).toContainText("FIXTURE_SECRET=<literal value hidden>");
		await expect(dialog).not.toContainText("fixture-literal-secret");
		await expect(dialog).not.toContainText("fixture-arg-secret");
		await dialog.getByTestId("mcp-approve-confirm").click();
		await expect(dialog).toBeHidden();

		await expect(row.getByTestId("mcp-server-status")).toHaveText("Connected · 4 tools", {
			timeout: 30_000,
		});
		await expect(row.getByTestId("mcp-server-toggle")).toBeEnabled();
		await row.getByTestId("mcp-server-menu").click();
		await page.getByTestId("mcp-menu-edit").click();
		const editor = page.getByTestId("mcp-edit-dialog");
		await expect(editor.getByTestId("mcp-edit-input")).toHaveValue(
			/"FIXTURE_SECRET": "<literal value hidden>"/,
		);
		await expect(editor.getByTestId("mcp-edit-input")).not.toHaveValue(/fixture-literal-secret/);
		await editor.getByRole("button", { name: "Cancel" }).click();
		await expect(editor).toBeHidden();
		await closeSettings(page);
		await expect(attention).toHaveCount(0, { timeout: 30_000 });
	} finally {
		rmSync(PROJECT_CONFIG_DIR, { recursive: true, force: true });
	}
});
