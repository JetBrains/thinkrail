import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	createSession,
	disposeAllSessions,
	promptSession,
	removeSession,
	setSessionManagerFactory,
	setSessionPublisher,
} from "./agentSessionManager";
import { configurePiRuntime } from "./piRuntime";

/** A complete model definition for `registerProvider` (faux defaults are looser). */
function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

// One faux provider per session so each streams its own deterministic text, regardless of interleaving.
const fauxA = createFauxCore({
	provider: "fauxa",
	api: "fauxa",
	models: [modelDef("fauxa")],
	tokensPerSecond: 2000,
});
const fauxB = createFauxCore({
	provider: "fauxb",
	api: "fauxb",
	models: [modelDef("fauxb")],
	tokensPerSecond: 2000,
});

const events = new Map<string, unknown[]>();
const seen = (id: string) => JSON.stringify(events.get(id) ?? []);

const tmpDirs: string[] = [];
function tmpCwd(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

beforeAll(() => {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	// biome-ignore lint/suspicious/noExplicitAny: faux stream/model types bridge pi-ai ↔ pi-coding-agent
	const reg = modelRegistry as any;
	const cfg = (faux: typeof fauxA, id: string) => ({
		api: faux.api,
		// baseUrl + apiKey are required when models are defined; streamSimple does the real (in-process) work.
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...modelDef(id), api: faux.api }],
	});
	reg.registerProvider("fauxa", cfg(fauxA, "fauxa"));
	reg.registerProvider("fauxb", cfg(fauxB, "fauxb"));

	configurePiRuntime({ authStorage, modelRegistry });
	setSessionManagerFactory(() => SessionManager.inMemory());
	setSessionPublisher(({ sessionId, event }) => {
		const list = events.get(sessionId) ?? [];
		list.push(event);
		events.set(sessionId, list);
	});
});

afterAll(() => {
	disposeAllSessions();
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

test("two sessions in two worktrees stream independently; disposing one leaves the other working", async () => {
	fauxA.setResponses([fauxAssistantMessage("ALPHA_REPLY")]);
	fauxB.setResponses([fauxAssistantMessage("BRAVO_REPLY")]);

	// biome-ignore lint/suspicious/noExplicitAny: faux Model<string> satisfies the SDK's Model<any>
	const a = await createSession({ cwd: tmpCwd("trpi-a-"), model: fauxA.getModel() as any });
	// biome-ignore lint/suspicious/noExplicitAny: see above
	const b = await createSession({ cwd: tmpCwd("trpi-b-"), model: fauxB.getModel() as any });
	expect(a.sessionId).not.toBe(b.sessionId);

	await Promise.all([promptSession(a.sessionId, "hello A"), promptSession(b.sessionId, "hello B")]);

	// Each session's events carry only its own model's reply — they don't cross over.
	expect(seen(a.sessionId)).toContain("ALPHA_REPLY");
	expect(seen(a.sessionId)).not.toContain("BRAVO_REPLY");
	expect(seen(b.sessionId)).toContain("BRAVO_REPLY");
	expect(seen(b.sessionId)).not.toContain("ALPHA_REPLY");

	// Dispose A; B keeps streaming a fresh turn while A receives nothing more.
	const aEventsBefore = (events.get(a.sessionId) ?? []).length;
	removeSession(a.sessionId);
	fauxB.appendResponses([fauxAssistantMessage("BRAVO_AGAIN")]);
	await promptSession(b.sessionId, "again B");

	expect(seen(b.sessionId)).toContain("BRAVO_AGAIN");
	expect((events.get(a.sessionId) ?? []).length).toBe(aEventsBefore);
});
