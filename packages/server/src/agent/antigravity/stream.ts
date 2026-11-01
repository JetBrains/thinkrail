import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	calculateCost,
	createAssistantMessageEventStream,
	type JsonObject,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
	antigravityHeaders,
	endpointCandidates,
	parseAntigravityApiKey,
	resolveProjectId,
	stableProjectId,
} from "./client";
import {
	getAntigravityModelEnum,
	getAntigravityRequestModelId,
	getMaxOutputTokens,
	getThinkingConfig,
} from "./models";

export const ANTIGRAVITY_API = "antigravity-api" as const;

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
	"You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. " +
	"You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.";

const CONTINUATION_TEXT = "Continue the active task using the available instructions and context.";

interface GeminiTextPart {
	text: string;
	thoughtSignature?: string;
}

interface GeminiInlineDataPart {
	inlineData: { mimeType: string; data: string };
}

interface GeminiThoughtPart {
	thought: true;
	text: string;
	thoughtSignature?: string;
}

interface GeminiFunctionCallPart {
	functionCall: {
		name: string;
		args: Record<string, unknown>;
		id?: string;
	};
	thoughtSignature?: string;
}

interface GeminiFunctionResponsePart {
	functionResponse: {
		name: string;
		response: { error: string } | { output: string };
		id?: string;
	};
}

type GeminiPart =
	| GeminiTextPart
	| GeminiInlineDataPart
	| GeminiThoughtPart
	| GeminiFunctionCallPart
	| GeminiFunctionResponsePart;

interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
	name: string;
	description: string;
	parameters?: unknown;
	parametersJsonSchema?: unknown;
}

let toolCallCounter = 0;

function sanitizeToolCallId(id: string, fallbackName?: string): string {
	const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	const capped = cleaned.slice(0, 64);
	return capped || `${fallbackName || "tool"}_${++toolCallCounter}`;
}

function toolCallIdNeeded(modelId: string, runtimeModel: string): boolean {
	return (
		modelId.startsWith("claude-") ||
		modelId.startsWith("gpt-oss-") ||
		runtimeModel.startsWith("claude-") ||
		runtimeModel.startsWith("gpt-oss-")
	);
}

function toJsonObject(value: unknown): JsonObject {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as JsonObject;
	}
	return {};
}

function parseImageData(raw: string, explicitMime?: string): { data: string; mimeType: string } {
	const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
	if (match) {
		const parsedMime = match[1];
		const parsedData = match[2];
		return {
			mimeType: explicitMime || parsedMime || "image/png",
			data: (parsedData ?? "").trim(),
		};
	}
	return {
		mimeType: explicitMime || "image/png",
		data: raw.trim(),
	};
}

function asTextParts(content: unknown): GeminiPart[] {
	if (typeof content === "string") {
		return content.trim() ? [{ text: content }] : [];
	}
	if (!Array.isArray(content)) return [];
	const parts: GeminiPart[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
			parts.push({ text: block.text });
		} else if (block.type === "image" && typeof block.data === "string") {
			parts.push({
				inlineData: parseImageData(
					block.data,
					typeof block.mimeType === "string" ? block.mimeType : undefined,
				),
			});
		}
	}
	return parts;
}

function asImageParts(content: unknown): GeminiInlineDataPart[] {
	if (!Array.isArray(content)) return [];
	const parts: GeminiInlineDataPart[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			block.type === "image" &&
			typeof block.data === "string"
		) {
			parts.push({
				inlineData: parseImageData(
					block.data,
					typeof block.mimeType === "string" ? block.mimeType : undefined,
				),
			});
		}
	}
	return parts;
}

function appendTurn(contents: GeminiContent[], role: "user" | "model", parts: GeminiPart[]): void {
	if (!parts.length) return;
	const last = contents[contents.length - 1];
	if (last && last.role === role) {
		last.parts.push(...parts);
	} else {
		contents.push({ role, parts });
	}
}

