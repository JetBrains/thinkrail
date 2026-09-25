import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getCurrentSystemPrompt, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionRef, WorkspaceRef } from "@thinkrail/ext";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");
const EXT = "project-notes";

interface Note {
	id: string;
	title: string;
	body: string;
	enabled: boolean;
	source: "user" | "agent";
}

interface PromptOptions {
	sections: Record<string, string>;
}

type BeforeStart = (
	event: { systemPromptOptions: PromptOptions },
	ctx: unknown,
) => Promise<unknown>;

let base: string;
let workspace: string;
let other: string;

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "project-notes-ext-")));
	workspace = join(base, "repo");
	other = join(base, "other");
	mkdirSync(workspace);
	mkdirSync(other);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const SESSION: SessionRef = {
	sessionId: "s1",
	workspaceId: "w2",
	title: "Chat",
	isStreaming: false,
};

const workspaceRefs = (): WorkspaceRef[] => [
	{ workspaceId: "w1", projectId: "p1", name: "Default", branch: "main", path: workspace },
	{ workspaceId: "w2", projectId: "p2", name: "Other", branch: "main", path: other },
];

const makeHost = () =>
	createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: {
			list: () => [SESSION],
			get: (id) => (id === "s1" ? SESSION : undefined),
			stats: () => ({}) as never,
		},
		workspaces: {
			list: workspaceRefs,
			get: (id) => workspaceRefs().find((ref) => ref.workspaceId === id),
		},
	});

type Host = ReturnType<typeof makeHost>;

const load = async () => {
	const host = makeHost();
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	expect(host.get(EXT)).toMatchObject({ status: "active" });
	return host;
};

const factoryOf = (host: Host) => {
	const factory = host.piFactories().find((candidate) => host.piFactoryOwner(candidate) === EXT);
	if (!factory) throw new Error("project-notes registered no pi factory");
	return factory;
};

const beforeStartOf = (host: Host) => {
	let handler: BeforeStart | undefined;
	const pi = {
		on: (event: string, fn: BeforeStart) => {
			if (event === "before_agent_start") handler = fn;
		},
		registerTool: () => {},
	};
	void factoryOf(host)(pi as unknown as ExtensionAPI);
	if (!handler) throw new Error("no before_agent_start handler");
	const hook = handler;
	return async (cwd: string, sessionId = "unknown") => {
		const options: PromptOptions = { sections: { stale: "x", project_notes: "old" } };
		await hook(
			{ systemPromptOptions: options },
			{ cwd, sessionManager: { getSessionId: () => sessionId } },
		);
		return options.sections;
	};
};

const save = (host: Host, payload: unknown, projectId = "p1") =>
	host.invokeAction({ ext: EXT, id: "save", payload, ctx: { projectId } });

const act = (host: Host, id: string, payload: unknown, projectId = "p1") =>
	host.invokeAction({ ext: EXT, id, payload, ctx: { projectId } });

const savedNote = async (host: Host, payload: unknown, projectId = "p1") => {
	const result = (await save(host, payload, projectId)) as { ok: boolean; note: Note };
	expect(result.ok).toBe(true);
	return result.note;
};

const channel = (host: Host, projectId: string) =>
	host.snapshot([`${EXT}:notes:${projectId}`])[`${EXT}:notes:${projectId}`] as Note[] | undefined;

