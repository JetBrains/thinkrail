import { realpathSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	ISSUES_SESSION_STARTUP_PROTOCOL_VERSION,
	type IssueConnection,
	type IssueSummary,
	type ServerWelcome,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

// UI/wire contract only: startup replies name persisted chats, not running agents.
// Host startup/idempotency and HTTP fixtures own execution coverage.
for (const startup of [true, false]) {
	test(`${startup ? "v109 begins stages with resolved locale" : "v108 reopens legacy chats without startup"} through the Issues rail`, async ({
		page,
	}) => {
		const calls: { method: string; params: Record<string, unknown> }[] = [];
		let connected = false;
		let projectId = "";
		let workspaceId = "";
		let sessionId = "";
		const token = "fixture-only-pat-never-forward-to-host";
		const reference: IssueSummary["reference"] = {
			provider: "gitlab",
			instanceUrl: "https://gitlab.com",
			projectId: "fixture/tomato",
			number: 109,
		};
		const connection = (): IssueConnection => ({
			projectId,
			instanceUrl: reference.instanceUrl,
			remoteProjectId: reference.projectId,
			connected: true,
		});
		await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
			const server = browser.connectToServer();
			browser.onMessage((message) => {
				const frame = JSON.parse(message.toString()) as {
					id: string;
					method: string;
					params: Record<string, unknown>;
				};
				if (typeof frame.method !== "string") {
					server.send(message);
					return;
				}
				calls.push({ method: frame.method, params: frame.params });
				const reply = (result: unknown) =>
					browser.send(JSON.stringify({ id: frame.id, ok: true, result }));
				switch (frame.method) {
					case "issues.connection":
						reply(connected ? connection() : null);
						return;
					case "issues.connect":
						connected = true;
						reply(connection());
						return;
					case "issues.list":
						reply({
							issues: [
								{
									reference,
									title: "Tomato fixture",
									url: "https://gitlab.com/fixture/tomato/-/issues/109",
									stage: "backlog",
									labels: ["workflow::backlog"],
									updatedAt: "2026-01-01T00:00:00Z",
								} satisfies IssueSummary,
							],
							fetchedAt: "2026-01-01T00:00:00Z",
						});
						return;
					case "issues.beginDesign":
					case "issues.beginImplementation":
					case "issues.launchDesign":
					case "issues.startImplementation":
						reply({ workspaceId, sessionId });
						return;
				}
				// A regression must not launch an agent, mutate a remote, or leak the PAT.
				if (frame.method.startsWith("issues.") && frame.method !== "issues.repositoryAddress") {
					browser.send(JSON.stringify({ id: frame.id, ok: false, error: "unexpected issue RPC" }));
					return;
				}
				if (frame.method === "session.create" || frame.method === "session.prompt") {
					browser.send(JSON.stringify({ id: frame.id, ok: false, error: "no agent in this test" }));
					return;
				}
				server.send(message);
			});
			server.onMessage((message) => {
				const frame = JSON.parse(message.toString()) as { channel?: string; data?: ServerWelcome };
				if (frame.channel === WS_CHANNELS.serverWelcome && frame.data)
					frame.data.protocolVersion = ISSUES_SESSION_STARTUP_PROTOCOL_VERSION - (startup ? 0 : 1);
				browser.send(JSON.stringify(frame));
			});
		});
		await openFixtureProject(page);
		const wire = await E2eWire.connect(Number(new URL(page.url()).port));
		try {
			const [project] = await wire.request("project.list", {});
			if (!project) throw new Error("Fixture project missing");
			projectId = project.id;
			// Explicit fixture grant; never auto-approve trust in a browser handler.
			await wire.request("project.setTrust", { id: projectId, trusted: true });
			const [workspace] = await wire.request("workspace.list", { projectId });
			if (!workspace) throw new Error("Default workspace missing");
			workspaceId = workspace.id;
		} finally {
			wire.close();
		}
		const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			messages: [{ role: "user", text: "Persisted Tomato chat", timestamp: 1_700_000_000_000 }],
		});
		sessionId = session.id;
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await enterDefaultWorkspace(page);
		const issues = page.getByTestId("tool-rail-issues");
		await expect(issues).toBeVisible();
		if ((await issues.getAttribute("aria-pressed")) !== "true") await issues.click();
		await expect(issues).toHaveAttribute("aria-pressed", "true");
		await page.getByTestId("issues-address").fill("https://gitlab.com/fixture/tomato");
		await page.getByTestId("issues-token").fill(token);
		await page.getByTestId("issues-connect").click();
		await expect(page.getByTestId("issues-state")).toBeVisible();
		await expect(page.getByTestId("issues-token")).toHaveCount(0);

		// Keep the tool mounted while resolving the saved system preference to a language.
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-language").click();
		await page.getByTestId("language-system").click();
		await expect(page.locator("html")).toHaveAttribute("lang", "en");
		await page.keyboard.press("Escape");
		const chat = page.locator(`[data-testid="editor-tab"][data-session-id="${sessionId}"]`);
		for (const [action, locale] of [
			["design", "en"],
			["implement", "zh-CN"],
			["design", "en"],
		] as const) {
			await page.getByTestId("open-settings").click();
			await page.getByTestId("settings-nav-language").click();
			await page.getByTestId(locale === "en" ? "language-system" : "language-zh-CN").click();
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await page.keyboard.press("Escape");
			// Close the real persisted tab, then prove the launch callback reopens that ID.
			await expect(chat).toBeVisible();
			await chat.getByTestId("editor-tab-close").click();
			await expect(chat).toHaveCount(0);
			await page.getByTestId(`issue-action-${action}`).click();
			await expect(chat).toBeVisible();
			await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
		}
		const stageCalls = calls.filter(({ method }) =>
			/issues\.(beginDesign|beginImplementation|launchDesign|startImplementation)$/.test(method),
		);
		expect(stageCalls).toEqual(
			[
				startup ? "issues.beginDesign" : "issues.launchDesign",
				startup ? "issues.beginImplementation" : "issues.startImplementation",
				startup ? "issues.beginDesign" : "issues.launchDesign",
			].map((method) => ({
				method,
				params: {
					projectId,
					reference,
					...(startup ? { locale: method === "issues.beginImplementation" ? "zh-CN" : "en" } : {}),
				},
			})),
		);
		expect(
			calls.filter(({ method }) => method === "session.create" || method === "session.prompt"),
		).toEqual([]);
		expect(calls.filter(({ method }) => method === "issues.connect")).toHaveLength(1);
		expect(
			calls.filter(
				({ method, params }) =>
					method !== "issues.connect" && JSON.stringify(params).includes(token),
			),
		).toEqual([]);
		expect(
			calls.filter(
				({ method }) =>
					method.startsWith("issues.") &&
					![
						"issues.repositoryAddress",
						"issues.connection",
						"issues.list",
						"issues.connect",
						...stageCalls.map((call) => call.method),
					].includes(method),
			),
		).toEqual([]);
		await expect(page.getByTestId("issue-action-design")).not.toHaveAttribute("data-done", "true");
		await expect(page.getByTestId("issue-action-implement")).not.toHaveAttribute(
			"data-done",
			"true",
		);
	});
}
