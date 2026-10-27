import { describe, expect, test } from "bun:test";
import { type Model, normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";

const model: Model<"anthropic-messages"> = {
	id: "claude-x",
	name: "claude-x",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const frame = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const head =
	frame("message_start", {
		type: "message_start",
		message: {
			id: "m",
			type: "message",
			role: "assistant",
			model: "claude-x",
			content: [],
			stop_reason: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	}) +
	frame("content_block_start", {
		type: "content_block_start",
		index: 0,
		content_block: { type: "text", text: "" },
	}) +
	frame("content_block_delta", {
		type: "content_block_delta",
		index: 0,
		delta: { type: "text_delta", text: "hi" },
	}) +
	frame("content_block_stop", { type: "content_block_stop", index: 0 });

const tail =
	frame("message_delta", {
		type: "message_delta",
		delta: { stop_reason: "end_turn" },
		usage: { output_tokens: 2 },
	}) + frame("message_stop", { type: "message_stop" });

const complete = head + tail;
const completeEvents = [
	"message_start",
	"content_block_start",
	"content_block_delta",
	"content_block_stop",
	"message_delta",
	"message_stop",
];

async function run(chunks: Uint8Array[]) {
	const events: string[] = [];
	const respond = async () =>
		new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					for (const chunk of chunks) controller.enqueue(chunk);
					controller.close();
				},
			}),
			{ status: 200, headers: { "content-type": "text/event-stream" } },
		);
	const fetch = Object.assign(respond, { preconnect: globalThis.fetch.preconnect });
	const s = stream(
		model,
		normalizeContext({ messages: [{ role: "user", content: "x", timestamp: 0 }] }),
		{
			apiKey: "k",
			fetch,
			onProviderStreamEvent: (event) => {
				events.push((event as { type: string }).type);
			},
		},
	);
	for await (const _ of s) {
	}
	return { result: await s.result(), events };
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("pi-ai's Anthropic SSE framing (patched, earendil-works/pi#10390)", () => {
	test("A: a cut right after an event: line is the retryable truncation error", async () => {
		const { result } = await run([encode(`${head}event: content_block_start\n`)]);
		expect(result.errorMessage).toBe("Anthropic stream ended before message_stop");
		expect(isRetryableAssistantError(result)).toBe(true);
	});

	test("A: a cut inside an unfinished data: line is the retryable truncation error", async () => {
		const { result } = await run([
			encode(
				`${head}event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"ty`,
			),
		]);
		expect(result.errorMessage).toBe("Anthropic stream ended before message_stop");
		expect(isRetryableAssistantError(result)).toBe(true);
	});

	test("B: a cut between two events stays the retryable truncation error", async () => {
		const { result } = await run([encode(head)]);
		expect(result.errorMessage).toBe("Anthropic stream ended before message_stop");
		expect(isRetryableAssistantError(result)).toBe(true);
	});

	test("C: a complete CRLF stream parses however its bytes are split across chunks", async () => {
		const bytes = encode(complete.replace(/\n/g, "\r\n"));
		const splits = [
			...Array.from({ length: bytes.length - 1 }, (_, i) => [
				bytes.slice(0, i + 1),
				bytes.slice(i + 1),
			]),
			Array.from(bytes, (byte) => Uint8Array.of(byte)),
		];
		for (const chunks of splits) {
			const { result, events } = await run(chunks);
			expect({ errorMessage: result.errorMessage, stopReason: result.stopReason, events }).toEqual({
				errorMessage: undefined,
				stopReason: "stop",
				events: completeEvents,
			});
		}
	});

	test("D: a stream without the final blank line after message_stop still succeeds", async () => {
		const { result, events } = await run([encode(complete.slice(0, -1))]);
		expect(result.stopReason).toBe("stop");
		expect(result.errorMessage).toBeUndefined();
		expect(events).toEqual(completeEvents);
	});

	test("E: a finished event with malformed JSON still fails as a parse error", async () => {
		const { result } = await run([encode(`${head}event: content_block_start\ndata: {"type":\n\n`)]);
		expect(result.errorMessage).toStartWith(
			"Could not parse Anthropic SSE event content_block_start",
		);
		expect(isRetryableAssistantError(result)).toBe(false);
	});
});
