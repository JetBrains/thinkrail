import { expect, test } from "bun:test";
import type { WireModel, Workspace, WsParams } from "@thinkrail/contracts";
import { createHostSessionFactory } from "./createHostSession";

const model: WireModel = {
	provider: "test",
	id: "chosen",
	name: "Chosen",
	contextWindow: 1000,
	reasoning: false,
	thinkingLevels: ["off"],
};

function harness() {
	let workspace: Workspace | undefined = {
		id: "ws",
		projectId: "project",
		worktreePath: "/repo",
		name: "Repo",
		branch: "main",
		baseBranch: "main",
	};
	const calls: string[] = [];
	const created = { sessionId: "chat", model, thinkingLevel: "medium" as const };
	let resolveModel = async (_input: Omit<WsParams<"session.create">, "workspaceId">) => ({
		model: model as WireModel | null,
		thinkingLevel: "medium" as const,
	});
	let create = async (_input: unknown) => created;
	const renamed: { sessionId: string; title: string }[] = [];
	let rename = async (sessionId: string, _workspaceId: string, _cwd: string, title: string) => {
		renamed.push({ sessionId, title });
		return true;
	};
	const run = createHostSessionFactory({
		getWorkspace: () => {
			calls.push("workspace");
			if (!workspace) throw new Error("Unknown workspace");
			return { ...workspace };
		},
		ensureWorkspaceScratchDir: () => {
			calls.push("scratch");
		},
		resolveNewChatModel: (input) => {
			calls.push("model");
			return resolveModel(input);
		},
		createSession: (input) => {
			calls.push("create");
			return create(input);
		},
		noteRecentModel: (value) => {
			expect(value).toBe(model);
			calls.push("recent");
		},
		trackChatStarted: (value) => {
			expect(value).toEqual({ sessionId: "chat", model: analyticsModel });
			calls.push("analytics");
		},
		renameSession: (sessionId, workspaceId, cwd, title) => {
			calls.push("rename");
			return rename(sessionId, workspaceId, cwd, title);
		},
	});
	let analyticsModel: WireModel | null = model;
	return {
		run,
		calls,
		created,
		renamed,
		setRename: (fn: typeof rename) => {
			rename = fn;
		},
		setWorkspace: (value: Workspace | undefined) => {
			workspace = value;
		},
		get workspace() {
			if (!workspace) throw new Error("Unknown workspace");
			return workspace;
		},
		setResolve: (value: typeof resolveModel) => {
			resolveModel = value;
		},
		setCreate: (value: typeof create) => {
			create = value;
		},
		noModel: () => {
			analyticsModel = null;
			resolveModel = async () => ({ model: null, thinkingLevel: "medium" });
		},
	};
}

test("preserves explicit model/effort input, creation result, recent history and analytics", async () => {
	const h = harness();
	const input: WsParams<"session.create"> = { workspaceId: "ws", model, thinkingLevel: "high" };
	h.setResolve(async (value) => {
		expect(value).toBe(input);
		return { model, thinkingLevel: "medium" };
	});
	h.setCreate(async (value) => {
		expect(value).toEqual({ cwd: "/repo", workspaceId: "ws", model, thinkingLevel: "medium" });
		return h.created;
	});
	expect(await h.run(input)).toBe(h.created);
	expect(h.calls).toEqual([
		"workspace",
		"scratch",
		"model",
		"workspace",
		"create",
		"recent",
		"analytics",
	]);
});

test("default model is not recorded as recent", async () => {
	const h = harness();
	await h.run({ workspaceId: "ws" });
	expect(h.calls).not.toContain("recent");
	expect(h.calls).toContain("analytics");
});

test("no usable model omits model input and reports none rather than agent placeholder", async () => {
	const h = harness();
	h.noModel();
	h.setCreate(async (value) => {
		expect(value).toEqual({ cwd: "/repo", workspaceId: "ws", thinkingLevel: "medium" });
		return h.created;
	});
	await h.run({ workspaceId: "ws" });
});

for (const field of ["removed", "id", "projectId", "worktreePath"] as const) {
	test(`rejects workspace ${field} during model resolution for unguarded callers`, async () => {
		const h = harness();
		h.setResolve(async () => {
			h.setWorkspace(field === "removed" ? undefined : { ...h.workspace, [field]: "replacement" });
			return { model, thinkingLevel: "medium" };
		});
		await expect(h.run({ workspaceId: "ws" })).rejects.toThrow();
		expect(h.calls).not.toContain("create");
		expect(h.calls).not.toContain("analytics");
	});
}

test("guard runs at all four boundaries", async () => {
	const h = harness();
	await h.run({ workspaceId: "ws" }, () => {
		h.calls.push("guard");
	});
	expect(h.calls).toEqual([
		"guard",
		"workspace",
		"scratch",
		"model",
		"guard",
		"workspace",
		"guard",
		"create",
		"guard",
		"analytics",
	]);
});

for (const failAt of [1, 2, 3, 4]) {
	test(`guard failure at boundary ${failAt} stops further work without post-create cleanup`, async () => {
		const h = harness();
		let count = 0;
		await expect(
			h.run({ workspaceId: "ws", model }, () => {
				if (++count === failAt) throw new Error("stale");
			}),
		).rejects.toThrow("stale");
		expect(h.calls.includes("create")).toBe(failAt === 4);
		expect(h.calls).not.toContain("recent");
		expect(h.calls).not.toContain("analytics");
		if (failAt === 1) expect(h.calls).toEqual([]);
	});
}

test("creation rejection propagates without recent history or analytics", async () => {
	const h = harness();
	h.setCreate(async () => {
		throw new Error("create failed");
	});
	await expect(h.run({ workspaceId: "ws", model })).rejects.toThrow("create failed");
	expect(h.calls).not.toContain("recent");
	expect(h.calls).not.toContain("analytics");
});

test("a supplied title names the new chat and a failed rename keeps the chat", async () => {
	const h = harness();
	expect(await h.run({ workspaceId: "ws" }, undefined, { title: "Add billing export" })).toEqual(
		h.created,
	);
	expect(h.renamed).toEqual([{ sessionId: "chat", title: "Add billing export" }]);
	expect(h.calls).toEqual([
		"workspace",
		"scratch",
		"model",
		"workspace",
		"create",
		"rename",
		"analytics",
	]);

	const failed = harness();
	failed.setRename(async () => {
		throw new Error("rename exploded");
	});
	expect(
		await failed.run({ workspaceId: "ws" }, undefined, { title: "Add billing export" }),
	).toEqual(failed.created);
	expect(failed.calls).toContain("analytics");

	const untitled = harness();
	expect(await untitled.run({ workspaceId: "ws" })).toEqual(untitled.created);
	expect(untitled.renamed).toEqual([]);
});
