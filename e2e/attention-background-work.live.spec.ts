import { expect, type Page, test } from "@playwright/test";
import type { SessionState } from "@thinkrail/contracts";
import { activeWorktreeRow, openWorkspaceChat } from "./fixtures/app";

function observeStates(page: Page) {
	const states = new Map<string, SessionState[]>();
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			const frame = JSON.parse(payload.toString()) as {
				channel?: string;
				data?: { sessionId?: string; state?: SessionState };
			};
			const id = frame.data?.sessionId;
			if (frame.channel !== "session.state" || !id || !frame.data?.state) return;
			states.set(id, [...(states.get(id) ?? []), frame.data.state]);
		});
	});
	return (sessionId: string) => states.get(sessionId) ?? [];
}

async function currentParentId(page: Page): Promise<string> {
	const tab = page.locator('[data-testid="editor-tab"][data-kind="chat"][data-active="true"]');
	await expect(tab).toHaveAttribute("data-session-id", /.+/);
	const sessionId = await tab.getAttribute("data-session-id");
	if (!sessionId) throw new Error("Expected an attached parent chat");
	return sessionId;
}

const isIdleUnread = (state: SessionState) => state.execution === "idle" && state.completionUnread;

async function expectHeldThenLit(
	page: Page,
	states: () => SessionState[],
	finished: () => Promise<void>,
): Promise<void> {
	const row = activeWorktreeRow(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "1", { timeout: 180_000 });
	await expect.poll(() => states().at(-1)?.execution, { timeout: 120_000 }).toBe("idle");
	const launchSettled = states().length;
	expect(states().at(-1)).toMatchObject({
		execution: "idle",
		needsInput: null,
		completionUnread: false,
	});
	expect(states().at(-1)?.completion).not.toBeNull();
	await page.waitForTimeout(3_000);
	await expect(trigger).toHaveAttribute("data-active-count", "1");
	await expect(row).not.toHaveAttribute("data-attention", "true");
	await expect(row.getByTestId("attention-dot")).toHaveCount(0);

	await finished();
	await expect(trigger).toHaveAttribute("data-active-count", "0", { timeout: 180_000 });
	await expect.poll(() => states().some(isIdleUnread), { timeout: 180_000 }).toBe(true);
	await expect(row).toHaveAttribute("data-attention", "true", { timeout: 30_000 });
	await expect(row.getByTestId("attention-dot")).toHaveAttribute("aria-label", "Needs attention");

	const after = states().slice(launchSettled);
	const firstUnread = after.findIndex(isIdleUnread);
	const lastRunning = after.findLastIndex((state) => state.execution === "running");
	expect(after.slice(0, firstUnread).some((state) => state.completionUnread)).toBe(false);
	if (lastRunning !== -1) expect(firstUnread).toBeGreaterThan(lastRunning);
}

test("a running background command keeps the dot off until it finishes and the woken turn settles", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	const states = observeStates(page);
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			'Call background_command once with action start, name attention-hold, timeout 90, and command "sleep 20; printf HOLD_DONE". Then reply with the single word started. Do not call output or list, and do not wait for completion. When the completion arrives later, reply with the single word done.',
		);
	await page.getByTestId("chat-send").click();
	const sessionId = await currentParentId(page);
	await expectHeldThenLit(
		page,
		() => states(sessionId),
		async () => {
			await expect(page.getByTestId("background-command-completion")).toHaveAttribute(
				"data-status",
				"completed",
				{ timeout: 120_000 },
			);
		},
	);
});

test("a running background subagent keeps the dot off until it finishes and the woken turn settles", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(360_000);
	const states = observeStates(page);
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			'Call the Agent tool once with subagent_type "worker", run_in_background set to true, and task "Run the bash command `sleep 25`, then reply with exactly: HOLD-MARKER". Then reply with the single word started. Do NOT call get_subagent_result — the result arrives on its own. When it arrives, reply with the single word done.',
		);
	await page.getByTestId("chat-send").click();
	const sessionId = await currentParentId(page);
	await expectHeldThenLit(
		page,
		() => states(sessionId),
		async () => {
			await expect(page.getByTestId("subagent-completion")).toHaveAttribute(
				"data-status",
				"completed",
				{ timeout: 240_000 },
			);
		},
	);
});