describe("project-notes example extension", () => {
	test("saves, edits, toggles, and removes notes per project and publishes to watching views", async () => {
		const host = await load();
		try {
			host.setWatched("c1", [`${EXT}:notes:p1`]);
			await Bun.sleep(20);
			expect(channel(host, "p1")).toEqual([]);

			const note = await savedNote(host, {
				title: " Package manager ",
				body: "Use bun, never npm.",
			});
			expect(note).toMatchObject({ title: "Package manager", enabled: true, source: "user" });
			await savedNote(host, { title: "", body: "Other project rule" }, "p2");
			expect(channel(host, "p1")?.map((item) => item.body)).toEqual(["Use bun, never npm."]);
			expect(channel(host, "p2")).toBeUndefined();

			const edited = await savedNote(host, { id: note.id, title: "PM", body: "Use bun." });
			expect(edited).toMatchObject({ id: note.id, title: "PM", body: "Use bun.", enabled: true });
			expect(await act(host, "toggle", { id: note.id })).toEqual({ ok: true });
			expect(channel(host, "p1")?.[0]?.enabled).toBe(false);

			expect(await save(host, { title: "x", body: "   " })).toEqual({
				ok: false,
				error: "Write the note first.",
			});
			expect(await save(host, { title: "", body: "x".repeat(4_001) })).toMatchObject({ ok: false });
			expect(await save(host, { id: "missing", title: "", body: "x" })).toMatchObject({
				ok: false,
			});
			expect(
				await host.invokeAction({
					ext: EXT,
					id: "save",
					payload: { title: "", body: "x" },
					ctx: {},
				}),
			).toEqual({
				ok: false,
				error: "Open a project first.",
			});

			expect(await act(host, "remove", { id: note.id })).toEqual({ ok: true });
			expect(channel(host, "p1")).toEqual([]);
			host.setWatched("c1", []);
			expect(channel(host, "p1")).toBeUndefined();

			const stored = JSON.parse(readFileSync(join(base, "store", `${EXT}.json`), "utf8"));
			expect(Object.keys(stored)).toEqual(["notes:p2"]);
		} finally {
			await host.dispose();
		}
	});

	test("overlapping writes to one project all land, cold cache and warm", async () => {
		const host = await load();
		try {
			const cold = await Promise.all([
				save(host, { title: "", body: "a" }),
				save(host, { title: "", body: "b" }),
			]);
			expect(cold).toMatchObject([{ ok: true }, { ok: true }]);
			host.setWatched("c1", [`${EXT}:notes:p1`]);
			await Bun.sleep(20);
			const [first] = channel(host, "p1") ?? [];
			await Promise.all([
				save(host, { title: "", body: "c" }),
				act(host, "toggle", { id: first?.id }),
				save(host, { title: "", body: "d" }),
			]);
			expect(channel(host, "p1")?.map((note) => [note.body, note.enabled])).toEqual([
				["a", false],
				["b", true],
				["c", true],
				["d", true],
			]);
			const stored = JSON.parse(readFileSync(join(base, "store", `${EXT}.json`), "utf8"));
			expect(stored["notes:p1"]).toHaveLength(4);
		} finally {
			await host.dispose();
		}
	});

	test("before_agent_start owns the project_notes section, maps the session to its project, and caps it", async () => {
		const host = await load();
		try {
			const run = beforeStartOf(host);
			expect(await run(workspace)).toEqual({ stale: "x" });

			await savedNote(host, { title: "Tests", body: "Run bun run test before handing off." });
			await savedNote(host, { title: "", body: "Other project rule" }, "p2");
			const sections = await run(join(workspace, "packages"));
			expect(sections.stale).toBe("x");
			expect(sections.project_notes).toContain("Project notes:");
			expect(sections.project_notes).toContain("## Tests\nRun bun run test before handing off.");
			expect(sections.project_notes).not.toContain("Other project rule");

			expect((await run(workspace, "s1")).project_notes).toContain("## Other project rule");
			expect((await run(base)).project_notes).toBeUndefined();

			const big = await savedNote(host, { title: "Big", body: "b".repeat(3_000) });
			await savedNote(host, { title: "Over", body: "o".repeat(3_000) });
			await savedNote(host, { title: "Tail", body: "short" });
			const capped = (await run(workspace)).project_notes ?? "";
			expect(capped.length).toBeLessThanOrEqual(6_000);
			expect(capped).toContain("## Big");
			expect(capped).not.toContain("## Over");
			expect(capped).not.toContain("## Tail");
			await act(host, "toggle", { id: big.id });
			const shifted = (await run(workspace)).project_notes ?? "";
			expect(shifted).toContain("## Over");
			expect(shifted).toContain("## Tail");
		} finally {
			await host.dispose();
		}
	});

	test("a real pi session sees the section in its system prompt, and loses it when the note is off", async () => {
		const host = await load();
		const agentDir = join(base, ".pi-agent");
		mkdirSync(agentDir);
		const faux = createFauxCore({
			provider: "notes-probe",
			api: "notes-probe",
			tokensPerSecond: 100_000,
		});
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		});
		runtime.registerProvider("notes-probe", {
			api: faux.api,
			baseUrl: "http://faux.local",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: faux.models.map((model) => ({ ...model })),
		});
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: workspace,
			agentDir,
			settingsManager,
			extensionFactories: [factoryOf(host)],
		});
		await resourceLoader.reload();
		const prompts: string[] = [];
		const capture =
			(reply: Parameters<typeof fauxAssistantMessage>[0]): FauxResponseFactory =>
			(context) => {
				prompts.push(getCurrentSystemPrompt(context.messages));
				return fauxAssistantMessage(reply);
			};
		faux.setResponses([
			capture("noted"),
			capture("still noted"),
			capture([
				fauxToolCall(
					"add_project_note",
					{ title: "Deploys", body: "Deploy only from main." },
					{ id: "pin" },
				),
			]),
			capture("pinned"),
			capture("done"),
		]);
		const { session } = await createAgentSession({
			cwd: workspace,
			agentDir,
			model: faux.getModel(),
			modelRuntime: runtime,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.inMemory(workspace),
		});
		try {
			const note = await savedNote(host, { title: "Style", body: "Prefer arrow functions." });
			await session.prompt("hello");
			expect(prompts[0]).toContain("<project_notes>");
			expect(prompts[0]).toContain("## Style\nPrefer arrow functions.");

			await act(host, "toggle", { id: note.id });
			await session.prompt("again");
			expect(prompts[1]).not.toContain("<project_notes>");
			expect(prompts[1]).not.toContain("Prefer arrow functions.");

			await session.prompt("remember that we deploy only from main");
			const result = session.messages.find(
				(message) => message.role === "toolResult" && message.toolCallId === "pin",
			);
			expect(result?.role === "toolResult" && result.isError).toBe(false);
			expect(JSON.stringify(result)).toContain('Saved project note \\"Deploys\\"');
			expect(prompts[3]).toBe(prompts[2]);

			await session.prompt("next");
			expect(prompts[4]).toContain("## Deploys\nDeploy only from main.");
			expect(prompts[4]).not.toContain("Prefer arrow functions.");
			host.setWatched("c1", [`${EXT}:notes:p1`]);
			await Bun.sleep(20);
			expect(channel(host, "p1")?.find((item) => item.title === "Deploys")?.source).toBe("agent");
		} finally {
			session.dispose();
			await host.dispose();
		}
	});
});
