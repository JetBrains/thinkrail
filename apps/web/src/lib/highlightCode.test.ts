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

function render(code: string, lang: string) {
	return `<pre class="shiki ${lang}"><code>${code}</code></pre>`;
}

function fakeWorker(options: { throws?: boolean } = {}) {
	const posted: HighlightRequest[] = [];
	const threaded: string[] = [];
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
		async inThread(code, lang) {
			threaded.push(code);
			return render(code, lang);
		},
	});
	function answer(index: number) {
		const request = posted[index];
		if (!request || !events) throw new Error(`no request ${index}`);
		events.reply({ id: request.id, html: render(request.code, request.lang) });
	}
	return {
		client,
		posted,
		threaded,
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
	expect(posted.map((request) => request.code)).toEqual(["a"]);
	answer(0);
	expect(posted.map((request) => request.code)).toEqual(["a", "abcde"]);
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
	expect(posted.map((request) => request.code)).toEqual(["one", "two"]);
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

test("unknown languages and mermaid never spawn the worker", async () => {
	const { client, counts } = fakeWorker();
	expect(await client.highlightCode("graph TD", "mermaid", "k")).toBeNull();
	expect(await client.highlightCode("x", "brainfuck", "k")).toBeNull();
	expect(client.cachedHighlight("x", "mermaid")).toBeNull();
	expect(counts().spawned).toBe(0);
});

test("a throwing worker constructor falls back to in-thread highlighting for good", async () => {
	const { client, threaded, counts } = fakeWorker({ throws: true });
	expect(await client.highlightCode("a", "ts", "k")).toBe(render("a", "typescript"));
	expect(await client.highlightCode("b", "ts", "k2")).toBe(render("b", "typescript"));
	expect(threaded).toEqual(["a", "b"]);
	expect(counts().spawned).toBe(1);
});

test("a worker error re-runs pending requests in-thread and keeps later ones there", async () => {
	const { client, posted, threaded, fail, counts } = fakeWorker();
	const first = client.highlightCode("a", "ts", "k1");
	const second = client.highlightCode("b", "py", "k2");
	const waiting = client.highlightCode("c", "py", "k2");
	expect(posted).toHaveLength(2);
	fail();
	expect(await first).toBe(render("a", "typescript"));
	expect(await second).toBe(render("b", "python"));
	expect(await waiting).toBe(render("c", "python"));
	expect(await client.highlightCode("d", "ts", "k3")).toBe(render("d", "typescript"));
	expect(threaded).toEqual(["a", "b", "c", "d"]);
	expect(posted).toHaveLength(2);
	expect(counts()).toEqual({ spawned: 1, terminated: 1 });
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

test("a worker that cannot build its highlighter switches the client to in-thread", async () => {
	const { client, posted, threaded, events, counts } = fakeWorker();
	const pending = client.highlightCode("a", "ts", "k");
	events()?.reply({ id: posted[0]?.id ?? -1, html: null, failed: true });
	expect(await pending).toBe(render("a", "typescript"));
	expect(await client.highlightCode("b", "ts", "k2")).toBe(render("b", "typescript"));
	expect(threaded).toEqual(["a", "b"]);
	expect(counts()).toEqual({ spawned: 1, terminated: 1 });
});

test("staleHighlight shows the last highlight plus the new text as plain, escaped", () => {
	const html = '<pre class="shiki"><code><span class="line">a</span></code></pre>';
	const latest = { seq: 1, code: "a", lang: "ts", html };
	expect(staleHighlight("a", "ts", latest)).toBe(html);
	expect(staleHighlight("a\n<b>&", "ts", latest)).toBe(
		'<pre class="shiki"><code><span class="line">a</span>\n&lt;b&gt;&amp;</code></pre>',
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
	expect(posted.map((request) => request.code)).toEqual(["a", "b"]);
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
		worker.postMessage({ id: 7, code: "const x: number = 1;", lang: "typescript" });
	});
	worker.terminate();
	expect(reply.id).toBe(7);
	expect(reply.html).toContain('class="shiki');
}, 20_000);
