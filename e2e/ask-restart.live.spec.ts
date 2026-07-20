import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";

// Tagged @agent: drives a real pi agent. THE restart test — the one scenario the shared-host suite
// structurally cannot cover (Playwright's webServer owns that host for the whole run): a questionnaire is
// open, the host process DIES (kill -9 — no graceful shutdown, the harshest path), a fresh host boots on
// the same on-disk state, and the questionnaire is still answerable — the answer starts a new turn and
// the agent replies. This is the end-to-end proof of the ack + terminate design (see the server
// `agent/askUserQuestion` SPEC): nothing about a pending question lives in host memory, so a restart
// costs nothing. Everything here is self-contained: a dedicated port, data dir, fixture repo, and pi
// agent dir (copied from the suite's seeded one, so the same auth + pinned model apply); the shared host
// on 24252 keeps running untouched.

const PORT = 24254; // dev 24242, shared e2e host 24252 — this suite's private host lives here
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = join(tmpdir(), "thinkrail-e2e-restart");
const REPO = join(DATA_DIR, "sample-project");
const AGENT_DIR = join(DATA_DIR, "pi-agent");
const PICK_POINTER = join(DATA_DIR, "pick-dir");
// Outside DATA_DIR so a failed run's teardown doesn't destroy the post-mortem trail.
const HOST_LOG = join(tmpdir(), "thinkrail-e2e-restart-host.log");
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const staticDir = join(rootDir, "apps", "web", "dist");

/** Fresh isolated state: a tiny git fixture repo + a pi agent dir cloned from the suite's seeded one. */
function seedState(): void {
	rmSync(DATA_DIR, { recursive: true, force: true });
	rmSync(HOST_LOG, { force: true });
	mkdirSync(REPO, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", REPO, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "e2e@thinkrail.test");
	git("config", "user.name", "ThinkRail E2E");
	writeFileSync(join(REPO, "README.md"), "# restart fixture\n");
	git("add", "-A");
	git("commit", "-m", "init");

	// Same auth + pinned default model as the shared suite (global setup seeded these from the user's).
	mkdirSync(AGENT_DIR, { recursive: true });
	for (const file of ["auth.json", "models.json", "settings.json"]) {
		const src = join(E2E_PI_AGENT_DIR, file);
		if (existsSync(src)) copyFileSync(src, join(AGENT_DIR, file));
	}
	writeFileSync(PICK_POINTER, REPO);
}

let host: ChildProcess | null = null;

/** Boot the private host and wait for /health. The web app is already built (the shared webServer did). */
async function startHost(): Promise<void> {
	const log = openSync(HOST_LOG, "a"); // post-mortem trail for a failed boot (appended across restarts)
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
			PI_CODING_AGENT_DIR: AGENT_DIR,
		},
	});
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`private e2e host did not become healthy on :${PORT} (see ${HOST_LOG})`);
}

/** Kill the private host (default SIGKILL — the crash case) and wait for the process to exit. */
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

/** The interactive (awaiting) questionnaire card. */
function activeCard(page: Page) {
	return page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
}

test("a pending questionnaire survives a host kill -9: reboot, reopen, answer, agent resumes", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000); // two host boots + two real agent turns
	seedState();
	await startHost();

	// ---- before the restart: open a chat and get a questionnaire on screen ----
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
	await page.getByTestId("start-chat").click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page
		.getByTestId("chat-input")
		.fill(
			"Call the ask_user_question tool with EXACTLY ONE single-select question (multiSelect false) offering 2 short options with descriptions and no previews. Call no other tool, and do nothing else besides asking. After I answer, reply with one short sentence.",
		);
	await page.getByTestId("chat-send").click();
	await expect(activeCard(page)).toBeVisible({ timeout: 90_000 });
	// Ack + terminate: the ask TURN is already over ("✓ Done"), so the ack tool result — everything the
	// answer path needs — is durably on disk before we pull the plug.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 30_000 });

	// ---- the restart: kill -9, then a fresh host on the same on-disk state ----
	await stopHost("SIGKILL");
	await expect(page.getByTestId("connection-status")).not.toHaveAttribute(
		"data-status",
		"connected",
		{ timeout: 30_000 },
	);
	await startHost();
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	// The project persisted but renders collapsed after a fresh load — select it to reveal its workspaces.
	await page.getByTestId("project-item").first().click();
	// The workspace persisted; its session is now DISK-ONLY (the live one died with the host), so it
	// surfaces in chat history and re-opens through the hydration path.
	await expect(page.getByTestId("workspace-item").first()).toBeVisible({ timeout: 15_000 });
	await page.getByTestId("workspace-item").first().click();
	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	// The questionnaire is STILL ANSWERABLE — the awaiting state is pure transcript, no host memory.
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 30_000 });
	await card.getByTestId("ask-option").first().click();
	await card.getByTestId("ask-submit").click();

	// The answer resolves the card into the answered record and STARTS A NEW TURN on the reborn host —
	// the agent replies with the answer in context.
	await expect(
		page.locator('[data-testid="ask-user-question"][data-tone="answered"]').first(),
	).toBeVisible({ timeout: 60_000 });
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="system"]')
			.filter({ hasText: "Done" })
			.last(),
	).toBeVisible({ timeout: 90_000 });
	// A fresh assistant reply exists below the record (the resumed turn's output).
	await expect(
		page.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toBeVisible();
});
