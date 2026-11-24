import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	InMemoryCredentialStore,
	type TranscriptContext,
	type UserMessage,
} from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { oversizedImageGuard } from "./imageGuard";

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function imageCount(messages: readonly { role: string; content?: unknown }[]): number {
	return messages.reduce(
		(count, message) =>
			count +
			(Array.isArray(message.content)
				? message.content.filter((block) => block.type === "image").length
				: 0),
		0,
	);
}

test.each([
	{ id: "claude-fallback", images: 182, declared: undefined, override: undefined, kept: 100 },
	{ id: "other-provider-model", images: 5, declared: 600, override: 3, kept: 3 },
	{ id: "claude-large-capacity", images: 182, declared: 600, override: undefined, kept: 182 },
])(
	"real pi sessions bound retries and later $id requests while retaining every stored image",
	async ({ id, images, declared, override, kept }) => {
		const cwd = mkdtempSync(join(tmpdir(), "thinkrail-image-count-"));
		try {
			const agentDir = join(cwd, "agent");
			mkdirSync(agentDir);
			const definition = {
				id,
				name: id,
				reasoning: false,
				input: ["text", "image"] as ("text" | "image")[],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 100,
				...(declared === undefined ? {} : { inputLimits: { images: { maxPerRequest: declared } } }),
			};
			const faux = createFauxCore({
				provider: "image-count-probe",
				api: "image-count-probe",
				models: [definition],
				tokensPerSecond: 100_000,
			});
			const modelsPath = override === undefined ? null : join(agentDir, "models.json");
			if (modelsPath) {
				writeFileSync(
					modelsPath,
					JSON.stringify({
						providers: {
							"image-count-probe": {
								modelOverrides: { [id]: { inputLimits: { images: { maxPerRequest: override } } } },
							},
						},
					}),
				);
			}
			const runtime = await ModelRuntime.create({
				credentials: new InMemoryCredentialStore(),
				modelsPath,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			runtime.registerProvider(faux.provider, {
				api: faux.api,
				baseUrl: "http://127.0.0.1/unused-in-process-faux",
				apiKey: "faux",
				streamSimple: faux.streamSimple,
				models: [{ ...definition, api: faux.api }],
			});
			const model = runtime.getModel(faux.provider, id);
			if (!model) throw new Error("count-probe model was not registered");
			expect(model.inputLimits?.images?.maxPerRequest).toBe(override ?? declared);
			const settingsManager = SettingsManager.inMemory({
				compaction: { enabled: false },
				retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 },
				images: { autoResize: false },
			});
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager,
				extensionFactories: [oversizedImageGuard],
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			});
			await resourceLoader.reload();
			expect(resourceLoader.getExtensions().errors).toEqual([]);
			const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));
			const history: UserMessage[] = Array.from({ length: images }, (_, index) => ({
				role: "user",
				content: [
					{ type: "text", text: `capture-${index}` },
					{ type: "image", data: PNG, mimeType: "image/png" },
				],
				timestamp: index,
			}));
			for (const message of history) sessionManager.appendMessage(message);
			sessionManager.appendMessage(fauxAssistantMessage("Previous screenshots recorded."));
			const sessionFile = sessionManager.getSessionFile();
			if (!sessionFile) throw new Error("count-probe session has no durable transcript");
			const originalFile = readFileSync(sessionFile, "utf8");
			const requests: TranscriptContext[] = [];
			const reply = (context: TranscriptContext) => {
				requests.push(structuredClone(context));
				if (requests.length === 1)
					return fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 rate limit" });
				return fauxAssistantMessage("continued");
			};
			faux.setResponses([reply, reply, reply]);
			const { session } = await createAgentSession({
				cwd,
				agentDir,
				model,
				modelRuntime: runtime,
				settingsManager,
				resourceLoader,
				sessionManager,
			});
			let retryStarts = 0;
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "auto_retry_start") retryStarts++;
			});
			try {
				await session.prompt("Continue without attaching another image.");
				await session.prompt("Continue again.");
				expect(retryStarts).toBe(1);
				expect(faux.state.callCount).toBe(3);
				expect(requests.map((request) => imageCount(request.messages))).toEqual([kept, kept, kept]);
				for (const request of requests) {
					const captions = request.messages.flatMap((message) =>
						Array.isArray(message.content)
							? message.content.flatMap((block) =>
									block.type === "text" && block.text.startsWith("capture-") ? [block.text] : [],
								)
							: [],
					);
					expect(captions).toEqual(
						Array.from({ length: images }, (_, index) => `capture-${index}`),
					);
					const retainedCaptions = request.messages.flatMap((message) =>
						Array.isArray(message.content) &&
						message.content.some((block) => block.type === "image")
							? message.content.flatMap((block) =>
									block.type === "text" && block.text.startsWith("capture-") ? [block.text] : [],
								)
							: [],
					);
					expect(retainedCaptions).toEqual(
						Array.from({ length: kept }, (_, index) => `capture-${images - kept + index}`),
					);
				}
				expect(imageCount(session.messages)).toBe(images);
				expect(session.messages.slice(0, images)).toEqual(history);
				const saved = readFileSync(sessionFile, "utf8");
				expect(saved.startsWith(originalFile)).toBe(true);
				expect(saved).not.toContain("older image omitted");
			} finally {
				unsubscribe();
				session.dispose();
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);
