import { expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { RegistryToolWithholding } from "./registryToolWithholding";

const CUSTOM_TYPE = "thinkrail.registry-tool-withholding.v1";
const TOOL = "registry_active";
const INACTIVE = "registry_inactive";

async function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-registry-withholding-"));
	const agentDir = join(cwd, "agent");
	const model = {
		id: "registry-probe",
		name: "Registry probe",
		reasoning: false,
		input: ["text"] as "text"[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 100,
	};
	const faux = createFauxCore({
		provider: model.id,
		api: model.id,
		models: [model],
		tokensPerSecond: 100_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider(model.id, {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	const state = { enabled: true, owner: "visualize" as string | null, settle: true };
	let live: AgentSession | undefined;
	let registerForeign: (() => void) | undefined;
	let gate = new RegistryToolWithholding();
	const session = (): AgentSession => {
		if (!live) throw new Error("expected an open Pi session");
		return live;
	};
	const apply = () => gate.apply(session(), new Set(state.enabled ? [] : ["visualize"]));
	const open = async (manager = SessionManager.create(cwd, join(cwd, "sessions"))) => {
		live?.dispose();
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: false },
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noContextFiles: true,
			noPromptTemplates: true,
			noThemes: true,
			extensionFactories: ["foreign", "visualize"].map((owner) => ({
				name: owner,
				factory: (pi) => {
					if (owner === "foreign") {
						registerForeign = () =>
							pi.registerTool({
								name: TOOL,
								label: TOOL,
								description: "foreign tool",
								parameters: Type.Object({}),
								async execute() {
									return { content: [{ type: "text", text: "foreign" }], details: undefined };
								},
							});
					}
					if (!state.enabled || state.owner !== owner) return;
					for (const name of [TOOL, INACTIVE, "registry_opt_in", "registry_deferred"]) {
						pi.registerTool({
							name,
							label: name,
							description: name,
							defaultActive: name !== "registry_opt_in",
							exposure: name === "registry_deferred" ? "deferred" : "direct",
							parameters: Type.Object({}),
							async execute() {
								return { content: [{ type: "text", text: "done" }], details: undefined };
							},
						});
					}
				},
			})),
		});
		await resourceLoader.reload();
		({ session: live } = await createAgentSession({
			cwd,
			agentDir,
			model: faux.getModel(),
			modelRuntime: runtime,
			settingsManager,
			resourceLoader,
			sessionManager: manager,
		}));
		gate = new RegistryToolWithholding();
		apply();
		live.subscribe((event) => {
			gate.observeMessage(session(), event);
			if (state.settle && event.type === "agent_settled") apply();
		});
	};
	const restart = async (manager?: SessionManager) => {
		const file = session().sessionFile;
		if (!file) throw new Error("expected a persistent session file");
		await open(manager ?? SessionManager.open(file));
	};
	const prompt = async () => {
		let tools: string[] | undefined;
		faux.setResponses([
			(context) => {
				tools = getCurrentTools(context.messages).map((tool) => tool.name);
				return fauxAssistantMessage("done");
			},
		]);
		await session().prompt("Report the tool selection.");
		if (!tools) throw new Error("expected a real provider request");
		return tools;
	};
	return {
		state,
		registerForeign: () => registerForeign?.(),
		session,
		open,
		restart,
		prompt,
		apply,
		select: (name: string, active: boolean) => {
			const kept = session()
				.getActiveToolNames()
				.filter((tool) => tool !== name);
			session().setActiveToolsByName(active ? [...kept, name] : kept);
		},
		toggle: (enabled: boolean) => {
			state.enabled = enabled;
			apply();
		},
		reload: async () => {
			await session().reload();
			gate.reset();
			apply();
		},
		snapshots: () =>
			session()
				.sessionManager.getBranch()
				.flatMap((entry) =>
					entry.type === "custom" && entry.customType === CUSTOM_TYPE ? [entry.data] : [],
				),
		close: () => {
			live?.dispose();
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}

test("only actually withheld tools restore, not intentional or default-inactive/deferred selections", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.select(INACTIVE, false);
		await f.prompt();
		f.toggle(false);
		expect(await f.prompt()).not.toContain(TOOL);
		expect(f.snapshots()).toEqual([[{ owner: "visualize", name: TOOL, restoring: false }]]);
		f.state.enabled = true;
		await f.restart();
		const tools = await f.prompt();
		expect(tools).toContain(TOOL);
		expect(tools).not.toContain(INACTIVE);
		expect(tools).not.toContain("registry_opt_in");
		expect(tools).not.toContain("registry_deferred");
		expect(f.snapshots().at(-1)).toEqual([]);
	} finally {
		f.close();
	}
});

test("withholding survives reload and persistent prompts with the owner temporarily absent", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		await f.reload();
		expect(
			f
				.session()
				.getAllTools()
				.some((tool) => tool.name === TOOL),
		).toBe(false);
		await f.prompt();
		await f.restart();
		await f.prompt();
		f.toggle(true);
		expect(f.session().getActiveToolNames()).not.toContain(TOOL);
		await f.reload();
		expect(f.session().getActiveToolNames()).toContain(TOOL);
		await f.restart();
		expect(await f.prompt()).toContain(TOOL);
	} finally {
		f.close();
	}
});

test("withheld tool identity cannot transfer to a foreign owner and survives its absence", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.state.enabled = true;
		f.state.owner = "foreign";
		await f.restart();
		expect(await f.prompt()).not.toContain(TOOL);
		f.state.owner = null;
		await f.restart();
		await f.prompt();
		f.state.owner = "visualize";
		await f.restart();
		expect(await f.prompt()).toContain(TOOL);
	} finally {
		f.close();
	}
});

