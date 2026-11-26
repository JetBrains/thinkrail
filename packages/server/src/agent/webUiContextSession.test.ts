import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionError,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import {
	cancelExtUiForSession,
	createWebUiContext,
	notifyExtensionError,
	pendingExtUiDialog,
	resolveExtUi,
	setExtUiPublisher,
} from "./webUiContext";

test("real pi commands can fall back from custom UI, cancel the fallback, and report uncaught failures", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-custom-ui-"));
	try {
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir);
		const faux = createFauxCore({ provider: "custom-ui-probe", api: "custom-ui-probe" });
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		runtime.registerProvider(faux.provider, {
			api: faux.api,
			baseUrl: "http://127.0.0.1/unused-in-process-faux",
			apiKey: "fixture-only",
			streamSimple: faux.streamSimple,
			models: faux.models,
		});
		const settingsManager = SettingsManager.inMemory();
		const contexts: { mode: string; hasUI: boolean }[] = [];
		const caughtCodes: string[] = [];
		let factoryCalls = 0;
		const terminalFactory = () => {
			factoryCalls++;
			throw new Error("Terminal factory must not run on the web");
		};
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				(pi) => {
					pi.registerCommand("custom-fallback", {
						handler: async (_args, ctx) => {
							contexts.push({ mode: ctx.mode, hasUI: ctx.hasUI });
							let answer: string | undefined;
							try {
								answer = await ctx.ui.custom<string | undefined>(terminalFactory);
							} catch (error) {
								if (
									!(error instanceof Error) ||
									!("code" in error) ||
									error.code !== "EXTENSION_UI_UNSUPPORTED"
								)
									throw error;
								caughtCodes.push(error.code);
								answer = await ctx.ui.input("Fallback draft");
							}
							if (answer !== undefined) ctx.ui.setEditorText(answer);
						},
					});
					pi.registerCommand("custom-uncaught", {
						handler: async (_args, ctx) => {
							await ctx.ui.custom(terminalFactory);
							ctx.ui.setEditorText("must not reach the composer");
						},
					});
				},
			],
		});
		await resourceLoader.reload();
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: faux.getModel(),
			modelRuntime: runtime,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.inMemory(cwd),
		});
		const frames: ExtUiRequest[] = [];
		const errors: ExtensionError[] = [];
		try {
			await session.bindExtensions({
				mode: "rpc",
				uiContext: createWebUiContext(session.sessionId),
				onError: (error) => {
					errors.push(error);
					notifyExtensionError(session.sessionId, error);
				},
			});
			for (const answer of ["Fallback draft 中文", null]) {
				frames.length = 0;
				const asking = Promise.withResolvers<Extract<ExtUiRequest, { kind: "input" }>>();
				setExtUiPublisher((frame) => {
					frames.push(frame);
					if (frame.kind === "input") asking.resolve(frame);
				});
				const command = session.prompt("/custom-fallback");
				const request = await Promise.race([
					asking.promise,
					command.then(() => {
						throw new Error("The command returned without asking its fallback dialog");
					}),
				]);
				expect(request).toMatchObject({
					sessionId: session.sessionId,
					title: "Fallback draft",
				});
				expect(pendingExtUiDialog(session.sessionId)?.id).toBe(request.id);
				resolveExtUi({ id: request.id, value: answer });
				await command;
				expect(pendingExtUiDialog(session.sessionId)).toBeNull();
				expect(frames.filter((frame) => frame.kind === "setEditorText")).toEqual(
					answer === null
						? []
						: [
								{
									id: expect.any(String),
									sessionId: session.sessionId,
									kind: "setEditorText",
									text: answer,
								},
							],
				);
			}
			expect(contexts).toEqual([
				{ mode: "rpc", hasUI: true },
				{ mode: "rpc", hasUI: true },
			]);
			expect(caughtCodes).toEqual(["EXTENSION_UI_UNSUPPORTED", "EXTENSION_UI_UNSUPPORTED"]);
			expect(errors).toEqual([]);
			frames.length = 0;
			await session.prompt("/custom-uncaught");
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatchObject({
				extensionPath: "command:custom-uncaught",
				event: "command",
				error: expect.stringContaining("ui.input()"),
			});
			expect(frames).toEqual([
				{
					id: expect.any(String),
					sessionId: session.sessionId,
					kind: "notify",
					level: "error",
					message: expect.stringContaining("Extension command:custom-uncaught failed on command"),
				},
			]);
			expect(factoryCalls).toBe(0);
			expect(faux.state.callCount).toBe(0);
		} finally {
			cancelExtUiForSession(session.sessionId);
			setExtUiPublisher(() => {});
			session.dispose();
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