export function convertAssistantMessage(
	msg: AssistantMessage,
	model: Model<Api>,
	runtimeModel: string,
): GeminiPart[] {
	if (msg.stopReason === "error" || msg.stopReason === "aborted") {
		return [];
	}
	const isClaude = model.id.startsWith("claude-") || runtimeModel.startsWith("claude-");
	const parts: GeminiPart[] = [];
	for (const block of msg.content) {
		if (block.type === "text") {
			if (!block.text || block.text.trim() === "") continue;
			parts.push({
				text: block.text,
				...(!isClaude && block.textSignature ? { thoughtSignature: block.textSignature } : {}),
			});
		} else if (block.type === "thinking" && String(block.thinking || "").trim()) {
			if (!isClaude) {
				parts.push({
					thought: true,
					text: block.thinking,
					...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}),
				});
			}
		} else if (block.type === "toolCall") {
			parts.push({
				functionCall: {
					name: block.name,
					args: (block.arguments as Record<string, unknown>) ?? {},
					...(toolCallIdNeeded(model.id, runtimeModel)
						? { id: sanitizeToolCallId(block.id || "", block.name) }
						: {}),
				},
				...(!isClaude && block.thoughtSignature
					? { thoughtSignature: block.thoughtSignature }
					: {}),
			});
		}
	}
	return parts;
}

export function convertToolResultMessage(
	msg: ToolResultMessage,
	model: Model<Api>,
	runtimeModel: string,
): GeminiPart[] {
	const text = msg.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
	const responseText = text || (msg.isError ? "Tool failed" : "");
	const imageParts = asImageParts(msg.content);
	const part: GeminiFunctionResponsePart = {
		functionResponse: {
			name: msg.toolName,
			response: msg.isError ? { error: responseText } : { output: responseText },
			...(toolCallIdNeeded(model.id, runtimeModel)
				? { id: sanitizeToolCallId(msg.toolCallId || "", msg.toolName) }
				: {}),
		},
	};
	return [part, ...imageParts];
}

export function convertMessages(
	model: Model<Api>,
	context: Context,
	runtimeModel: string,
): GeminiContent[] {
	const contents: GeminiContent[] = [];

	for (const msg of context.messages) {
		if ((msg.role as string) === "system") continue;
		if (msg.role === "user") {
			appendTurn(contents, "user", asTextParts(msg.content));
		} else if (msg.role === "assistant") {
			appendTurn(contents, "model", convertAssistantMessage(msg, model, runtimeModel));
		} else if (msg.role === "toolResult") {
			appendTurn(contents, "user", convertToolResultMessage(msg, model, runtimeModel));
		}
	}

	for (let index = 0; index < contents.length; index += 1) {
		const turn = contents[index];
		if (
			turn &&
			turn.role === "model" &&
			turn.parts.some((part) => "functionCall" in part) &&
			contents[index - 1]?.role !== "user"
		) {
			contents.splice(index, 0, {
				role: "user",
				parts: [{ text: CONTINUATION_TEXT }],
			});
			index += 1;
		}
	}

	const hasUserText = contents.some(
		(turn) =>
			turn.role === "user" &&
			turn.parts.some((part) => "text" in part && Boolean(part.text.trim())),
	);
	if (!hasUserText) {
		contents.unshift({
			role: "user",
			parts: [{ text: "Apply the active system instructions." }],
		});
	}

	return contents;
}

const CUSTOM_TOOL_SCHEMA_ALLOW = new Set([
	"type",
	"description",
	"properties",
	"required",
	"items",
	"enum",
]);

function normalizeCustomToolSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema;
	if (Array.isArray(schema)) return schema.map(normalizeCustomToolSchema);

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		if (!CUSTOM_TOOL_SCHEMA_ALLOW.has(key)) continue;
		if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
			const props: Record<string, unknown> = {};
			for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
				props[propName] = normalizeCustomToolSchema(propSchema);
			}
			out.properties = props;
			continue;
		}
		out[key] = normalizeCustomToolSchema(value);
	}
	return out;
}

