import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	CHAT_RESOURCES_PROTOCOL_VERSION,
	type ResourceRecord,
	type SessionResources,
	type WsClientMessage,
	type WsParams,
	type WsResult,
} from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

async function openResourceChat(page: Page) {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Resource UI",
		messages: [{ role: "user", text: "Inspect this chat's resources.", timestamp: Date.now() }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Resource UI");
	await expect(page.getByTestId("chat-toolbar")).toBeVisible();
}

async function observeResourceWire(
	page: Page,
	options: { protocolVersion?: number; completedChildId?: string } = {},
) {
	let protocolVersion = options.protocolVersion;
	let reads = 0;
	let welcomes = 0;
	let resourceScope: WsParams<"session.resources"> | undefined;
	const transcriptRequests: WsParams<"subagent.getTranscript">[] = [];
	let disconnect = () => {};
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		disconnect = () => browser.close({ code: 1012, reason: "Reconnect probe" });
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "session.resources") {
				reads++;
				resourceScope = frame.params as WsParams<"session.resources">;
				if (options.completedChildId) {
					const result: SessionResources = {
						...resourceScope,
						commands: [],
						subagents: [
							{
								childSessionId: options.completedChildId,
								parentSessionId: resourceScope.sessionId,
								task: "Focus fixture",
								status: "completed",
								createdAt: "2026-01-01T00:00:00.000Z",
								model: "acme/reviewer-1",
								thinkingLevel: "high",
								durationMs: 7 * 60_000,
							},
						],
					};
					browser.send(JSON.stringify({ id: frame.id, ok: true, result }));
					return;
				}
			}
			if (
				"method" in frame &&
				frame.method === "subagent.getTranscript" &&
				options.completedChildId
			) {
				transcriptRequests.push(frame.params as WsParams<"subagent.getTranscript">);
				const result: WsResult<"subagent.getTranscript"> = {
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: "FOCUS_CHILD" }],
							timestamp: 1_700_000_000_000,
						},
					],
					status: "completed",
				};
				browser.send(JSON.stringify({ id: frame.id, ok: true, result }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				channel?: string;
				data?: Record<string, unknown>;
			};
			if (frame.channel === "server.welcome") welcomes++;
			if (protocolVersion !== undefined && frame.channel === "server.welcome") {
				browser.send(JSON.stringify({ ...frame, data: { ...frame.data, protocolVersion } }));
			} else {
				browser.send(message);
			}
		});
	});
	return {
		get reads() {
			return reads;
		},
		get welcomes() {
			return welcomes;
		},
		get resourceScope() {
			return resourceScope;
		},
		transcriptRequests,
		setProtocolVersion: (version: number) => {
			protocolVersion = version;
		},
		disconnect: () => disconnect(),
	};
}

