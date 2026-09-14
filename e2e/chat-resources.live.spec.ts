import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";
import { shot } from "./fixtures/screenshots";

const commandRows = '[data-testid="resource-command"]';
const childRows = '[data-testid="resource-subagent"]';

function observeParentStarts(page: Page) {
	const starts = new Map<string, number>();
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			const frame = JSON.parse(payload.toString()) as {
				channel?: string;
				data?: { sessionId?: string; event?: { type?: string } };
			};
			const id = frame.data?.sessionId;
			if (frame.channel === "pi.event" && id && frame.data?.event?.type === "agent_start") {
				starts.set(id, (starts.get(id) ?? 0) + 1);
			}
		});
	});
	return (sessionId: string) => starts.get(sessionId) ?? 0;
}

async function currentParentId(page: Page): Promise<string> {
	const tab = page.locator('[data-testid="editor-tab"][data-kind="chat"][data-active="true"]');
	const sessionId = await tab.getAttribute("data-session-id");
	if (!sessionId) throw new Error("Expected an attached parent chat");
	return sessionId;
}

async function send(page: Page, prompt: string) {
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function openResources(page: Page) {
	const popover = page.getByTestId("resources-popover");
	if (!(await popover.isVisible())) await page.getByTestId("resources-trigger").click();
	await expect(popover).toBeVisible();
	return popover;
}

test("command logs and Stop stay scoped through parent Stop, view closure, reload and another chat", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	const starts = observeParentStarts(page);
	await openWorkspaceChat(page);
	const command =
		"i=0; while [ $i -lt 2100 ]; do printf 'line-%s\\n' \"$i\"; i=$((i+1)); done; printf '<script>RESOURCE_SAFE</script>\\nWATCH_READY\\n'; sleep 180";
	await send(
		page,
		`This is an execution-lifecycle probe, not a coding task. Call background_command exactly once with action start, name resource-watch, timeout 240 and command ${JSON.stringify(command)}. After that tool acknowledges start, call the ordinary bash tool with command "sleep 180". Do not launch other commands or subagents.`,
	);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "1", { timeout: 180_000 });
	await expect(page.locator('[data-testid="activity-step"][data-tool="bash"]')).toHaveAttribute(
		"data-status",
		"running",
		{ timeout: 120_000 },
	);
	const parentId = await currentParentId(page);
	await openResources(page);
	const row = page.locator(commandRows).filter({ hasText: "resource-watch" });
	await expect(row).toHaveAttribute("data-status", "running");
	const commandId = await row.getAttribute("data-resource-id");
	expect(commandId).toBeTruthy();
	await row.getByTestId("resource-logs").click();
	await expect(page.getByTestId("resources-popover")).not.toBeVisible();
	const logs = page.getByTestId("command-log-dialog");
	const output = logs.getByTestId("command-log-output");
	await expect(output).toContainText("WATCH_READY");
	await expect(output).toContainText("<script>RESOURCE_SAFE</script>");
	await expect(output.locator("script")).toHaveCount(0);
	await expect(logs).toContainText(/truncat|bounded tail/i);
	await shot(logs, "chat-resources", "running-command-logs");
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();

	await page.getByTestId("chat-abort").click();
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false", {
		timeout: 30_000,
	});
	await expect(trigger).toHaveAttribute("data-active-count", "1");
	const parentTab = page.locator(`[data-testid="editor-tab"][data-session-id="${parentId}"]`);
	await parentTab.getByTestId("editor-tab-close").click();
	await expect(parentTab).toHaveCount(0);
	await page.getByTestId("chat-history").first().click();
	await page.locator(`[data-testid="closed-chat-item"][data-session-id="${parentId}"]`).click();
	await expect(trigger).toHaveAttribute("data-active-count", "1");
	await page.reload();
	await expect(trigger).toHaveAttribute("data-active-count", "1");

	await page.getByTestId("new-chat").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	await expect(parentTab).toHaveAttribute("data-active", "false");
	await send(page, "Reply with exactly SECOND_CHAT. Do not use any tools.");
	await waitForAgentSettled(page, 120_000);
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await openResources(page);
	await expect(page.locator(commandRows)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await parentTab.locator("button").first().click();
	await expect(trigger).toHaveAttribute("data-active-count", "1");
	const turnsBeforeStop = starts(parentId);
	expect(turnsBeforeStop).toBeGreaterThan(0);
	await openResources(page);
	await expect(row).toHaveAttribute("data-resource-id", commandId ?? "");
	await row.getByTestId("resource-stop").click();
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await page.getByTestId("resources-finished-toggle").click();
	await expect(row).toHaveAttribute("data-status", "stopped");
	await expect(row.getByTestId("resource-stop")).toHaveCount(0);
	await shot(page.getByTestId("resources-popover"), "chat-resources", "stopped-command");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("background-command-completion")).toHaveAttribute(
		"data-status",
		"stopped",
	);
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false");
	expect(starts(parentId)).toBe(turnsBeforeStop);
});