export function convertTools(
	tools: Tool[] | undefined,
	useLegacyParameters = false,
): { functionDeclarations: GeminiFunctionDeclaration[] }[] | undefined {
	if (!tools?.length) return undefined;

	const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => {
		const rawSchema = tool.parameters ?? { type: "object", properties: {} };
		return {
			name: tool.name,
			description: tool.description,
			...(useLegacyParameters
				? { parameters: normalizeCustomToolSchema(rawSchema) }
				: { parametersJsonSchema: rawSchema }),
		};
	});

	if (!functionDeclarations.length) return undefined;
	return [{ functionDeclarations }];
}

export function buildRequest(
	model: Model<Api>,
	context: Context,
	projectId: string,
	options: SimpleStreamOptions,
	runtimeModel: string,
): Record<string, unknown> {
	const systemPromptText = context.systemPrompt?.trim() || ANTIGRAVITY_SYSTEM_INSTRUCTION;
	const systemParts: GeminiPart[] = [{ text: systemPromptText }];

	const contents = convertMessages(model, context, runtimeModel);

	const isClaude = model.id.startsWith("claude-") || runtimeModel.startsWith("claude-");
	const isNonGemini =
		isClaude || model.id.startsWith("gpt-oss-") || runtimeModel.startsWith("gpt-oss-");

	const tools = convertTools(context.tools, isNonGemini);

	const generationConfig: Record<string, unknown> = {};
	if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
	const thinking = getThinkingConfig(runtimeModel, options.reasoning ?? "off");
	if (thinking) generationConfig.thinkingConfig = thinking;
	const maxAllowed = getMaxOutputTokens(model.id, runtimeModel);
	generationConfig.maxOutputTokens = Math.min(
		options.maxTokens ?? maxAllowed,
		model.maxTokens || maxAllowed,
	);

	const step = Math.max(1, contents.length);
	const lastStepIndex = String(Math.max(0, contents.length - 1));
	const trajectoryId = stableProjectId(projectId);
	const requestIndex = context.messages.filter(
		(m) => m.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted",
	).length;

	const modelEnum = getAntigravityModelEnum(runtimeModel) ?? getAntigravityModelEnum(model.id);
	const labels: Record<string, string> = {
		last_step_index: lastStepIndex,
		request_id: `${trajectoryId}-${requestIndex}`,
		trajectory_id: trajectoryId,
		used_claude: isClaude ? "true" : "false",
		used_non_gemini_model: isNonGemini ? "true" : "false",
		...(modelEnum ? { model_enum: modelEnum } : {}),
	};

	const request: Record<string, unknown> = {
		contents,
		systemInstruction: {
			role: "user",
			parts: systemParts,
		},
		generationConfig,
		labels,
	};
	if (tools) request.tools = tools;

	return {
		project: projectId,
		model: runtimeModel,
		request,
		requestType: "agent",
		userAgent: "antigravity",
		requestId: `agent/${trajectoryId}/${Date.now()}/${step}`,
	};
}

type ActiveBlock =
	| { type: "text"; text: string; textSignature?: string }
	| { type: "thinking"; thinking: string; thinkingSignature?: string };

interface StreamContext {
	stream: AssistantMessageEventStream;
	output: AssistantMessage;
	currentBlock: ActiveBlock | null;
	started: boolean;
	hasContent: boolean;
	ensureStarted: () => void;
	finishCurrent: () => void;
	blockIndex: () => number;
}