test("an empty Resources inspector keeps focus discipline, hides the dock and stays usable at phone width", async ({
	page,
}) => {
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await expect(trigger).toHaveAccessibleName("Resources, 0 active");
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(trigger).not.toHaveAttribute("data-live");
	await expect(page.getByTestId("resources-dock")).toHaveCount(0);
	await shot(page.getByTestId("chat-toolbar"), "chat-resources", "after-header");
	await trigger.focus();
	await page.keyboard.press("Enter");
	const inspector = page.getByTestId("resources-inspector");
	await expect(inspector).toBeVisible();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await expect(inspector.getByTestId("resources-empty")).toHaveText(
		"Nothing has run in the background in this chat yet.",
	);
	await expect(inspector.getByTestId("resources-commands")).toHaveCount(0);
	await expect(inspector.getByTestId("resources-subagents")).toHaveCount(0);
	await expect(inspector.getByText("Nothing to inspect yet.", { exact: true })).toBeVisible();
	await expect(inspector.getByTestId("resource-stop")).toHaveCount(0);
	await expect(inspector.getByTestId("resources-stop-all")).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await shot(inspector, "chat-resources", "empty-inspector");
	await page.getByTestId("chat-input").click();
	await expect(inspector).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(inspector).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(trigger).toBeInViewport({ ratio: 1 });
	await trigger.click();
	await expect(inspector).toBeInViewport({ ratio: 1 });
	await shot(page, "chat-resources", "mobile-inspector");
	await inspector.getByTestId("resources-inspector-close").click();
	await expect(inspector).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test("Resources rehydrates on welcome after a real socket reconnect and browser reload", async ({
	page,
}) => {
	const wire = await observeResourceWire(page);
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await expect.poll(() => wire.reads).toBeGreaterThan(0);
	const initial = wire.reads;
	wire.disconnect();
	await expect.poll(() => wire.reads).toBeGreaterThan(initial);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	const reconnected = wire.reads;
	await page.reload();
	await expect.poll(() => wire.reads).toBeGreaterThan(reconnected);
	await expect(trigger).toHaveAttribute("data-active-count", "0");
});

test("an older host hides Resources without issuing unsupported resource reads", async ({
	page,
}) => {
	const wire = await observeResourceWire(page, {
		protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION - 1,
	});
	await openResourceChat(page);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("resources-trigger")).toHaveCount(0);
	expect(wire.reads).toBe(0);
});

test("an older welcome retires the inspector with its transcript and returns focus to the composer", async ({
	page,
}) => {
	const childSessionId = "resource-focus-child";
	const wire = await observeResourceWire(page, { completedChildId: childSessionId });
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await trigger.click();
	const inspector = page.getByTestId("resources-inspector");
	await expect(inspector).toBeVisible();
	const row = inspector.getByTestId("resource-subagent");
	await expect(row).toHaveAttribute("data-resource-id", childSessionId);
	await expect(row).toHaveAttribute("data-selected", "true");
	await expect(row.getByRole("option")).toHaveAttribute("aria-selected", "true");
	await expect(row.getByRole("option")).toHaveAccessibleName(/Focus fixture, Done/);
	await expect(row.getByRole("option")).toContainText("7 min");
	await expect(inspector.getByTestId("resources-inspector-detail")).toContainText("Duration7 min");
	await expect(inspector.getByTestId("resource-detail-model")).toContainText("acme/reviewer-1");
	await expect(inspector.getByTestId("resource-detail-model")).toContainText("high");
	await expect(inspector.getByTestId("subagent-transcript")).toContainText("FOCUS_CHILD");
	expect(wire.transcriptRequests).toEqual([
		{
			workspaceId: wire.resourceScope?.workspaceId,
			parentSessionId: wire.resourceScope?.sessionId,
			childSessionId,
		},
	]);
	await row.getByRole("option").focus();
	await expect(row.getByRole("option")).toBeFocused();

	const initialWelcomes = wire.welcomes;
	wire.setProtocolVersion(CHAT_RESOURCES_PROTOCOL_VERSION - 1);
	wire.disconnect();
	await expect.poll(() => wire.welcomes).toBeGreaterThan(initialWelcomes);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(trigger).toHaveCount(0);
	await expect(inspector).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeFocused();
});

const MINUTE = 60_000;

function archivedHistory(sessionId: string, base: number): ResourceRecord[] {
	const suites = Array.from({ length: 26 }, (_, index): ResourceRecord => {
		const n = String(index + 1).padStart(2, "0");
		const failed = n === "03" || n === "11";
		return {
			kind: "command",
			summary: {
				id: `cmd-suite-${n}`,
				sessionId,
				name: `suite ${n}`,
				command: `bun test --shard ${n}`,
				status: failed ? "error" : "completed",
				startedAt: base + index * MINUTE,
				finishedAt: base + index * MINUTE + MINUTE / 2,
				exitCode: failed ? 1 : 0,
				...(failed ? { errorMessage: "Command exited with code 1" } : {}),
			},
		};
	});
	const child = (
		id: string,
		roleName: string,
		status: "completed" | "running",
		createdAt: number,
	): ResourceRecord => ({
		kind: "subagent",
		summary: {
			childSessionId: `019a0000-0000-7000-8000-00000000000${id}`,
			parentSessionId: sessionId,
			roleName,
			task: `${roleName} the archive`,
			status,
			createdAt: new Date(createdAt).toISOString(),
			...(status === "completed" ? { durationMs: MINUTE, finishedAt: createdAt + MINUTE } : {}),
		},
	});
	return [
		...suites,
		{
			kind: "command",
			summary: {
				id: "cmd-dev",
				sessionId,
				name: "dev server",
				command: "bun run dev",
				status: "running",
				startedAt: base - 10 * MINUTE,
			},
		},
		child("a", "scout", "completed", base - 5 * MINUTE),
		child("b", "reviewer", "completed", base - 4 * MINUTE),
		child("c", "planner", "running", base - 2 * MINUTE),
	];
}

function writeArchive(scope: WsParams<"session.resources">, records: ResourceRecord[]): void {
	const dir = join(E2E_DATA_DIR, "resource-history", scope.workspaceId, scope.sessionId);
	mkdirSync(join(dir, "logs"), { recursive: true });
	writeFileSync(
		join(dir, "index.jsonl"),
		`${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
	);
	writeFileSync(
		join(dir, "logs", "cmd-suite-26.json"),
		JSON.stringify({ text: "SUITE_26_LOG\n", truncated: false }),
	);
}

test("Resources keeps a chat's archived history: the dock sums it, the inspector folds and pages it, and an interrupted run says its log is gone", async ({
	page,
}) => {
	let sessionId: string | undefined;
	const historyReads: WsParams<"session.resourceHistory">[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		let seeded = false;
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "session.resources") {
				const scope = frame.params as WsParams<"session.resources">;
				if (!seeded && sessionId && scope.sessionId === sessionId) {
					writeArchive(scope, archivedHistory(sessionId, Date.now() - 40 * MINUTE));
					seeded = true;
				}
			}
			if ("method" in frame && frame.method === "session.resourceHistory")
				historyReads.push(frame.params as WsParams<"session.resourceHistory">);
			server.send(message);
		});
	});
	await openFixtureProject(page);
	sessionId = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Resource history",
		messages: [{ role: "user", text: "Show the archived resources.", timestamp: Date.now() }],
	}).id;
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Resource history");

	const dock = page.getByTestId("resources-dock");
	const finishedLine = dock.getByTestId("resources-dock-finished");
	await expect(finishedLine).toContainText("30 finished");
	await expect(dock.getByTestId("resources-dock-fresh")).toHaveCount(0);
	await expect(dock.locator('[data-testid="resource-command"]')).toHaveCount(0);
	await expect(page.getByTestId("resources-trigger")).toHaveAttribute("data-active-count", "0");
	await shot(dock, "chat-resources", "history-dock");

	await finishedLine.click();
	const inspector = page.getByTestId("resources-inspector");
	await expect(inspector).toBeVisible();
	const commands = inspector.getByTestId("resources-commands");
	await expect(commands.locator('[data-resource-id="cmd-suite-26"]')).toHaveAttribute(
		"data-selected",
		"true",
	);
	await expect(inspector.getByTestId("command-log-output")).toContainText("SUITE_26_LOG");
	await expect(commands.getByTestId("resource-command")).toHaveCount(5);
	const fold = commands.getByTestId("resources-fold");
	await expect(fold).toHaveAccessibleName(
		"22 more finished: 19 done, 2 failed, 1 stopped or interrupted",
	);
	await expect(inspector).toContainText(
		"History and logs are kept until this workspace is archived.",
	);
	const subagents = inspector.getByTestId("resources-subagents");
	await expect(subagents.getByTestId("resource-subagent")).toHaveCount(3);
	await expect(subagents.locator('[data-state="interrupted"]')).toHaveCount(1);
	await expect(subagents.getByTestId("resources-fold")).toHaveCount(0);
	await shot(inspector, "chat-resources", "history-folded");

	await fold.click();
	await expect(fold).toHaveAttribute("aria-expanded", "true");
	await expect(commands.getByTestId("resource-command")).toHaveCount(20);
	const more = commands.getByTestId("resources-show-more");
	await expect(more).toHaveText("Show 7 more · 7 left");
	await more.click();
	await expect(commands.getByTestId("resource-command")).toHaveCount(27);
	await expect(more).toHaveCount(0);
	expect(historyReads).toHaveLength(1);
	expect(historyReads[0]).toMatchObject({ kind: "command", before: { id: "cmd-suite-07" } });

	const dev = commands.locator('[data-resource-id="cmd-dev"]');
	await expect(dev).toHaveAttribute("data-state", "interrupted");
	await dev.getByRole("option").click();
	await expect(dev).toHaveAttribute("data-selected", "true");
	await expect(inspector.getByTestId("resource-detail-interrupted")).toBeVisible();
	await expect(inspector.getByTestId("command-log-unavailable")).toHaveText(
		"The log wasn’t saved — the host stopped while this command was running.",
	);
	await shot(inspector, "chat-resources", "history-interrupted");

	await commands.getByTestId("resources-collapse").click();
	await expect(fold).toHaveAttribute("aria-expanded", "false");
	await expect(commands.getByTestId("resource-command")).toHaveCount(6);
	await expect(dev).toHaveAttribute("data-selected", "true");
});
