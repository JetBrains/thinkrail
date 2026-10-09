import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	hasTrustRequiringProjectResources,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ProjectResourceKind } from "@thinkrail/contracts";
import {
	applyPiResourceTrust,
	createSession,
	disposeAllSessions,
	getSessionCommands,
	getSessionState,
	liveParentContext,
	promptSession,
	reloadSessionResources,
	setSessionManagerFactory,
	setSkillAdmissionResolver,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { delegationServiceFor } from "./delegation";
import { configurePiRuntime } from "./piRuntime";
import { piTrustsProjectPath, projectTrustSummary } from "./projectTrust";
import { admissionContextFor } from "./skillAdmission";

const model = {
	id: "trust",
	name: "trust",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "trust",
	api: "trust",
	models: [model],
	tokensPerSecond: 40,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = mkdtempSync(join(tmpdir(), "project-trust-"));
const agentDir = join(root, "agent");
const trustedWorkspaces = new Set<string>();
let sequence = 0;

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	mkdirSync(agentDir, { recursive: true });
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("trust", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	setSkillAdmissionResolver((workspaceId) =>
		admissionContextFor({
			piResourceTrust: trustedWorkspaces.has(workspaceId) ? "granted" : "untrusted",
		}),
	);
});

afterAll(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setSkillAdmissionResolver(() => admissionContextFor(undefined));
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});

async function waitFor(read: () => boolean, ms = 8000): Promise<void> {
	const until = Date.now() + ms;
	while (!read()) {
		if (Date.now() > until) throw new Error("condition timed out");
		await Bun.sleep(10);
	}
}

function projectCwd(): string {
	const cwd = mkdtempSync(join(root, "cwd-"));
	mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "prompts", "native-kickoff.md"), "---\ndescription: n\n---\nGo\n");
	return cwd;
}

async function projectSession(): Promise<{ workspaceId: string; sessionId: string }> {
	const workspaceId = `trust-${++sequence}`;
	const { sessionId } = await createSession({ workspaceId, cwd: projectCwd() });
	return { workspaceId, sessionId };
}

const hasNativeTemplate = (sessionId: string): boolean =>
	getSessionCommands(sessionId).some((command) => command.name === "native-kickoff");

test("pi trusts a path by its nearest saved decision, else by defaultProjectTrust, and never through an unreadable store", () => {
	const project = mkdtempSync(join(root, "decided-"));
	const nested = join(project, "packages", "app");
	const undecided = mkdtempSync(join(tmpdir(), "undecided-"));
	const trusted = mkdtempSync(join(tmpdir(), "pi-trusted-"));
	mkdirSync(nested, { recursive: true });
	const settings = join(agentDir, "settings.json");
	try {
		writeFileSync(
			join(agentDir, "trust.json"),
			JSON.stringify({ [realpathSync(project)]: false, [realpathSync(trusted)]: true }),
		);
		expect(piTrustsProjectPath(nested)).toBe(false);
		expect(piTrustsProjectPath(trusted)).toBe(true);
		expect(piTrustsProjectPath(undecided)).toBe(false);

		writeFileSync(settings, JSON.stringify({ defaultProjectTrust: "always" }));
		expect(piTrustsProjectPath(undecided)).toBe(true);
		expect(piTrustsProjectPath(nested)).toBe(false);

		writeFileSync(join(agentDir, "trust.json"), "{ not json");
		expect(piTrustsProjectPath(trusted)).toBe(false);
	} finally {
		rmSync(join(agentDir, "trust.json"), { force: true });
		rmSync(settings, { force: true });
		rmSync(undecided, { recursive: true, force: true });
		rmSync(trusted, { recursive: true, force: true });
	}
});

test("the trust summary names each kind of the project's own pi resources that pi gates, and counts project MCP entries", async () => {
	const project = (files: Record<string, string>): string => {
		const cwd = mkdtempSync(join(root, "summary-"));
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(join(cwd, path, ".."), { recursive: true });
			writeFileSync(join(cwd, path), content);
		}
		return cwd;
	};
	expect(await projectTrustSummary(project({ "README.md": "# plain\n" }))).toEqual({
		aliasSkills: [],
		piResources: [],
		mcpServers: 0,
	});
	const cases: Array<[ProjectResourceKind, Record<string, string>]> = [
		["extensions", { ".pi/extensions/x.ts": "export default () => {};\n" }],
		["settings", { ".pi/settings.json": "{}\n" }],
		["skills", { ".pi/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\n" }],
		["skills", { ".agents/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\n" }],
		["prompts", { ".pi/prompts/kickoff.md": "Go\n" }],
		["themes", { ".pi/themes/t.json": "{}\n" }],
		["systemPrompt", { ".pi/SYSTEM.md": "You are.\n" }],
		["systemPrompt", { ".pi/APPEND_SYSTEM.md": "Also.\n" }],
	];
	for (const [kind, files] of cases) {
		const cwd = project(files);
		expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
		expect((await projectTrustSummary(cwd)).piResources).toEqual([kind]);
	}
	const definitions = project({
		".agents/agents/repo-reviewer.md":
			"---\nname: repo-reviewer\ndescription: Reviews\n---\n\nReview.\n",
		".pi/extensions/x.ts": "export default () => {};\n",
	});
	expect((await projectTrustSummary(definitions)).piResources.sort()).toEqual([
		"extensions",
		"subagents",
	]);
	expect(
		await projectTrustSummary(
			project({
				".pi/mcp.json": JSON.stringify({
					mcpServers: { docs: { url: "https://docs.example/mcp" }, linear: { enabled: false } },
				}),
			}),
		),
	).toEqual({ aliasSkills: [], piResources: [], mcpServers: 2 });
});

