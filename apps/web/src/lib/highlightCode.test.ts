import { expect, test } from "bun:test";
import {
	createHighlightClient,
	HIGHLIGHT_CACHE_MAX_CHARS,
	HIGHLIGHT_CACHE_MAX_ENTRIES,
	type HighlightWorkerEvents,
	newerHighlight,
	type ShownHighlight,
	staleHighlight,
} from "./highlightCode";
import type { HighlightReply, HighlightRequest } from "./highlighter.worker";
import { assembleHighlight } from "./highlightHtml";

function render(code: string, lang: string) {
	return `<pre class="highlights ${lang}"><code>${code}</code></pre>`;
}

function requestsOf(posted: HighlightRequest[]) {
	return posted.flatMap((request) => (request.kind === "highlight" ? [request] : []));
}

function fakeWorker(options: { throws?: boolean } = {}) {
	const posted: HighlightRequest[] = [];
	let events: HighlightWorkerEvents | null = null;
	let spawned = 0;
	let terminated = 0;
	const client = createHighlightClient({
		spawn(next) {
			spawned++;
			if (options.throws) throw new Error("no worker");
			events = next;
			return {
				postMessage(request) {
					posted.push(request);
				},
				terminate() {
					terminated++;
				},
			};
		},
	});
	function answer(index: number) {
		const request = requestsOf(posted)[index];
		if (!request || !events) throw new Error(`no request ${index}`);
		if (request.kind !== "highlight") throw new Error("not a highlight request");
		events.reply({ id: request.id, result: { html: render(request.code, request.lang) } });
	}
	return {
		client,
		posted,
		answer,
		fail: () => events?.fail(),
		events: () => events,
		counts: () => ({ spawned, terminated }),
	};
}

async function flush() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

test("rapid calls on one key post the first and the latest only", async () => {
	const { client, posted, answer } = fakeWorker();
	const results = ["a", "ab", "abc", "abcd", "abcde"].map((code) =>
		client.highlightCode(code, "ts", "k"),
	);
	expect(requestsOf(posted).map((request) => request.code)).toEqual(["a"]);
	answer(0);
	expect(requestsOf(posted).map((request) => request.code)).toEqual(["a", "abcde"]);
	answer(1);
	expect(await Promise.all(results)).toEqual([
		render("a", "typescript"),
		null,
		null,
		null,
		render("abcde", "typescript"),
	]);
	expect(posted).toHaveLength(2);
});

test("calls on different keys are never coalesced", async () => {
	const { client, posted } = fakeWorker();
	void client.highlightCode("one", "py", "k1");
	void client.highlightCode("two", "py", "k2");
	expect(requestsOf(posted).map((request) => request.code)).toEqual(["one", "two"]);
});

test("a repeated call on a key resolves from the cache without a second post", async () => {
	const { client, posted, answer } = fakeWorker();
	const first = client.highlightCode("same", "bash", "k");
	const second = client.highlightCode("same", "bash", "k");
	answer(0);
	expect(await first).toBe(render("same", "shellscript"));
	expect(await second).toBe(render("same", "shellscript"));
	expect(posted).toHaveLength(1);
});

test("plain fences and mermaid never spawn the worker", async () => {
	const { client, counts } = fakeWorker();
	expect(await client.highlightCode("graph TD", "mermaid", "k")).toBeNull();
	expect(await client.highlightCode("x", "text", "k")).toBeNull();
	expect(client.cachedHighlight("x", "mermaid")).toBeNull();
	expect(counts().spawned).toBe(0);
});

test("a fence language outside the Monaco catalog goes to the worker", () => {
	const { client, posted } = fakeWorker();
	void client.highlightCode("x", "Elixir", "k");
	expect(requestsOf(posted)[0]?.lang).toBe("elixir");
});

test("a throwing worker constructor leaves every later block plain", async () => {
	const { client, counts } = fakeWorker({ throws: true });
	expect(await client.highlightCode("a", "ts", "k")).toBeNull();
	expect(await client.highlightCode("b", "ts", "k2")).toBeNull();
	expect(counts().spawned).toBe(1);
});

test("a worker error leaves pending and later blocks plain", async () => {
	const { client, posted, fail, counts } = fakeWorker();
	const first = client.highlightCode("a", "ts", "k1");
	const second = client.highlightCode("b", "py", "k2");
	const waiting = client.highlightCode("c", "py", "k2");
	expect(posted).toHaveLength(2);
	fail();
	expect(await first).toBeNull();
	expect(await second).toBeNull();
	expect(await waiting).toBeNull();
	expect(await client.highlightCode("d", "ts", "k3")).toBeNull();
	expect(posted).toHaveLength(2);
	expect(counts()).toEqual({ spawned: 1, terminated: 1 });
});

