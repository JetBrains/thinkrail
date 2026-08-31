import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "@playwright/test";
import { isSubagentCompletionMessage } from "@thinkrail/contracts";
import {
	openWorkspaceChat,
	openWorkspaceMenu,
	waitForAgentSettled,
	worktreeRows,
} from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";

const agentCards = '[data-testid="tool-card"][data-tool="Agent"]';

function e2eSessionDirectory(cwd: string): string {
	const safeCwd = resolve(cwd)
		.replace(/^[/\\]/, "")
		.replace(/[/\\:]/g, "-");
	return join(E2E_PI_AGENT_DIR, "sessions", `--${safeCwd}--`);
}

async function persistedCompletionCount(cwd: string, sessionId: string): Promise<number> {
	const info = (await SessionManager.list(cwd, e2eSessionDirectory(cwd))).find(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!info) return 0;
	return buildSessionContext(SessionManager.open(info.path).getEntries()).messages.filter(
		isSubagentCompletionMessage,
	).length;
}

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function stopFixtureProcess(pid: number): Promise<void> {
	if (!processIsRunning(pid)) return;
	try {
		process.kill(pid, "SIGTERM");
	} catch {}
	await expect
		.poll(() => processIsRunning(pid), { timeout: 5_000 })
		.toBe(false)
		.catch(() => {});
	if (!processIsRunning(pid)) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch {}
	await expect.poll(() => processIsRunning(pid), { timeout: 5_000 }).toBe(false);
}

test("foreground parallel fan-out: live Agent cards, report fold, child transcript dialog", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			'Call the Agent tool TWICE in this single reply (two tool calls in one message): both with subagent_type "echo", one with task "Reply with exactly: ALPHA-MARKER", the other with task "Reply with exactly: BRAVO-MARKER". After both return, reply with the single word done.',
		);
	await page.getByTestId("chat-send").click();

	const cards = page.locator(agentCards);
	await expect(cards).toHaveCount(2, { timeout: 180_000 });
	await expect(cards.first()).toHaveAttribute("data-status", "done", { timeout: 180_000 });
	await expect(cards.nth(1)).toHaveAttribute("data-status", "done", { timeout: 180_000 });
	await waitForAgentSettled(page, 120_000);

	const header = cards.first().getByTestId("tool-card-toggle");
	await expect(header).toContainText("echo");
	await expect(header).toContainText("turn");

	await header.click();
	const body = cards.first().getByTestId("tool-agent");
	await expect(body).toBeVisible();
	await body.getByTestId("agent-report-toggle").click();
	await expect(body.getByTestId("agent-report")).toContainText(/(ALPHA|BRAVO)-MARKER/);

	await body.getByTestId("agent-open-transcript").click();
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toBeVisible();
	const transcript = dialog.getByTestId("subagent-transcript");
	await expect(transcript.locator('[data-testid="chat-message"][data-role="user"]')).toContainText(
		/Reply with exactly: (ALPHA|BRAVO)-MARKER/,
		{ timeout: 15_000 },
	);
	await expect(
		transcript.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toContainText(/(ALPHA|BRAVO)-MARKER/);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
});

test("background run: completion card arrives live, with report + transcript", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			'Call the Agent tool once with subagent_type "echo", task "Reply with exactly: CHARLIE-MARKER", and run_in_background set to true. Then reply with the single word started. Do NOT call get_subagent_result — the result arrives on its own.',
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator(agentCards).first();
	await expect(card).toHaveAttribute("data-status", "done", { timeout: 180_000 });

	const completion = page.getByTestId("subagent-completion");
	await expect(completion).toBeVisible({ timeout: 180_000 });
	await expect(completion).toHaveAttribute("data-status", "completed");
	await expect(completion).toContainText("echo finished");

	await completion.getByTestId("subagent-completion-report-toggle").click();
	await expect(completion.getByTestId("subagent-completion-report")).toContainText(
		"CHARLIE-MARKER",
	);

	await completion.getByTestId("subagent-completion-transcript").click();
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toBeVisible();
	await expect(
		dialog
			.getByTestId("subagent-transcript")
			.locator('[data-testid="chat-message"][data-role="assistant"]')
			.last(),
	).toContainText("CHARLIE-MARKER", { timeout: 15_000 });
});

test("a live background transcript can stop its child without duplicate completion", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	const workspace = await openWorkspaceChat(page);
	const parentSessionId = await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.getAttribute("data-session-id");
	if (!parentSessionId) throw new Error("Subagent test chat is missing its session id");
	const marker = join(workspace.worktreePath, ".e2e-subagent-running");
	const helper = join(workspace.worktreePath, ".e2e-subagent-helper.mjs");
	writeFileSync(
		helper,
		`import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, String(process.pid));
setInterval(() => {}, 1000);
`,
	);
	const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(helper)}`;
	let childPid: number | undefined;
	try {
		await page
			.getByTestId("chat-input")
			.fill(
				`Call the Agent tool once with subagent_type "slow", task ${JSON.stringify(`Run this exact shell command and wait for it to exit before replying: ${command}`)}, and run_in_background set to true. Then reply with the single word started. Do NOT call get_subagent_result.`,
			);
		await page.getByTestId("chat-send").click();

		const card = page.locator(agentCards).first();
		await expect(card).toHaveAttribute("data-status", "done", { timeout: 180_000 });
		await waitForAgentSettled(page, 120_000);
		await expect.poll(() => existsSync(marker), { timeout: 120_000 }).toBe(true);
		const observedChildPid = Number(readFileSync(marker, "utf8"));
		expect(Number.isSafeInteger(observedChildPid) && observedChildPid > 0).toBe(true);
		childPid = observedChildPid;

		await card.getByTestId("tool-card-toggle").click();
		const body = card.getByTestId("tool-agent");
		await expect(body).toHaveAttribute("data-status", /^(queued|running)$/);
		await body.getByTestId("agent-open-transcript").click();

		const dialog = page.getByTestId("subagent-transcript-dialog");
		await expect(dialog).toBeVisible();
		const stop = dialog.getByTestId("subagent-stop");
		await expect(stop).toBeVisible({ timeout: 15_000 });
		await stop.click();
		await expect(stop).toHaveCount(0, { timeout: 30_000 });
		await expect.poll(() => processIsRunning(observedChildPid), { timeout: 30_000 }).toBe(false);
		childPid = undefined;
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();

		const completions = page.getByTestId("subagent-completion");
		await expect(async () => {
			const latest = page.getByTestId("scroll-to-bottom");
			if (await latest.isVisible()) await latest.click();
			await expect(completions.first()).toBeVisible();
		}).toPass({ timeout: 120_000 });
		await expect(completions.first()).toHaveAttribute("data-status", "aborted");
		await waitForAgentSettled(page, 120_000);
		await expect
			.poll(() => persistedCompletionCount(workspace.worktreePath, parentSessionId), {
				timeout: 15_000,
			})
			.toBe(1);
	} finally {
		await page.keyboard.press("Escape").catch(() => {});
		const row = worktreeRows(page).filter({ hasText: workspace.name });
		if ((await row.count()) > 0) {
			await openWorkspaceMenu(row).catch(() => {});
			await page
				.getByTestId("workspace-remove")
				.click()
				.catch(() => {});
			await page
				.getByTestId("confirm-remove")
				.click()
				.catch(() => {});
		}
		if (childPid !== undefined) await stopFixtureProcess(childPid);
		rmSync(marker, { force: true });
		rmSync(helper, { force: true });
	}
});
