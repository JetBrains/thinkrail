import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { activeWorktreeRow } from "./fixtures/app";
import {
	E2E_PI_AGENT_DIR,
	E2E_RESTART_DATA_DIR,
	E2E_RESTART_HOST_LOG,
	E2E_RESTART_PORT,
} from "./fixtures/paths";

const PORT = E2E_RESTART_PORT;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = E2E_RESTART_DATA_DIR;
const REPO = join(DATA_DIR, "sample-project");
const AGENT_DIR = join(DATA_DIR, "pi-agent");
const HOME_DIR = join(DATA_DIR, "home");
const PICK_POINTER = join(DATA_DIR, "pick-dir");
const HOST_LOG = E2E_RESTART_HOST_LOG;
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const staticDir = join(rootDir, "apps", "web", "dist");

function seedState(): void {
	rmSync(DATA_DIR, { recursive: true, force: true });
	rmSync(HOST_LOG, { force: true });
	mkdirSync(REPO, { recursive: true });
	mkdirSync(HOME_DIR, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", REPO, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "e2e@thinkrail.test");
	git("config", "user.name", "ThinkRail E2E");
	writeFileSync(join(REPO, "README.md"), "# restart fixture\n");
	git("add", "-A");
	git("commit", "-m", "init");

	mkdirSync(AGENT_DIR, { recursive: true });
	for (const file of ["auth.json", "models.json", "settings.json"]) {
		const src = join(E2E_PI_AGENT_DIR, file);
		if (existsSync(src)) copyFileSync(src, join(AGENT_DIR, file));
	}
	writeFileSync(PICK_POINTER, REPO);
}

let host: ChildProcess | null = null;

async function startHost(): Promise<void> {
	const log = openSync(HOST_LOG, "a");
	host = spawn("bun", ["packages/server/src/dev.ts"], {
		cwd: rootDir,
		stdio: ["ignore", log, log],
		env: {
			...process.env,
			THINKRAIL_PORT: String(PORT),
			THINKRAIL_STATIC_DIR: staticDir,
			THINKRAIL_DATA_DIR: DATA_DIR,
			THINKRAIL_PICK_DIR: PICK_POINTER,
			THINKRAIL_GH_OFFLINE: "1",
			HOME: HOME_DIR,
			CLAUDE_CONFIG_DIR: join(HOME_DIR, ".claude"),
			CODEX_HOME: join(HOME_DIR, ".codex"),
			GEMINI_CLI_HOME: HOME_DIR,
			PI_CODING_AGENT_DIR: AGENT_DIR,
		},
	});
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`private e2e host did not become healthy on :${PORT} (see ${HOST_LOG})`);
}

async function stopHost(signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
	const proc = host;
	host = null;
	if (!proc || proc.exitCode !== null) return;
	const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
	proc.kill(signal);
	await exited;
}

test.afterEach(async () => {
	await stopHost();
	rmSync(DATA_DIR, { recursive: true, force: true });
});

function activeCard(page: Page) {
	return page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
}

test("a pending questionnaire survives a host kill -9: reboot, reopen, answer, agent resumes", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	seedState();
	await startHost();

	await page.goto(BASE);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1, {
		timeout: 20_000,
	});
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page
		.getByTestId("chat-input")
		.fill(
			"Call the ask_user_question tool with EXACTLY ONE single-select question (multiSelect false) offering 2 short options with descriptions and no previews. Call no other tool, and do nothing else besides asking. After I answer, reply with one short sentence.",
		);
	await page.getByTestId("chat-send").click();
	await expect(activeCard(page)).toBeVisible({ timeout: 90_000 });
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 30_000 });

	await stopHost("SIGKILL");
	await expect(page.getByTestId("connection-status")).not.toHaveAttribute(
		"data-status",
		"connected",
		{ timeout: 30_000 },
	);
	await startHost();
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await expect(activeWorktreeRow(page)).toHaveCount(1, { timeout: 15_000 });
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 30_000 });
	await card.getByTestId("ask-option").first().click();
	await card.getByTestId("ask-submit").click();

	await expect(
		page.locator('[data-testid="ask-user-question"][data-tone="answered"]').first(),
	).toBeVisible({ timeout: 60_000 });
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="system"]')
			.filter({ hasText: "Done" })
			.last(),
	).toBeVisible({ timeout: 90_000 });
	await expect(
		page.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toBeVisible();
});