test("an unsupported language answers plain without stopping the worker", async () => {
	const { client, posted, events, answer, counts } = fakeWorker();
	const unknown = client.highlightCode("x", "not-a-language", "k1");
	events()?.reply({ id: requestsOf(posted)[0]?.id ?? -1, result: null });
	expect(await unknown).toBeNull();
	const known = client.highlightCode("y", "ts", "k2");
	answer(1);
	expect(await known).toBe(render("y", "typescript"));
	expect(counts()).toEqual({ spawned: 1, terminated: 0 });
});

test("the cache answers synchronously and resolves aliases", async () => {
	const { client, answer } = fakeWorker();
	const pending = client.highlightCode("x = 1", "python", "k");
	expect(client.cachedHighlight("x = 1", "py")).toBeNull();
	answer(0);
	await pending;
	expect(client.cachedHighlight("x = 1", "py")).toBe(render("x = 1", "python"));
});

test("the cache evicts the oldest entry past the entry bound", async () => {
	const { client, answer } = fakeWorker();
	for (let i = 0; i <= HIGHLIGHT_CACHE_MAX_ENTRIES; i++) {
		const pending = client.highlightCode(`code ${i}`, "ts", `k${i}`);
		answer(i);
		await pending;
	}
	expect(client.cachedHighlight("code 0", "ts")).toBeNull();
	expect(client.cachedHighlight("code 1", "ts")).not.toBeNull();
	expect(client.cachedHighlight(`code ${HIGHLIGHT_CACHE_MAX_ENTRIES}`, "ts")).not.toBeNull();
});

test("the cache evicts the oldest entries past the char bound", async () => {
	const { client, answer } = fakeWorker();
	const big = (tag: string) => tag + "x".repeat(Math.floor(HIGHLIGHT_CACHE_MAX_CHARS * 0.12));
	for (const [index, tag] of ["a", "b", "c", "d", "e", "f"].entries()) {
		const pending = client.highlightCode(big(tag), "ts", tag);
		answer(index);
		await pending;
	}
	expect(client.cachedHighlight(big("a"), "ts")).toBeNull();
	expect(client.cachedHighlight(big("b"), "ts")).toBeNull();
	expect(client.cachedHighlight(big("c"), "ts")).not.toBeNull();
	expect(client.cachedHighlight(big("f"), "ts")).not.toBeNull();
});

test("an oversized result is not cached and evicts nothing else", async () => {
	const { client, answer } = fakeWorker();
	const small = client.highlightCode("small", "ts", "a");
	answer(0);
	await small;
	const huge = "x".repeat(HIGHLIGHT_CACHE_MAX_CHARS / 8);
	const pending = client.highlightCode(huge, "ts", "b");
	answer(1);
	expect(await pending).toBe(render(huge, "typescript"));
	expect(client.cachedHighlight(huge, "ts")).toBeNull();
	expect(client.cachedHighlight("small", "ts")).toBe(render("small", "typescript"));
});

test("staleHighlight shows the last highlight plus the new text as plain, escaped", () => {
	const html = '<pre class="highlights"><code><span class="line">a</span></code></pre>';
	const latest = { seq: 1, code: "a", lang: "ts", html };
	expect(staleHighlight("a", "ts", latest)).toBe(html);
	expect(staleHighlight("a\n<b>&", "ts", latest)).toBe(
		'<pre class="highlights"><code><span class="line">a</span>\n&lt;b&gt;&amp;</code></pre>',
	);
	expect(staleHighlight("b", "ts", latest)).toBeNull();
	expect(staleHighlight("a", "py", latest)).toBeNull();
	expect(staleHighlight("ab", "ts", { ...latest, html: "<div></div>" })).toBeNull();
	expect(staleHighlight("a", "ts", null)).toBeNull();
});

test("a stream faster than the worker keeps showing every line", async () => {
	const { client, posted, answer } = fakeWorker();
	let latest: ShownHighlight | null = null;
	let applied = 0;
	let code = "";
	for (let line = 0; line < 40; line++) {
		code += `line ${line}\n`;
		const seq = line;
		const sent = code;
		void client.highlightCode(sent, "ts", "k").then((html) => {
			if (html === null) return;
			applied++;
			latest = newerHighlight(latest, { seq, code: sent, lang: "ts", html });
		});
		if (line % 3 === 2) {
			answer(posted.length - 1);
			await flush();
		}
		const shown = staleHighlight(code, "ts", latest);
		if (line >= 2) expect(shown?.replace(/<[^>]+>/g, "")).toBe(code);
	}
	expect(applied).toBeGreaterThan(5);
});

