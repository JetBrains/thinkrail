import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { ResourceRecord, WsClientMessage, WsParams } from "@thinkrail/contracts";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	waitForAgentSettled,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

test("a restored chat reports interrupted work on the next user prompt without waking on open", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	let restoredId = "";
	let scope: WsParams<"session.resources"> | undefined;
	let starts = 0;
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			const frame = JSON.parse(payload.toString()) as {
				channel?: string;
				data?: { sessionId?: string; event?: { type?: string } };
			};
			if (
				frame.channel === "pi.event" &&
				frame.data?.sessionId === restoredId &&
				frame.data.event?.type === "agent_start"
			)
				starts++;
		});
	});
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "session.resources" && !scope) {
				const requested = frame.params as WsParams<"session.resources">;
				if (requested.sessionId !== restoredId) {
					server.send(message);
					return;
				}
				scope = requested;
				const records: ResourceRecord[] = [
					{
						kind: "command",
						summary: {
							id: "restart-command-1000",
							sessionId: restoredId,
							name: "RESTART_COMMAND_1000",
							command: "echo ORIGINAL_COMMAND_1000",
							status: "running",
							startedAt: Date.now() - 60_000,
						},
					},
					{
						kind: "subagent",
						summary: {
							childSessionId: "01a00000-0000-7000-8000-000000001000",
							parentSessionId: restoredId,
							roleName: "RESTART_CHILD_1000",
							task: "Inspect the archived schema",
							status: "running",
							detached: true,
							createdAt: new Date(Date.now() - 30_000).toISOString(),
						},
					},
				];
				const dir = join(E2E_DATA_DIR, "resource-history", scope.workspaceId, restoredId);
				mkdirSync(dir, { recursive: true });
				writeFileSync(
					join(dir, "index.jsonl"),
					`${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
				);
			}
			server.send(message);
		});
	});
	await openFixtureProject(page);
	restoredId = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Interrupted resources",
		messages: [
			{ role: "user", text: "Previous work was started.", timestamp: Date.now() - 90_000 },
		],
	}).id;
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Interrupted resources");
	await expect.poll(() => scope).toBeDefined();
	expect(starts).toBe(0);
	if (!scope) throw new Error("missing restored resource scope");
	const resourceScope = scope;
	const wire = await E2eWire.connect();
	try {
		const notices = async () =>
			(await wire.request("session.getMessages", resourceScope)).messages.filter(
				(message) =>
					message.role === "custom" && message.customType === "thinkrail/resource-interruptions",
			);
		expect(await notices()).toHaveLength(0);
		const users = await page.getByTestId("user-message-body").count();
		await page
			.getByTestId("chat-input")
			.fill(
				"Without using tools or restarting anything, repeat verbatim the names of the interrupted background work you have been told about. Do not invent task names.",
			);
		await page.getByTestId("chat-send").click();
		await waitForAgentSettled(page, 120_000);
		expect(await notices()).toHaveLength(1);
		const transcript = await wire.request("session.getMessages", resourceScope);
		const answer = JSON.stringify(
			transcript.messages.filter((message) => message.role === "assistant"),
		);
		expect(answer).toContain("RESTART_COMMAND_1000");
		expect(answer).toContain("RESTART_CHILD_1000");
		await expect(page.getByTestId("user-message-body")).toHaveCount(users + 1);
		await page.reload();
		await expect(page.getByTestId("chat-input")).toBeVisible();
		expect(await notices()).toHaveLength(1);
		await page.getByTestId("chat-input").fill("Reply with OK only. Do not use tools.");
		await page.getByTestId("chat-send").click();
		await waitForAgentSettled(page, 120_000);
		expect(await notices()).toHaveLength(1);
	} finally {
		wire.close();
	}
});