test("an untrusted project's native resources stay out until a grant reaches the live session", async () => {
	const { workspaceId, sessionId } = await projectSession();
	expect(hasNativeTemplate(sessionId)).toBe(false);
	expect(await applyPiResourceTrust([workspaceId])).toEqual({});

	trustedWorkspaces.add(workspaceId);
	expect(await applyPiResourceTrust(["some-other-workspace"])).toEqual({});
	expect(await applyPiResourceTrust([workspaceId])).toEqual({ [sessionId]: "reloaded" });
	expect(hasNativeTemplate(sessionId)).toBe(true);
	expect(await applyPiResourceTrust([workspaceId])).toEqual({});

	trustedWorkspaces.delete(workspaceId);
	expect(await applyPiResourceTrust([workspaceId])).toEqual({ [sessionId]: "reloaded" });
	expect(hasNativeTemplate(sessionId)).toBe(false);
});

test("every reload applies the project's current trust, and a busy session takes it at settlement", async () => {
	const first = await projectSession();
	trustedWorkspaces.add(first.workspaceId);
	await reloadSessionResources(first.sessionId);
	expect(hasNativeTemplate(first.sessionId)).toBe(true);

	const busy = await projectSession();
	faux.setResponses([fauxAssistantMessage("word ".repeat(60))]);
	const turn = promptSession(busy.sessionId, "Say many words.");
	await waitFor(() => getSessionState(busy.sessionId).execution === "running");
	trustedWorkspaces.add(busy.workspaceId);
	expect(await applyPiResourceTrust([busy.workspaceId])).toEqual({ [busy.sessionId]: "deferred" });
	expect(hasNativeTemplate(busy.sessionId)).toBe(false);
	await turn;
	await waitFor(() => hasNativeTemplate(busy.sessionId));
});

test("a session whose trust changed while it was opening reloads into the new trust before it is returned", async () => {
	const hook = globalThis as typeof globalThis & { __projectTrustFlip?: () => void };
	const flipPath = join(agentDir, "extensions", "trust-flip.ts");
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(
		flipPath,
		"export default function flip(pi) { pi.on('session_start', () => { globalThis.__projectTrustFlip?.(); }); }\n",
	);
	const workspaceId = `trust-${++sequence}`;
	hook.__projectTrustFlip = () => trustedWorkspaces.add(workspaceId);
	try {
		const { sessionId } = await createSession({ workspaceId, cwd: projectCwd() });
		expect(hasNativeTemplate(sessionId)).toBe(true);
	} finally {
		delete hook.__projectTrustFlip;
		rmSync(flipPath, { force: true });
	}
});

test("a child derives no more trust than its parent has loaded or the project record allows", async () => {
	const childTrust = (sessionId: string) => liveParentContext(sessionId)?.isProjectTrusted?.();
	const busy = await projectSession();
	faux.setResponses([fauxAssistantMessage("word ".repeat(60))]);
	const turn = promptSession(busy.sessionId, "Say many words.");
	await waitFor(() => getSessionState(busy.sessionId).execution === "running");
	trustedWorkspaces.add(busy.workspaceId);
	expect(await applyPiResourceTrust([busy.workspaceId])).toEqual({ [busy.sessionId]: "deferred" });
	expect(childTrust(busy.sessionId)).toBe(false);
	await turn;
	await waitFor(() => hasNativeTemplate(busy.sessionId));
	expect(childTrust(busy.sessionId)).toBe(true);

	trustedWorkspaces.delete(busy.workspaceId);
	expect(childTrust(busy.sessionId)).toBe(false);
	expect(await applyPiResourceTrust([busy.workspaceId])).toEqual({ [busy.sessionId]: "reloaded" });
});

test("revoking trust stops the live subagents that were created under it before it reports", async () => {
	const p = await projectSession();
	trustedWorkspaces.add(p.workspaceId);
	await reloadSessionResources(p.sessionId);
	faux.setResponses([
		async (_context, streamOptions) => {
			await new Promise<void>((resolve) => {
				const signal = streamOptions?.signal;
				if (!signal) return;
				if (signal.aborted) resolve();
				else signal.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("CHILD_DONE");
		},
	]);
	const child = await delegationServiceFor(p.workspaceId).createChild({
		parent: p.sessionId,
		visibility: "hidden",
		info: { createdBy: "test" },
		session: {},
	});
	const run = child.runQueued("Keep going until trust is revoked.");
	await waitFor(() => child.snapshot?.status === "running");

	trustedWorkspaces.delete(p.workspaceId);
	expect(await applyPiResourceTrust([p.workspaceId])).toEqual({ [p.sessionId]: "reloaded" });
	expect(child.snapshot?.status).toBe("aborted");
	expect(child.snapshot?.details.abortReason).toBe("user");
	expect((await run).status).toBe("aborted");
	expect(hasNativeTemplate(p.sessionId)).toBe(false);
	expect(await applyPiResourceTrust([p.workspaceId])).toEqual({});
});