test("a streaming key keeps one cache entry", async () => {
	const { client, answer } = fakeWorker();
	for (const [index, code] of ["l1", "l1\nl2", "l1\nl2\nl3"].entries()) {
		const pending = client.highlightCode(code, "ts", "stream");
		answer(index);
		await pending;
	}
	expect(client.cachedHighlight("l1", "ts")).toBeNull();
	expect(client.cachedHighlight("l1\nl2", "ts")).toBeNull();
	expect(client.cachedHighlight("l1\nl2\nl3", "ts")).toBe(render("l1\nl2\nl3", "typescript"));
});

test("an idle key starts a fresh request on its next call", async () => {
	const { client, posted, answer } = fakeWorker();
	const first = client.highlightCode("a", "ts", "k");
	answer(0);
	await first;
	await flush();
	void client.highlightCode("b", "ts", "k");
	expect(requestsOf(posted).map((request) => request.code)).toEqual(["a", "b"]);
});

test("the real worker answers with highlighted html", async () => {
	const worker = new Worker(new URL("./highlighter.worker.ts", import.meta.url), {
		type: "module",
	});
	const reply = await new Promise<HighlightReply>((resolve, reject) => {
		worker.addEventListener("message", (event: MessageEvent<HighlightReply>) =>
			resolve(event.data),
		);
		worker.addEventListener("error", reject);
		worker.postMessage({
			kind: "highlight",
			id: 7,
			key: "real",
			code: "const x: number = 1;",
			lang: "typescript",
		} satisfies HighlightRequest);
	});
	worker.terminate();
	expect(reply.id).toBe(7);
	expect(JSON.stringify(reply.result)).toContain("highlights");
}, 20_000);

test("a line update joins the shown lines, and a release clears them", async () => {
	const { client, posted, events, counts } = fakeWorker();
	const reply = (index: number, update: { from: number; lines: string[]; tail: string }) => {
		const id = requestsOf(posted)[index]?.id ?? -1;
		events()?.reply({ id, result: { update: { open: "<pre><code>", ...update } } });
	};
	const first = client.highlightCode("a\nb", "ts", "k");
	reply(0, { from: 0, lines: ["A"], tail: "B" });
	expect(await first).toBe(assembleHighlight("<pre><code>", ["A"], "B"));
	const second = client.highlightCode("a\nb\nc", "ts", "k");
	reply(1, { from: 1, lines: ["B"], tail: "C" });
	expect(await second).toBe(assembleHighlight("<pre><code>", ["A", "B"], "C"));
	const rewrite = client.highlightCode("z", "ts", "k");
	reply(2, { from: 0, lines: [], tail: "Z" });
	expect(await rewrite).toBe(assembleHighlight("<pre><code>", [], "Z"));
	client.release("k");
	expect(posted.at(-1)).toEqual({ kind: "release", key: "k" });
	const stale = client.highlightCode("q", "ts", "k");
	reply(3, { from: 2, lines: [], tail: "Q" });
	expect(await stale).toBeNull();
	expect(counts().spawned).toBe(1);
});

test("a release drops the queued request and ignores the reply still on its way", async () => {
	const { client, posted, answer, events } = fakeWorker();
	void client.highlightCode("a\n", "ts", "k");
	answer(0);
	await flush();
	void client.highlightCode("a\nb\n", "ts", "k");
	const queued = client.highlightCode("a\nb\nc\n", "ts", "k");
	const inFlight = requestsOf(posted).at(-1);
	if (!inFlight) throw new Error("no request");
	client.release("k");
	expect(await queued).toBeNull();
	const update = { open: "<pre><code>", lines: ["a", "b"], tail: "" };
	events()?.reply({ id: inFlight.id, result: { update: { ...update, from: 0 } } });
	await flush();
	expect(posted.map((request) => request.kind)).toEqual(["highlight", "highlight", "release"]);

	const next = client.highlightCode("z\n", "ts", "k");
	const nextRequest = requestsOf(posted).at(-1);
	if (!nextRequest) throw new Error("no request");
	events()?.reply({
		id: nextRequest.id,
		result: { update: { open: "<pre><code>", from: 2, lines: [], tail: "X" } },
	});
	expect(await next).toBeNull();
});

test("a release before the worker exists does not start it", () => {
	const { client, counts } = fakeWorker();
	client.release("k");
	expect(counts().spawned).toBe(0);
});
