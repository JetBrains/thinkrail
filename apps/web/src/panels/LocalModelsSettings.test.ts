import { expect, test } from "bun:test";
import type { LocalModelEndpoint } from "@thinkrail/contracts";
import { guessKind } from "./LocalModelsSettings";

function endpoint(
	baseUrl: string,
	chatTemplateThinking: boolean,
	reasoning: boolean,
): LocalModelEndpoint {
	return {
		id: "local-box",
		name: "box",
		baseUrl,
		hasApiKey: false,
		chatTemplateThinking,
		models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning, vision: false }],
	};
}

test("an edit keeps llama.cpp/vLLM thinking on a server whose port says nothing", () => {
	expect(guessKind(endpoint("https://llm.lan/v1", true, true))).toBe("llama.cpp");
	expect(guessKind(endpoint("http://gpu:9000/v1", true, true))).toBe("llama.cpp");
	expect(guessKind(endpoint("http://gpu:8000/v1", true, true))).toBe("vllm");
});

test("a reasoning model without the chat-template format is never guessed as llama.cpp/vLLM", () => {
	expect(guessKind(endpoint("http://gpu:8000/v1", false, true))).toBe("openai-compatible");
	expect(guessKind(endpoint("http://gpu:8080/v1", false, true))).toBe("openai-compatible");
	expect(guessKind(endpoint("http://localhost:11434/v1", false, true))).toBe("ollama");
});

test("without thinking settings the URL picks the kind", () => {
	expect(guessKind(endpoint("http://localhost:1234/v1", false, false))).toBe("lmstudio");
	expect(guessKind(endpoint("http://gpu:8000/v1", false, false))).toBe("vllm");
	expect(guessKind(endpoint("http://gpu:8000/openai", false, false))).toBe("openai-compatible");
	expect(guessKind(endpoint("not a url", false, false))).toBe("openai-compatible");
});