test("ambiguous older selections stay unchanged until an explicit resource reload", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.select(TOOL, false);
		await f.prompt();
		expect(f.snapshots()).toEqual([]);
		await f.restart();
		expect(await f.prompt()).not.toContain(TOOL);
		f.toggle(false);
		f.toggle(true);
		expect(await f.prompt()).not.toContain(TOOL);
		await f.reload();
		expect(await f.prompt()).toContain(TOOL);
	} finally {
		f.close();
	}
});

test("disabled-at-create and legacy branches without system messages use Pi defaults", async () => {
	const f = await fixture();
	try {
		f.state.enabled = false;
		await f.open();
		expect(await f.prompt()).not.toContain(TOOL);
		f.state.enabled = true;
		await f.restart();
		expect(await f.prompt()).toContain(TOOL);
		const legacy = SessionManager.inMemory();
		legacy.appendMessage({ role: "user", content: "Old transcript", timestamp: 1 });
		await f.open(legacy);
		expect(f.session().getActiveToolNames()).toContain(TOOL);
		expect(f.session().getActiveToolNames()).not.toContain("registry_opt_in");
		expect(f.snapshots()).toEqual([]);
	} finally {
		f.close();
	}
});

test("branch-local provenance survives compaction without leaking onto an alternative branch", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.select(TOOL, false);
		await f.prompt();
		const inactiveLeaf = f.session().sessionManager.getLeafId();
		if (!inactiveLeaf) throw new Error("expected a branch point");
		f.select(TOOL, true);
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.session().sessionManager.appendCompaction("Earlier work", null, 1000);
		f.state.enabled = true;
		await f.restart();
		expect(await f.prompt()).toContain(TOOL);
		const manager = f.session().sessionManager;
		manager.branch(inactiveLeaf);
		manager.appendCustomEntry("alternative-branch", {});
		await f.restart();
		expect(f.snapshots()).toEqual([]);
		expect(await f.prompt()).not.toContain(TOOL);
	} finally {
		f.close();
	}
});

test("persisted declarations retire provenance even if the host missed settlement before later removal", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		f.state.settle = false;
		expect(await f.prompt()).toContain(TOOL);
		f.select(TOOL, false);
		expect(await f.prompt()).not.toContain(TOOL);
		expect(f.snapshots().at(-1)).toContainEqual({
			owner: "visualize",
			name: TOOL,
			restoring: true,
		});
		await f.restart();
		expect(await f.prompt()).not.toContain(TOOL);
	} finally {
		f.close();
	}
});

test("a request retaining an intentional removal retires restoration even without settlement", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		f.select(TOOL, false);
		f.state.settle = false;
		expect(await f.prompt()).not.toContain(TOOL);
		await f.restart();
		expect(await f.prompt()).not.toContain(TOOL);
	} finally {
		f.close();
	}
});

test("a live intentional removal before the restored declaration cancels pending restoration", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		f.select(TOOL, false);
		f.apply();
		expect(await f.prompt()).not.toContain(TOOL);
		await f.restart();
		expect(await f.prompt()).not.toContain(TOOL);
	} finally {
		f.close();
	}
});

test.each([
	[true, true],
	[true, false],
	[false, true],
	[false, false],
])("a foreign owner's durable message cannot acknowledge restoration (declares: %s, settles: %s)", async (declares, settles) => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		f.registerForeign();
		expect(
			f
				.session()
				.getAllTools()
				.find((tool) => tool.name === TOOL)?.sourceInfo.path,
		).toBe("<inline:foreign>");
		f.state.settle = settles;
		if (declares) expect(await f.prompt()).toContain(TOOL);
		f.select(TOOL, false);
		expect(await f.prompt()).not.toContain(TOOL);
		await f.restart();
		expect(await f.prompt()).toContain(TOOL);
	} finally {
		f.close();
	}
});

test("intentional removal before a second disable does not become host withholding", async () => {
	const f = await fixture();
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		f.select(TOOL, false);
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		expect(f.session().getActiveToolNames()).not.toContain(TOOL);
		await f.restart();
		expect(await f.prompt()).not.toContain(TOOL);
	} finally {
		f.close();
	}
});

test("an acknowledgement without its upcoming durable declaration cannot retire restoration", async () => {
	const f = await fixture();
	let append: ReturnType<typeof jest.spyOn> | undefined;
	try {
		await f.open();
		await f.prompt();
		f.toggle(false);
		await f.prompt();
		f.toggle(true);
		f.state.settle = false;
		const manager = f.session().sessionManager;
		const original = manager.appendMessage.bind(manager);
		append = jest.spyOn(manager, "appendMessage").mockImplementation((message) => {
			if (message.role === "system" && message.toolsAdded?.some((tool) => tool.name === TOOL)) {
				throw new Error("Crash after acknowledgement, before declaration");
			}
			return original(message);
		});
		await expect(f.prompt()).rejects.toThrow("expected a real provider request");
		expect(manager.getBranch()).toContainEqual(
			expect.objectContaining({
				type: "custom",
				customType: "thinkrail.registry-tool-withholding-ack.v1",
			}),
		);
		expect(manager.getBranch().at(-1)).toMatchObject({
			type: "message",
			message: { role: "assistant", stopReason: "error" },
		});
		append.mockRestore();
		await f.restart();
		expect(f.session().getActiveToolNames()).toContain(TOOL);
		expect(await f.prompt()).toContain(TOOL);
	} finally {
		append?.mockRestore();
		f.close();
	}
});