function handleTextPart(
	part: { text?: string; thought?: boolean; thoughtSignature?: string },
	ctx: StreamContext,
): void {
	if (typeof part.text !== "string") return;
	ctx.hasContent = true;
	const isThinking = part.thought === true;
	const type = isThinking ? "thinking" : "text";

	let block = ctx.currentBlock;
	if (!block || block.type !== type) {
		ctx.finishCurrent();
		block = isThinking ? { type: "thinking", thinking: "" } : { type: "text", text: "" };
		ctx.currentBlock = block;
		ctx.output.content.push(block);
		ctx.ensureStarted();
		ctx.stream.push({
			type: isThinking ? "thinking_start" : "text_start",
			contentIndex: ctx.blockIndex(),
			partial: ctx.output,
		});
	}

	if (block.type === "thinking") {
		block.thinking += part.text;
		if (typeof part.thoughtSignature === "string") {
			block.thinkingSignature = part.thoughtSignature;
		}
		ctx.stream.push({
			type: "thinking_delta",
			contentIndex: ctx.blockIndex(),
			delta: part.text,
			partial: ctx.output,
		});
	} else {
		block.text += part.text;
		if (typeof part.thoughtSignature === "string") {
			block.textSignature = part.thoughtSignature;
		}
		ctx.stream.push({
			type: "text_delta",
			contentIndex: ctx.blockIndex(),
			delta: part.text,
			partial: ctx.output,
		});
	}
}

function handleFunctionCallPart(
	part: {
		functionCall?: { name?: string; args?: unknown; id?: string };
		thoughtSignature?: string;
	},
	ctx: StreamContext,
): void {
	const fc = part.functionCall;
	if (!fc || typeof fc !== "object") return;
	ctx.hasContent = true;
	ctx.finishCurrent();
	const toolCall: ToolCall = {
		type: "toolCall",
		id: sanitizeToolCallId(fc.id || "", fc.name),
		name: fc.name || "",
		arguments: toJsonObject(fc.args),
		...(typeof part.thoughtSignature === "string"
			? { thoughtSignature: part.thoughtSignature }
			: {}),
	};
	ctx.output.content.push(toolCall);
	ctx.ensureStarted();
	ctx.stream.push({ type: "toolcall_start", contentIndex: ctx.blockIndex(), partial: ctx.output });
	ctx.stream.push({
		type: "toolcall_delta",
		contentIndex: ctx.blockIndex(),
		delta: JSON.stringify(toolCall.arguments),
		partial: ctx.output,
	});
	ctx.stream.push({
		type: "toolcall_end",
		contentIndex: ctx.blockIndex(),
		toolCall,
		partial: ctx.output,
	});
}

function applyUsageMetadata(
	metadata: Record<string, number> | undefined,
	output: AssistantMessage,
	model?: Model<Api>,
): void {
	if (!metadata || typeof metadata !== "object") return;
	const prompt = metadata.promptTokenCount || 0;
	const cacheRead = metadata.cachedContentTokenCount || 0;
	const thoughts = metadata.thoughtsTokenCount || 0;
	output.usage.input = prompt - cacheRead;
	output.usage.output = (metadata.candidatesTokenCount || 0) + thoughts;
	output.usage.cacheRead = cacheRead;
	output.usage.totalTokens = metadata.totalTokenCount || 0;
	if (model?.cost) {
		calculateCost(model, output.usage);
	}
}

function processSseChunk(
	chunk: Record<string, unknown>,
	ctx: StreamContext,
	model?: Model<Api>,
): void {
	if (chunk.error && typeof chunk.error === "object") {
		const err = chunk.error as { message?: string };
		throw new Error(err.message || "Antigravity streaming error");
	}

	const responseData = (chunk.response || chunk) as Record<string, unknown>;
	const candidates = responseData.candidates as Array<Record<string, unknown>> | undefined;
	const candidate = candidates?.[0];
	const candidateContent = candidate?.content as
		| { parts?: Array<Record<string, unknown>> }
		| undefined;

	for (const part of candidateContent?.parts || []) {
		if (typeof part.text === "string") {
			handleTextPart(part, ctx);
		}
		if (part.functionCall && typeof part.functionCall === "object") {
			handleFunctionCallPart(part, ctx);
		}
	}

	if (typeof candidate?.finishReason === "string") {
		ctx.output.stopReason = ctx.output.content.some((b) => b.type === "toolCall")
			? "toolUse"
			: candidate.finishReason === "MAX_TOKENS"
				? "length"
				: "stop";
	}

	if (responseData.usageMetadata && typeof responseData.usageMetadata === "object") {
		applyUsageMetadata(responseData.usageMetadata as Record<string, number>, ctx.output, model);
	}
}

