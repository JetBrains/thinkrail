import { type ChildProcess, spawn } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { jbcentralExtensionPath } from "@thinkrail/shared/jbcentral";
import { stripAmbientPiCredentials } from "./ambientCredentials";
import { activeWorktreeRow } from "./fixtures/app";
import {
	CENTRAL_STUB_READ_ONLY_ENV,
	CentralSetupError,
	REAL_CENTRAL_E2E_ENV,
	removeLocalAgentModelAndAuth,
	restoreStagedCentralArtifact,
	waitForCentralTarget,
} from "./fixtures/centralAgent";
import { hermeticE2ePath, resolveBunExecutable } from "./fixtures/executables";
import { gitQuiet } from "./fixtures/git";
import {
	E2E_CENTRAL_BAD_EXTENSION_SOURCE,
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_FAKE_BIN_DIR,
	E2E_PI_AGENT_DIR,
	E2E_RESTART_DATA_DIR,
	E2E_RESTART_HOST_LOG,
	E2E_RESTART_PORT,
} from "./fixtures/paths";
import { E2eWire, E2eWireTransientError } from "./fixtures/wire";

const PORT = E2E_RESTART_PORT;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = E2E_RESTART_DATA_DIR;
const REPO = join(DATA_DIR, "sample-project");
const AGENT_DIR = join(DATA_DIR, "pi-agent");
const HOME_DIR = join(DATA_DIR, "home");
const PICK_POINTER = join(DATA_DIR, "pick-dir");
const HOST_LOG = E2E_RESTART_HOST_LOG;
const CENTRAL_STATE = join(DATA_DIR, "central-state");
const CENTRAL_LOG = join(DATA_DIR, "central-invocations.log");
const CENTRAL_ARTIFACT = jbcentralExtensionPath({
	env: { HOME: HOME_DIR, USERPROFILE: HOME_DIR },
});
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const staticDir = join(rootDir, "apps", "web", "dist");
const bunExecutable = resolveBunExecutable();
const hostPath = hermeticE2ePath(E2E_FAKE_BIN_DIR);

function seedState(): void {
	rmSync(DATA_DIR, { recursive: true, force: true });
	rmSync(HOST_LOG, { force: true });
	mkdirSync(REPO, { recursive: true });
	mkdirSync(HOME_DIR, { recursive: true });
	gitQuiet(REPO, "init", "-b", "main");
	gitQuiet(REPO, "config", "user.email", "e2e@thinkrail.test");
	gitQuiet(REPO, "config", "user.name", "ThinkRail E2E");
	gitQuiet(REPO, "config", "commit.gpgsign", "false");
	writeFileSync(join(REPO, "README.md"), "# restart fixture\n");
	gitQuiet(REPO, "add", "-A");
	gitQuiet(REPO, "commit", "-m", "init");

	mkdirSync(AGENT_DIR, { recursive: true });
	const settingsSource = join(E2E_PI_AGENT_DIR, "settings.json");
	if (!existsSync(settingsSource)) throw new Error("Central E2E settings seed is missing");
	const settingsTarget = join(AGENT_DIR, "settings.json");
	copyFileSync(settingsSource, settingsTarget);
	chmodSync(settingsTarget, 0o600);
	removeLocalAgentModelAndAuth(AGENT_DIR);
	restoreStagedCentralArtifact(CENTRAL_ARTIFACT);
	writeFileSync(CENTRAL_STATE, "");
	writeFileSync(PICK_POINTER, REPO);
}

let host: ChildProcess | null = null;

