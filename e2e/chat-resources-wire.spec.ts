import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

test("resource reads require the current chat's workspace and never recover handles from history", async ({
	page,
}) => {
	await openFixtureProject(page);
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const project = (await wire.request("project.list", {}))[0];
		if (!project) throw new Error("Missing fixture project");
		const workspaces = await wire.request("workspace.list", { projectId: project.id });
		const workspace = workspaces.find((candidate) => candidate.kind === "default");
		if (!workspace) throw new Error("Missing default workspace");
		const parent = seedWorkspaceSession(workspace.worktreePath, {
			name: "Resource history",
			messages: [
				{
					role: "user",
					text: "Check the previously started background command.",
					timestamp: Date.now(),
				},
				{
					role: "assistant",
					text: "Historical command id: old-command. This is transcript text, not a live process handle.",
					timestamp: Date.now() + 1,
				},
			],
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "Resource history");
		await expect(page.getByTestId("chat-toolbar")).toBeVisible();
		const scope = { workspaceId: workspace.id, sessionId: parent.id };
		const none = { done: 0, failed: 0, stopped: 0, interrupted: 0 };
		const empty = {
			...scope,
			commands: [],
			subagents: [],
			mcpServers: [],
			history: { commands: none, subagents: none },
		};
		await expect(wire.request("session.resources", scope)).resolves.toEqual(empty);
		await expect(
			wire.request("session.resourceHistory", { ...scope, kind: "command" }),
		).resolves.toEqual({ kind: "command", items: [], hasMore: false });
		await expect(
			wire.request("backgroundCommand.output", { ...scope, commandId: "old-command" }),
		).resolves.toEqual({ available: false });
		await expect(
			wire.request("backgroundCommand.stop", { ...scope, commandId: "old-command" }),
		).rejects.toThrow();
		await expect(
			wire.request("subagent.stop", {
				workspaceId: workspace.id,
				parentSessionId: parent.id,
				childSessionId: "missing-child",
			}),
		).rejects.toThrow();
		await expect(
			wire.request("subagent.stopAll", { workspaceId: workspace.id, parentSessionId: parent.id }),
		).resolves.toEqual({ ok: true, targeted: 0 });
		await expect(
			wire.request("session.resources", { ...scope, sessionId: "missing-parent" }),
		).rejects.toThrow();
		const foreign = await wire.request("workspace.create", { projectId: workspace.projectId });
		await expect(
			wire.request("session.resources", { ...scope, workspaceId: foreign.id }),
		).rejects.toThrow();
		await expect(
			wire.request("backgroundCommand.output", {
				...scope,
				workspaceId: foreign.id,
				commandId: "old-command",
			}),
		).rejects.toThrow();
		await expect(
			wire.request("subagent.stopAll", { workspaceId: foreign.id, parentSessionId: parent.id }),
		).rejects.toThrow();
		await expect(
			wire.request("session.resourceHistory", {
				...scope,
				workspaceId: foreign.id,
				kind: "subagent",
			}),
		).rejects.toThrow();
		await expect(wire.request("session.resources", scope)).resolves.toEqual(empty);
		await shot(page.getByTestId("chat-toolbar"), "chat-resources", "wire-chat-header");
	} finally {
		wire.close();
	}
});