test("natural command completion refreshes the closed popover and survives transcript hydration", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	await openWorkspaceChat(page);
	await send(
		page,
		'Call background_command once with action start, name resource-finish, timeout 60, and command "sleep 12; printf RESOURCE_DONE". Then reply with the single word started. Do not call output or list, and do not wait for completion.',
	);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "1", { timeout: 180_000 });
	await openResources(page);
	await expect(page.locator(commandRows)).toHaveAttribute("data-status", "running");
	await page.keyboard.press("Escape");
	await expect(trigger).toHaveAttribute("data-active-count", "0", { timeout: 60_000 });
	await expect(page.getByTestId("background-command-completion")).toHaveAttribute(
		"data-status",
		"completed",
		{ timeout: 60_000 },
	);
	await waitForAgentSettled(page, 120_000);
	await openResources(page);
	await page.getByTestId("resources-finished-toggle").click();
	const row = page.locator(commandRows).filter({ hasText: "resource-finish" });
	await expect(row).toHaveAttribute("data-status", "completed");
	await row.getByTestId("resource-logs").click();
	await expect(page.getByTestId("command-log-output")).toContainText("RESOURCE_DONE");
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(page.getByTestId("background-command-completion")).toHaveAttribute(
		"data-status",
		"completed",
	);
	await expect(trigger).toHaveAttribute("data-active-count", "0");
});

test("individual subagent Stop and confirmed Stop all retain transcripts without waking the parent", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(360_000);
	const starts = observeParentStarts(page);
	await openWorkspaceChat(page);
	await send(
		page,
		'Call Agent TWICE in one reply with subagent_type "worker" and run_in_background true. First task: "RESOURCE_CHILD_A: Monitor README.md for new lines with the foreground bash command tail -n 0 -f README.md, without a timeout. Keep monitoring until the user stops you through the Resources UI; do not stop yourself or modify files." Second task: "RESOURCE_CHILD_B: Monitor README.md for new lines with the foreground bash command tail -n 0 -f README.md, without a timeout. Keep monitoring until the user stops you through the Resources UI; do not stop yourself or modify files." These are explicitly authorized long-lived file watchers for a user-driven cancellation test. After both starts are acknowledged, reply with exactly READY. Do not wait or call get_subagent_result.',
	);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "2", { timeout: 180_000 });
	await waitForAgentSettled(page, 120_000);
	const parentId = await currentParentId(page);
	const turnsBeforeStop = starts(parentId);
	expect(turnsBeforeStop).toBeGreaterThan(0);
	await openResources(page);
	const first = page.locator(childRows).filter({ hasText: "RESOURCE_CHILD_A" });
	await first.getByTestId("resource-transcript").click();
	await expect(page.getByTestId("resources-popover")).not.toBeVisible();
	const transcript = page.getByTestId("subagent-transcript-dialog");
	await expect(transcript).toContainText("RESOURCE_CHILD_A", { timeout: 30_000 });
	await shot(transcript, "chat-resources", "active-subagent-transcript");
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
	await openResources(page);
	await expect(first.getByTestId("resource-stop")).toBeEnabled();
	await first.getByTestId("resource-stop").click();
	await expect(trigger).toHaveAttribute("data-active-count", "1");
	await page.getByTestId("resources-stop-all").click();
	const confirm = page.getByTestId("resources-stop-all-confirm");
	await expect(confirm).toContainText("1");
	await page.keyboard.press("Escape");
	await expect(confirm).not.toBeVisible();
	await expect(trigger).toHaveAttribute("data-active-count", "1");
	await openResources(page);
	await page.getByTestId("resources-stop-all").click();
	await confirm.click();
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await expect(confirm).not.toBeVisible();
	await openResources(page);
	await page.getByTestId("resources-finished-toggle").click();
	await expect(page.locator(`${childRows}[data-status="aborted"]`)).toHaveCount(2);
	await expect(page.locator(childRows).getByTestId("resource-stop")).toHaveCount(0);
	await shot(page.getByTestId("resources-popover"), "chat-resources", "stopped-subagents");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("subagent-completion")).toHaveCount(2);
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false");
	expect(starts(parentId)).toBe(turnsBeforeStop);

	await send(
		page,
		'Call Agent once with subagent_type "echo", task "Reply with exactly RESOURCE_REUSE_OK", and run_in_background false. Then reply done.',
	);
	await openResources(page);
	await page.getByTestId("resources-finished-toggle").click();
	const reused = page.locator(childRows).filter({ hasText: "RESOURCE_REUSE_OK" });
	await expect(reused).toHaveAttribute("data-status", "completed", { timeout: 180_000 });
	await waitForAgentSettled(page, 120_000);
	await reused.getByTestId("resource-transcript").click();
	await expect(page.getByTestId("subagent-transcript-dialog")).toContainText("RESOURCE_REUSE_OK");
});
