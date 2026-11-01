import { describe, expect, test } from "bun:test";
import {
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import {
	ANTIGRAVITY_API,
	ANTIGRAVITY_MODELS,
	AUTH_URL,
	buildRequest,
	CLIENT_ID,
	convertAssistantMessage,
	convertMessages,
	convertTools,
	defaultProjectId,
	generatePKCE,
	getAntigravityApiKey,
	getAntigravityRequestModelId,
	getMaxOutputTokens,
	getThinkingConfig,
	handleCallbackRequest,
	loginAntigravity,
	parseAntigravityApiKey,
	parsePastedCallback,
	REDIRECT_URI,
	refreshAntigravityToken,
	stableProjectId,
	streamResponse,
	TOKEN_URL,
} from "./index";
import {
	buildAntigravityCatalog,
	getAntigravityModelEnum,
	refreshAntigravityModels,
	resetAntigravityCatalogForTests,
} from "./models";

describe("PKCE and Callback parsing", () => {
	test("generatePKCE generates url-safe verifier and challenge", () => {
		const { verifier, challenge } = generatePKCE();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(challenge.length).toBeGreaterThanOrEqual(43);
		expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
		expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
	});

	test("parsePastedCallback extracts code and validates state from full URL", () => {
		const parsed = parsePastedCallback(
			"http://localhost:51121/oauth-callback?state=state123&code=code456",
			"state123",
		);
		expect(parsed).toEqual({ code: "code456", state: "state123" });
	});

	test("parsePastedCallback handles query strings with and without leading ?", () => {
		expect(parsePastedCallback("?state=s1&code=c1", "s1")).toEqual({ code: "c1", state: "s1" });
		expect(parsePastedCallback("state=s2&code=c2", "s2")).toEqual({ code: "c2", state: "s2" });
	});

	test("parsePastedCallback accepts a bare authorization code", () => {
		expect(parsePastedCallback("4/0Afrb_valid_auth_code_12345", "stateX")).toEqual({
			code: "4/0Afrb_valid_auth_code_12345",
			state: "stateX",
		});
	});

	test("parsePastedCallback rejects state mismatch", () => {
		expect(() =>
			parsePastedCallback("http://localhost:51121/oauth-callback?state=wrong&code=c", "expected"),
		).toThrow("State mismatch");
	});

	test("parsePastedCallback rejects oauth error from browser", () => {
		expect(() =>
			parsePastedCallback("http://localhost:51121/oauth-callback?error=access_denied&state=s", "s"),
		).toThrow("access_denied");
	});

	test("parsePastedCallback rejects empty text", () => {
		expect(() => parsePastedCallback("", "s")).toThrow("No callback pasted");
	});

	test("handleCallbackRequest validates HTTP method, path, and credentials", () => {
		expect(handleCallbackRequest({ method: "POST" }, "s1")).toEqual({
			ok: false,
			status: 405,
			body: "Method Not Allowed",
			error: "Method not allowed",
		});
		expect(handleCallbackRequest({ method: "GET", url: "/other" }, "s1")).toEqual({
			ok: false,
			status: 404,
			body: "Antigravity OAuth callback route not found.",
			error: "Route not found",
		});
		expect(
			handleCallbackRequest({ method: "GET", url: "/oauth-callback?error=access_denied" }, "s1"),
		).toEqual({
			ok: false,
			status: 400,
			body: "Antigravity authentication failed: access_denied",
			error: "OAuth error: access_denied",
		});
		expect(
			handleCallbackRequest({ method: "GET", url: "/oauth-callback?code=c1&state=wrong" }, "s1"),
		).toEqual({
			ok: false,
			status: 400,
			body: "Antigravity authentication failed: invalid state.",
			error: "OAuth state mismatch",
		});
		expect(
			handleCallbackRequest({ method: "GET", url: "/oauth-callback?code=c1&state=s1" }, "s1"),
		).toEqual({
			ok: true,
			status: 200,
			body: "Antigravity authentication complete. You can close this window and return to ThinkRail.",
			code: "c1",
			state: "s1",
		});
	});
});

describe("Client & Project ID Helpers", () => {
	test("stableProjectId creates deterministic UUID", () => {
		const id1 = stableProjectId("user@example.com");
		const id2 = stableProjectId("user@example.com");
		const id3 = stableProjectId("other@example.com");
		expect(id1).toBe(id2);
		expect(id1).not.toBe(id3);
		expect(id1.split("-").length).toBe(5);
	});

	test("defaultProjectId respects environment override or derives from seed", () => {
		const originalEnv = process.env.ANTIGRAVITY_PROJECT_ID;
		try {
			delete process.env.ANTIGRAVITY_PROJECT_ID;
			expect(defaultProjectId("foo")).toBe(stableProjectId("foo"));

			process.env.ANTIGRAVITY_PROJECT_ID = "custom-project-99";
			expect(defaultProjectId("foo")).toBe("custom-project-99");
		} finally {
			if (originalEnv === undefined) delete process.env.ANTIGRAVITY_PROJECT_ID;
			else process.env.ANTIGRAVITY_PROJECT_ID = originalEnv;
		}
	});

	test("parseAntigravityApiKey parses valid JSON and throws on missing fields", () => {
		expect(parseAntigravityApiKey(JSON.stringify({ token: "tok1", projectId: "proj1" }))).toEqual({
			token: "tok1",
			projectId: "proj1",
		});
		expect(() => parseAntigravityApiKey("")).toThrow("No Antigravity credentials available");
		expect(() => parseAntigravityApiKey(JSON.stringify({ token: "tok" }))).toThrow(
			"missing token or projectId",
		);
	});

	test("getAntigravityApiKey serializes access token and projectId", () => {
		const serialized = getAntigravityApiKey({
			access: "acc-123",
			refresh: "ref-456",
			expires: Date.now() + 60000,
			projectId: "my-project",
		});
		const parsed = JSON.parse(serialized);
		expect(parsed).toEqual({
			token: "acc-123",
			projectId: "my-project",
		});
	});
});

describe("OAuth Login Flow", () => {
	test("loopback callback receives redirect and completes login", async () => {
		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input instanceof Request ? input.url : input);
				if (url.includes("127.0.0.1:51121") || url.includes("localhost:51121")) {
					return originalFetch(input, init);
				}
				if (url === TOKEN_URL) {
					return new Response(
						JSON.stringify({
							access_token: "mock-access-token",
							refresh_token: "mock-refresh-token",
							expires_in: 3600,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (url.includes("userinfo")) {
					return new Response(JSON.stringify({ email: "user@test.org" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (url.includes("loadCodeAssist")) {
					return new Response(JSON.stringify({ projectId: "discovered-project-1" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				return new Response("Not found", { status: 404 });
			}) as typeof fetch;

			let capturedAuthUrl = "";
			const loginPromise = loginAntigravity({
				onAuth: (info) => {
					capturedAuthUrl = info.url;
				},
				onPrompt: () => new Promise(() => {}),
				onDeviceCode: () => {},
				onSelect: () => Promise.resolve(undefined),
			});

			for (let i = 0; i < 20 && !capturedAuthUrl; i++) {
				await new Promise((res) => setTimeout(res, 20));
			}
			expect(capturedAuthUrl).toContain(AUTH_URL);
			expect(capturedAuthUrl).toContain(encodeURIComponent(CLIENT_ID));
			expect(capturedAuthUrl).toContain(encodeURIComponent(REDIRECT_URI));

			const urlObj = new URL(capturedAuthUrl);
			const state = urlObj.searchParams.get("state");
			expect(state).toBeTruthy();

			const callbackRes = await fetch(
				`http://127.0.0.1:51121/oauth-callback?state=${state}&code=sample-auth-code`,
			);
			expect(callbackRes.status).toBe(200);

			const creds = await loginPromise;
			expect(creds.access).toBe("mock-access-token");
			expect(creds.refresh).toBe("mock-refresh-token");
			expect(creds.projectId).toBe("discovered-project-1");
			expect(creds.email).toBe("user@test.org");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("manual code input fallback completes login when user pastes callback", async () => {
		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = (async (input: string | URL | Request) => {
				const url = String(input instanceof Request ? input.url : input);
				if (url === TOKEN_URL) {
					return new Response(
						JSON.stringify({
							access_token: "manual-access-token",
							refresh_token: "manual-refresh-token",
							expires_in: 3600,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (url.includes("userinfo")) {
					return new Response(JSON.stringify({ email: "manual@test.org" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (url.includes("loadCodeAssist")) {
					return new Response("Not found", { status: 404 });
				}
				return new Response("Not found", { status: 404 });
			}) as typeof fetch;

			let stateCaptured = "";
			const creds = await loginAntigravity({
				onAuth: (info) => {
					const urlObj = new URL(info.url);
					stateCaptured = urlObj.searchParams.get("state") || "";
				},
				onManualCodeInput: async () => {
					return `http://localhost:51121/oauth-callback?state=${stateCaptured}&code=manual-code-123`;
				},
				onPrompt: () => new Promise(() => {}),
				onDeviceCode: () => {},
				onSelect: () => Promise.resolve(undefined),
			});

			expect(creds.access).toBe("manual-access-token");
			expect(creds.refresh).toBe("manual-refresh-token");
			expect(creds.email).toBe("manual@test.org");
			expect(creds.projectId).toBe(defaultProjectId("manual@test.org"));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("refreshAntigravityToken sends refresh token and updates access token", async () => {
		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
				const body = String(init?.body || "");
				expect(body).toContain("grant_type=refresh_token");
				expect(body).toContain("refresh_token=old-refresh");
				return new Response(
					JSON.stringify({
						access_token: "new-access-token",
						refresh_token: "new-refresh-token",
						expires_in: 1800,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}) as typeof fetch;

			const updated = await refreshAntigravityToken({
				access: "old-access",
				refresh: "old-refresh",
				expires: 1000,
				projectId: "pinned-project",
				email: "foo@bar.com",
			});

			expect(updated.access).toBe("new-access-token");
			expect(updated.refresh).toBe("new-refresh-token");
			expect(updated.projectId).toBe("pinned-project");
			expect(updated.email).toBe("foo@bar.com");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("Model Catalog & Routing", () => {
	test("ANTIGRAVITY_MODELS exposes seed gemini-4-argon model", () => {
		const ids = ANTIGRAVITY_MODELS.map((m) => m.id);
		expect(ids).toEqual(["gemini-4-argon"]);
	});

	test("getAntigravityRequestModelId routes models according to thinking effort", () => {
		expect(getAntigravityRequestModelId("gemini-4-argon", "high")).toBe("gemini-4-argon-high");
		expect(getAntigravityRequestModelId("gemini-4-argon", "medium")).toBe("gemini-4-argon-medium");
		expect(getAntigravityRequestModelId("gemini-4-argon", "low")).toBe("gemini-4-argon-low");
		expect(getAntigravityRequestModelId("gemini-4-argon")).toBe("gemini-4-argon-medium");
		expect(getAntigravityRequestModelId("custom-unknown-model")).toBe("custom-unknown-model");
	});

	test("getThinkingConfig returns appropriate wire thinking budgets by family", () => {
		expect(getThinkingConfig("claude-opus-5-5", "high")).toEqual({
			includeThoughts: true,
			thinkingBudget: 1024,
		});
		expect(getThinkingConfig("claude-opus-5-5", "off")).toEqual({
			includeThoughts: false,
			thinkingBudget: 0,
		});
		expect(getThinkingConfig("gpt-oss-120b", "medium")).toEqual({
			includeThoughts: true,
			thinkingBudget: 8192,
		});
		expect(getThinkingConfig("gemini-4-argon", "high")).toEqual({
			includeThoughts: true,
			thinkingBudget: -1,
		});
		expect(getThinkingConfig("gemini-4-argon", "medium")).toEqual({
			includeThoughts: true,
			thinkingBudget: 4000,
		});
		expect(getThinkingConfig("gemini-4-argon", "low")).toEqual({
			includeThoughts: true,
			thinkingBudget: 1000,
		});
		expect(getThinkingConfig("gemini-4-argon", "off")).toBeUndefined();
	});

	test("getMaxOutputTokens enforces family maximum token bounds and dynamic lookup", () => {
		expect(getMaxOutputTokens("claude-anything")).toBe(64000);
		expect(getMaxOutputTokens("gpt-oss-120b")).toBe(32768);
		expect(getMaxOutputTokens("gemini-4-argon")).toBe(65536);
	});

	test("buildAntigravityCatalog parses dynamic models, collapses variants, and maps model_enum", () => {
		const mockResponse = {
			models: {
				"gemini-4-argon-high": {
					displayName: "Gemini 4 Argon (High)",
					model: "MODEL_PLACEHOLDER_M417",
					maxTokens: 1048576,
					maxOutputTokens: 65536,
					supportsImages: true,
				},
				"gemini-4-argon-medium": {
					displayName: "Gemini 4 Argon (Medium)",
					model: "MODEL_PLACEHOLDER_M418",
					maxTokens: 1048576,
					maxOutputTokens: 65536,
					supportsImages: true,
				},
				"gemini-4-argon-low": {
					displayName: "Gemini 4 Argon (Low)",
					model: "MODEL_PLACEHOLDER_M419",
					maxTokens: 1048576,
					maxOutputTokens: 65536,
					supportsImages: true,
				},
				"claude-opus-5-5-high": {
					displayName: "Claude Opus 5.5 (High)",
					model: "MODEL_PLACEHOLDER_M402",
					maxTokens: 1000000,
					maxOutputTokens: 128000,
					supportsImages: true,
				},
				"claude-opus-5-5-medium": {
					displayName: "Claude Opus 5.5 (Medium)",
					model: "MODEL_PLACEHOLDER_M401",
					maxTokens: 1000000,
					maxOutputTokens: 128000,
					supportsImages: true,
				},
				"claude-opus-5-5-low": {
					displayName: "Claude Opus 5.5 (Low)",
					model: "MODEL_PLACEHOLDER_M400",
					maxTokens: 1000000,
					maxOutputTokens: 128000,
					supportsImages: true,
				},
				"gpt-oss-120b-medium": {
					displayName: "GPT-OSS 120B (Medium)",
					model: "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
					maxTokens: 131072,
					maxOutputTokens: 32768,
				},
				"gemini-3.5-flash-lite": {
					displayName: "Gemini 3.5 Flash Lite",
					model: "MODEL_PLACEHOLDER_LITE",
					maxTokens: 524288,
					maxOutputTokens: 32768,
					supportsImages: true,
				},
				tab_flash_lite_preview: {
					model: "TAB_1",
					maxTokens: 100000,
				},
				chat_20706: {
					model: "CHAT_INTERNAL",
					maxTokens: 100000,
				},
			},
			agentModelSorts: [
				{
					groups: [
						{
							modelIds: [
								"gemini-4-argon-medium",
								"gemini-4-argon-high",
								"gemini-4-argon-low",
								"claude-opus-5-5-low",
								"claude-opus-5-5-medium",
								"claude-opus-5-5-high",
								"gpt-oss-120b-medium",
								"gemini-3.5-flash-lite",
							],
						},
					],
				},
			],
		};

		const catalog = buildAntigravityCatalog(mockResponse);
		const ids = catalog.map((m) => m.id);

		expect(ids).toContain("gemini-4-argon");
		expect(ids).toContain("claude-opus-5-5");
		expect(ids).toContain("gpt-oss-120b");
		expect(ids).toContain("gemini-3.5-flash-lite");
		expect(ids).not.toContain("tab_flash_lite_preview");
		expect(ids).not.toContain("chat_20706");

		const argon = catalog.find((m) => m.id === "gemini-4-argon");
		expect(argon).toBeDefined();
		expect(argon && "thinkingLevelMap" in argon && "maxTokens" in argon).toBe(true);
		if (argon && "thinkingLevelMap" in argon && "maxTokens" in argon) {
			expect(argon.reasoning).toBe(true);
			expect(argon.thinkingLevelMap?.low).toBe("low");
			expect(argon.thinkingLevelMap?.medium).toBe("medium");
			expect(argon.thinkingLevelMap?.high).toBe("high");
			expect(argon.contextWindow).toBe(1048576);
			expect(argon.maxTokens).toBe(65536);
		}

		expect(getAntigravityModelEnum("gemini-4-argon-medium")).toBe("MODEL_PLACEHOLDER_M418");
		expect(getAntigravityModelEnum("gemini-4-argon-high")).toBe("MODEL_PLACEHOLDER_M417");
		expect(getAntigravityModelEnum("gemini-3.5-flash-lite")).toBe("MODEL_PLACEHOLDER_LITE");

		expect(ids).not.toContain("gemini-3.1-pro");
		expect(ids).not.toContain("claude-opus-4-6");

		expect(getMaxOutputTokens("claude-opus-5-5")).toBe(128000);
		expect(getAntigravityRequestModelId("claude-opus-5-5", "high")).toBe("claude-opus-5-5-high");
		expect(getAntigravityRequestModelId("claude-opus-5-5", "low")).toBe("claude-opus-5-5-low");
		expect(getAntigravityRequestModelId("claude-opus-5-5")).toBe("claude-opus-5-5-medium");
	});

	test("refreshAntigravityModels caches fetched catalog across allowNetwork: false and resets on credential loss", async () => {
		resetAntigravityCatalogForTests();

		const originalFetch = globalThis.fetch;
		try {
			const mockPayload = {
				models: {
					"gemini-4-argon-medium": {
						displayName: "Gemini 4 Argon (Medium)",
						model: "MODEL_PLACEHOLDER_M418",
						maxTokens: 1048576,
						maxOutputTokens: 65536,
						supportsImages: true,
					},
				},
				agentModelSorts: [
					{
						groups: [{ modelIds: ["gemini-4-argon-medium"] }],
					},
				],
			};

			globalThis.fetch = (async (input: string | URL | Request) => {
				const url = String(input instanceof Request ? input.url : input);
				if (url.includes("fetchAvailableModels")) {
					return new Response(JSON.stringify(mockPayload), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				return new Response("Not found", { status: 404 });
			}) as typeof fetch;

			const credential = {
				type: "api_key" as const,
				key: JSON.stringify({ token: "tok", projectId: "proj" }),
			};

			const makeContext = (options: {
				allowNetwork: boolean;
				credential?: { type: "api_key"; key: string } | undefined;
			}): RefreshModelsContext => ({
				allowNetwork: options.allowNetwork,
				signal: new AbortController().signal,
				publish: async () => true,
				...(options.credential ? { credential: options.credential } : {}),
			});

			const initialOffline = await refreshAntigravityModels(
				makeContext({
					allowNetwork: false,
					credential,
				}),
			);
			expect(initialOffline).toEqual(ANTIGRAVITY_MODELS);

			const online = await refreshAntigravityModels(
				makeContext({
					allowNetwork: true,
					credential,
				}),
			);
			expect(online.map((m) => m.id)).toEqual(["gemini-4-argon"]);

			const cachedOffline = await refreshAntigravityModels(
				makeContext({
					allowNetwork: false,
					credential,
				}),
			);
			expect(cachedOffline.map((m) => m.id)).toEqual(["gemini-4-argon"]);

			const unauthenticated = await refreshAntigravityModels(
				makeContext({
					allowNetwork: false,
				}),
			);
			expect(unauthenticated).toEqual(ANTIGRAVITY_MODELS);

			const afterResetOffline = await refreshAntigravityModels(
				makeContext({
					allowNetwork: false,
					credential,
				}),
			);
			expect(afterResetOffline).toEqual(ANTIGRAVITY_MODELS);
		} finally {
			globalThis.fetch = originalFetch;
			resetAntigravityCatalogForTests();
		}
	});
});

describe("Request Building and Streaming Adapter", () => {
	const model: Model<typeof ANTIGRAVITY_API> = {
		id: "gemini-3.8-flash",
		name: "Gemini 3.8 Flash (Antigravity)",
		api: ANTIGRAVITY_API,
		provider: "antigravity",
		baseUrl: "https://daily-cloudcode-pa.googleapis.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
		contextWindow: 1048576,
		maxTokens: 65536,
	};

	test("buildRequest produces valid Antigravity envelope with messages and tools", () => {
		const context: Context = {
			systemPrompt: "Follow instructions carefully.",
			messages: [
				{ role: "user", content: "List all files", timestamp: Date.now() },
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "ls",
							arguments: { path: "." },
						},
					],
					api: ANTIGRAVITY_API,
					provider: "antigravity",
					model: "gemini-3.8-flash",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "call_1",
					toolName: "ls",
					content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
					isError: false,
					timestamp: Date.now(),
				},
			],
			tools: [
				{
					name: "ls",
					description: "List directory contents",
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
				},
			],
		};

		const req = buildRequest(model, context, "test-project", {}, "gemini-3.8-flash-low");
		expect(req.project).toBe("test-project");
		expect(req.model).toBe("gemini-3.8-flash-low");
		expect(req.requestType).toBe("agent");

		const innerReq = req.request as Record<string, unknown>;
		expect(innerReq.systemInstruction).toBeDefined();
		expect(innerReq.tools).toBeDefined();
		expect(Array.isArray(innerReq.contents)).toBe(true);

		const converted = convertMessages(model, context, "gemini-3.8-flash-low");
		expect(converted.length).toBeGreaterThan(0);
		const toolsDecl = convertTools(context.tools, false);
		expect(toolsDecl?.[0]?.functionDeclarations?.[0]?.name).toBe("ls");
	});

	test("buildRequest emits model_enum in labels when known", () => {
		const argonModel: Model<typeof ANTIGRAVITY_API> = {
			id: "gemini-4-argon",
			name: "Gemini 4 Argon (Antigravity)",
			api: ANTIGRAVITY_API,
			provider: "antigravity",
			baseUrl: "https://daily-cloudcode-pa.googleapis.com",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.25, output: 5.0, cacheRead: 0.3125, cacheWrite: 1.25 },
			contextWindow: 1048576,
			maxTokens: 65536,
		};
		const context: Context = {
			messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
		};
		const req = buildRequest(argonModel, context, "proj1", {}, "gemini-4-argon-medium");
		const innerReq = req.request as { labels?: Record<string, string> };
		expect(innerReq.labels?.model_enum).toBe("MODEL_PLACEHOLDER_M418");

		const argonHighReq = buildRequest(argonModel, context, "proj1", {}, "gemini-4-argon-high");
		const argonHighInnerReq = argonHighReq.request as { labels?: Record<string, string> };
		expect(argonHighInnerReq.labels?.model_enum).toBe("MODEL_PLACEHOLDER_M417");
	});

	test("convertAssistantMessage strips non-Claude thinking and thoughtSignature when targeting Claude", () => {
		const claudeModel: Model<typeof ANTIGRAVITY_API> = {
			...model,
			id: "claude-sonnet-5-5",
			name: "Claude Sonnet 5.5",
		};
		const assistantMsg: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "My thoughts", thinkingSignature: "gemini-sig" },
				{ type: "text", text: "Hello", textSignature: "gemini-text-sig" },
			],
			api: ANTIGRAVITY_API,
			provider: "antigravity",
			model: "gemini-4-argon",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		const parts = convertAssistantMessage(assistantMsg, claudeModel, "claude-sonnet-5-5-medium");
		expect(parts).toHaveLength(1);
		expect(parts[0]).toEqual({ text: "Hello" });
	});

	test("streamResponse parses SSE thinking, text, and functionCall chunks", async () => {
		const ssePayload = [
			'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking step 1...","thoughtSignature":"sig123"}]}}]}}\n\n',
			'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello, world!"}]}}]}}\n\n',
			'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"foo.ts"},"id":"fn1"}}]}}]}}\n\n',
			'data: {"response":{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":20,"totalTokenCount":70}}}\n\n',
		].join("");

		const stream = createAssistantMessageEventStream();
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		const mockResponse = new Response(ssePayload, {
			headers: { "Content-Type": "text/event-stream" },
		});

		const result = await streamResponse(mockResponse, stream, output, model);

		expect(result).toBe(true);
		expect(output.content.length).toBe(3);
		const block0 = output.content[0];
		expect(block0?.type).toBe("thinking");
		if (block0?.type === "thinking") {
			expect(block0.thinking).toBe("Thinking step 1...");
			expect(block0.thinkingSignature).toBe("sig123");
		}
		const block1 = output.content[1];
		expect(block1?.type).toBe("text");
		if (block1?.type === "text") {
			expect(block1.text).toBe("Hello, world!");
		}
		const block2 = output.content[2];
		expect(block2?.type).toBe("toolCall");
		if (block2?.type === "toolCall") {
			expect(block2.name).toBe("read_file");
		}
		expect(output.stopReason).toBe("toolUse");
		expect(output.usage.totalTokens).toBe(70);
	});
});