async function startHost(): Promise<void> {
	const log = openSync(HOST_LOG, "a");
	host = spawn(bunExecutable, ["packages/server/src/dev.ts"], {
		cwd: rootDir,
		stdio: ["ignore", log, log],
		env: stripAmbientPiCredentials({
			...process.env,
			THINKRAIL_PORT: String(PORT),
			THINKRAIL_STATIC_DIR: staticDir,
			THINKRAIL_DATA_DIR: DATA_DIR,
			THINKRAIL_PICK_DIR: PICK_POINTER,
			THINKRAIL_GH_OFFLINE: "1",
			THINKRAIL_NO_ANALYTICS: "1",
			[REAL_CENTRAL_E2E_ENV]: "1",
			HOME: HOME_DIR,
			USERPROFILE: HOME_DIR,
			CLAUDE_CONFIG_DIR: join(HOME_DIR, ".claude"),
			CODEX_HOME: join(HOME_DIR, ".codex"),
			GEMINI_CLI_HOME: HOME_DIR,
			PI_CODING_AGENT_DIR: AGENT_DIR,
			PI_OFFLINE: "1",
			PATH: hostPath,
			CENTRAL_STUB_STATE: CENTRAL_STATE,
			CENTRAL_STUB_LOG: CENTRAL_LOG,
			CENTRAL_STUB_EXTENSION_SOURCE: E2E_CENTRAL_EXTENSION_SOURCE,
			CENTRAL_STUB_BAD_EXTENSION_SOURCE: E2E_CENTRAL_BAD_EXTENSION_SOURCE,
			[CENTRAL_STUB_READ_ONLY_ENV]: "1",
		}),
	});
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		let healthy = false;
		try {
			healthy = (await fetch(`${BASE}/health`)).ok;
		} catch {}
		if (healthy) {
			let wire: E2eWire;
			try {
				wire = await E2eWire.connect(PORT);
			} catch (error) {
				if (!(error instanceof E2eWireTransientError)) throw error;
				await new Promise((resolve) => setTimeout(resolve, 250));
				continue;
			}
			try {
				await waitForCentralTarget(wire);
				removeLocalAgentModelAndAuth(AGENT_DIR);
				return;
			} catch (error) {
				if (error instanceof CentralSetupError) throw error;
				if (!(error instanceof E2eWireTransientError)) throw error;
			} finally {
				wire.close();
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
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

function persistedWorkspaceId(): string {
	const workspaces = JSON.parse(
		readFileSync(join(DATA_DIR, "workspaces.json"), "utf8"),
	) as Workspace[];
	const nonDefault = workspaces.filter((workspace) => workspace.kind !== "default");
	const workspace = nonDefault[0];
	if (nonDefault.length !== 1 || !workspace) {
		throw new Error(`Expected one persisted non-default workspace, found ${nonDefault.length}`);
	}
	return workspace.id;
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
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false", {
		timeout: 30_000,
	});

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
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toHaveCount(1);
	const sessionId = await chatTab.getAttribute("data-session-id");
	if (!sessionId) throw new Error("Restarted chat tab is missing its session id");
	const workspaceId = persistedWorkspaceId();
	const wire = await E2eWire.connect(PORT);
	try {
		const before = await wire.request("session.getMessages", { sessionId, workspaceId });
		const assistantCount = before.messages.filter((message) => message.role === "assistant").length;
		const card = activeCard(page);
		await expect(card).toBeVisible({ timeout: 30_000 });
		await card.getByTestId("ask-option").first().click();
		await card.getByTestId("ask-submit").click();

		await expect(
			page.locator('[data-testid="ask-user-question"][data-tone="answered"]').first(),
		).toBeVisible({ timeout: 60_000 });
		await expect
			.poll(
				async () => {
					const transcript = await wire.request("session.getMessages", {
						sessionId,
						workspaceId,
					});
					return transcript.messages.filter((message) => message.role === "assistant").length;
				},
				{ timeout: 90_000 },
			)
			.toBeGreaterThan(assistantCount);
		await expect
			.poll(
				async () =>
					(
						await wire.request("session.getMessages", {
							sessionId,
							workspaceId,
						})
					).summary.isStreaming,
				{ timeout: 30_000 },
			)
			.toBe(false);
	} finally {
		wire.close();
	}
});