export async function streamResponse(
	response: Response,
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	model?: Model<Api>,
): Promise<boolean> {
	if (!response.body) throw new Error("No response body received from Antigravity");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let scanStart = 0;

	const ctx: StreamContext = {
		stream,
		output,
		currentBlock: null,
		started: false,
		hasContent: false,
		ensureStarted() {
			if (!ctx.started) {
				ctx.stream.push({ type: "start", partial: ctx.output });
				ctx.started = true;
			}
		},
		finishCurrent() {
			if (!ctx.currentBlock) return;
			if (ctx.currentBlock.type === "text") {
				ctx.stream.push({
					type: "text_end",
					contentIndex: ctx.blockIndex(),
					content: ctx.currentBlock.text,
					partial: ctx.output,
				});
			} else {
				ctx.stream.push({
					type: "thinking_end",
					contentIndex: ctx.blockIndex(),
					content: ctx.currentBlock.thinking,
					partial: ctx.output,
				});
			}
			ctx.currentBlock = null;
		},
		blockIndex() {
			return ctx.output.content.length - 1;
		},
	};

	const handleLine = (line: string) => {
		if (!line.startsWith("data:")) return;
		const json = line.slice(5).trim();
		if (!json || json === "[DONE]") return;

		let chunk: Record<string, unknown>;
		try {
			chunk = JSON.parse(json) as Record<string, unknown>;
		} catch {
			return;
		}

		processSseChunk(chunk, ctx, model);
	};

	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			if (!(result.value instanceof Uint8Array)) continue;
			buffer += decoder.decode(result.value, { stream: true });

			while (true) {
				const newlineIdx = buffer.indexOf("\n", scanStart);
				if (newlineIdx === -1) break;
				const line = buffer.slice(scanStart, newlineIdx);
				scanStart = newlineIdx + 1;
				handleLine(line.replace(/\r$/, ""));
			}

			if (scanStart > 0) {
				buffer = buffer.slice(scanStart);
				scanStart = 0;
			}
		}

		buffer += decoder.decode();
		if (buffer.length > 0) handleLine(buffer.replace(/\r$/, ""));
		ctx.finishCurrent();
		return ctx.hasContent;
	} finally {
		reader.releaseLock();
	}
}

export function streamAntigravity(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const opts = options ?? {};

	void (async () => {
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

		try {
			const creds = parseAntigravityApiKey(opts.apiKey);
			const projectId = resolveProjectId({
				token: creds.token,
				credentialProjectId: creds.projectId,
			});
			const effort = opts.reasoning ?? "off";
			const runtimeModel = getAntigravityRequestModelId(model.id, effort);
			const body = JSON.stringify(buildRequest(model, context, projectId, opts, runtimeModel));
			const requestHeaders = antigravityHeaders(creds.token);

			let response: Response | undefined;
			let lastText = "";
			for (const endpoint of endpointCandidates()) {
				try {
					response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
						method: "POST",
						headers: requestHeaders,
						body,
						...(opts.signal ? { signal: opts.signal } : {}),
					});
					if (response.ok) break;
					lastText = await response.text();
					if (
						response.status >= 400 &&
						response.status < 500 &&
						response.status !== 404 &&
						response.status !== 408
					) {
						break;
					}
				} catch {}
			}

			if (!response?.ok) {
				throw new Error(
					`Antigravity API error (${response?.status ?? 0}): ${lastText.slice(0, 300) || "endpoint unreachable"}`,
				);
			}

			const received = await streamResponse(response, stream, output, model);
			if (!received) {
				throw new Error("Antigravity API returned an empty response");
			}

			if (output.stopReason === "error" || output.stopReason === "aborted") {
				stream.push({ type: "error", reason: output.stopReason, error: output });
			} else {
				const reason = output.stopReason === "pending" ? "stop" : output.stopReason;
				stream.push({ type: "done", reason, message: output });
			}
			stream.end();
		} catch (error) {
			output.stopReason = opts.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
