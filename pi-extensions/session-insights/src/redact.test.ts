import { describe, expect, test } from "bun:test";
import { diagnostics, keyLeaks, rsa4096Key } from "../test/pem.ts";
import { withinBudget } from "../test/perf.ts";
import { SUBAGENT_SPAWN_TOOL } from "./core.ts";
import { failureFacts } from "./facts.ts";
import {
	createRedactor,
	isSecretName,
	MASK_CONTEXT,
	maskSecretFields,
	secretFindings,
	stripControls,
} from "./redact.ts";
import { promptSentences } from "./repeats.ts";
import { mulberry32 } from "./stats.ts";
import { callLabel, taskParagraphs } from "./trace.ts";

const HOME = "/home/alice";
const redactor = createRedactor(HOME);
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const SECRETS: readonly (readonly [string, string, string])[] = [
	["an Anthropic key", "key sk-ant-abcdefghijklmnopqrstuv1234 here", "key [redacted] here"],
	["an OpenAI project key", "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX", "[redacted]"],
	["a GitHub token", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "token [redacted]"],
	["a fine-grained GitHub token", "github_pat_11ABCDEFG0123456789_abcdefghij", "[redacted]"],
	["a GitLab token", "glpat-abcdefghijklmnopqrstuv", "[redacted]"],
	["an AWS key id", "AKIAABCDEFGHIJKLMNOP", "[redacted]"],
	["a Slack token", "xoxb-1234567890-abcdefghij", "[redacted]"],
	["a Google API key", "AIzaSyA1234567890abcdefghijklmnopqrstu", "[redacted]"],
	["an npm token", "npm_abcdefghijklmnopqrstuvwxyz0123456789", "[redacted]"],
	[
		"a JWT",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
		"[redacted]",
	],
	[
		"a bearer header",
		"Authorization: Bearer abcdef0123456789xyz",
		"Authorization: Bearer [redacted]",
	],
	["an env assignment", "export GITHUB_TOKEN=s3cr3tvalue", "export GITHUB_TOKEN=[redacted]"],
	["a quoted env value", 'DB_PASSWORD: "hunter2 and more"', "DB_PASSWORD: [redacted]"],
	[
		"a URL query secret",
		"https://x.test/?api_key=abc123&q=1",
		"https://x.test/?api_key=[redacted]&q=1",
	],
	["a JSON api key", '{"apiKey": "abc-123"}', '{"apiKey": "[redacted]"}'],
	["URL basic auth", "https://bob:pa55@example.com/repo", "https://[redacted]@example.com/repo"],
	["an email", "mail me at bob.smith+x@example.org now", "mail me at [redacted] now"],
	[
		"a private key block",
		"-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\nafter",
		"[redacted]\nafter",
	],
];

describe("redaction", () => {
	test.each(SECRETS)("masks %s", (_, input, expected) => {
		expect(redactor.redact(input)).toBe(expected);
	});

	test.each(SECRETS)("the post-export check finds %s unmasked", (_, input) => {
		expect(secretFindings(input, HOME).length).toBeGreaterThan(0);
	});

	test("home and other users' homes become ~", () => {
		expect(redactor.redact("/home/alice/repo and /Users/bob/x and /home/alicex")).toBe(
			"~/repo and ~/x and ~",
		);
	});

	test("clean strips ANSI and control characters but keeps lines and tabs", () => {
		const input = `${ESC}[31mred${ESC}[0m\r\nnext\tcol${ESC}]0;title${BEL}end${String.fromCharCode(0)}`;
		expect(redactor.clean(input)).toBe("red\nnext\tcolend");
		expect(stripControls(`a${ESC}[?25lb${ESC}]8;;x${ESC}\\c`)).toBe("abc");
	});

	test("a secret straddling the cap is masked before the cut, and the cut never splits the mask", () => {
		const input = `${"x".repeat(94)} sk-ant-abcdefghijklmnopqrstuvwxyz`;
		const capped = redactor.cap(input, 100);
		expect(capped.text).toBe(`${"x".repeat(94)} `);
		expect(capped.chars).toBe(input.length);
		expect(capped.cut).toEqual({ at: 95, chars: input.length - 100, lines: 0 });
		const assignment = redactor.cap(`${"x".repeat(90)} API_KEY=supersecretvalue more`, 100);
		expect(assignment.text).toBe(`${"x".repeat(90)} API_KEY=`);
		expect(secretFindings(assignment.text, HOME)).toEqual([]);
		const label = redactor.label(`${"x".repeat(40)} TOKEN=abcdefghijklmnop rest`, 52);
		expect(label).toBe(`${"x".repeat(40)} TOKEN=…`);
		expect(secretFindings(label, HOME)).toEqual([]);
		const tail = redactor.capHeadTail(`head ${"y".repeat(200)} SECRET=abc ${"z".repeat(24)}`, 100);
		expect(tail.text.slice(tail.cut?.at)).toBe(` ${"z".repeat(24)}`);
	});

	test("head and tail keep 70 % and 30 % and count the omitted lines", () => {
		const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
		const capped = redactor.capHeadTail(lines, 100);
		expect(capped.text.length).toBe(100);
		expect(capped.text.startsWith("line 0\n")).toBe(true);
		expect(capped.text.endsWith("line 99")).toBe(true);
		expect(capped.cut?.at).toBe(70);
		expect(capped.cut?.chars).toBe(lines.length - 100);
		expect(capped.cut?.lines).toBeGreaterThan(80);
		expect(redactor.capHeadTail("short", 100)).toEqual({ text: "short", chars: 5 });
	});

	test("JSON strings are masked and capped, keys masked, cut paths listed", () => {
		const value = {
			path: "/home/alice/a.ts",
			"/home/alice/file": 1,
			nested: { list: ["x".repeat(20), "GITHUB_TOKEN=abc"] },
			many: Array.from({ length: 302 }, (_, index) => index),
		};
		const capped = redactor.capJson(value, 10);
		expect(capped.value).toEqual({
			path: "~/a.ts",
			"~/file": 1,
			nested: { list: ["x".repeat(10), "GITHUB_TOK"] },
			many: Array.from({ length: 300 }, (_, index) => index),
		});
		expect(capped.cuts).toEqual([
			["nested.list[0]", 20],
			["nested.list[1]", 16],
			["many", 302],
		]);
	});

	test("cut paths are built from the masked keys, never the keys as written", () => {
		const key = "https://deploy:hunter2pass@example.com/x";
		const value = {
			[key]: "y".repeat(50),
			"/home/alice/notes": { [key]: ["z".repeat(40)] },
			"API_KEY=sk-live-0123456789abcdef": Array.from({ length: 302 }, (_, index) => index),
		};
		const masked = "https://[redacted]@example.com/x";
		for (const capped of [
			redactor.capJson(value, 10),
			redactor.capJsonWithin(value, [10], 100_000),
		]) {
			expect(capped.cuts).toEqual([
				[masked, 50],
				[`~/notes.${masked}[0]`, 40],
				["API_KEY=[redacted]", 302],
			]);
			const shown = JSON.stringify(capped);
			expect(shown).not.toContain("hunter2pass");
			expect(shown).not.toContain("sk-live");
			expect(shown).not.toContain("alice");
		}
	});

	test("capJsonWithin walks the ladder, then keeps only the keys", () => {
		const value = { a: "y".repeat(5000), b: "z".repeat(5000) };
		const small = redactor.capJsonWithin(value, [4000, 100], 1000);
		expect(JSON.stringify(small.value).length).toBeLessThanOrEqual(1000);
		const none = redactor.capJsonWithin(value, [4000], 100);
		expect(none.value).toEqual({ omitted: true, keys: ["a", "b"], chars: 10_015 });
	});

	test("long runs mask in linear time: word characters, dash runs, base64url (every pattern starts at a run's start)", () => {
		const words = `${"x".repeat(2_000)} `.repeat(500);
		let started = performance.now();
		expect(redactor.redact(words)).toBe(words);
		withinBudget(performance.now() - started, 50);
		expect(redactor.redact("mail a.b+c@example.org now")).toBe("mail [redacted] now");
		const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		const random = mulberry32(7);
		const base64url = (n: number) =>
			Array.from({ length: n }, () => alphabet[Math.floor(random() * 64)]).join("");
		for (const text of [
			"a-".repeat(50_000),
			"0f3e2a1b-".repeat(20_000),
			Array.from({ length: 40_000 }, (_, index) => `w${index % 97}`).join("-"),
			base64url(100_000),
			base64url(400_000),
			`{"encrypted_content":"gAAAAAB${base64url(200_000)}"}`,
		]) {
			started = performance.now();
			redactor.redact(text);
			withinBudget(performance.now() - started, 10 + text.length / 40_000);
		}
		expect(redactor.redact("x-api_key=abc&token=def")).toBe(
			"x-api_key=[redacted]&token=[redacted]",
		);
	});

	test("a string under a secret-named key is masked whole, in tool arguments and details", () => {
		const capped = redactor.capJson(
			{
				user: "me",
				password: "hunter2",
				DB_PASSWORD: "x",
				apiKey: "abc123",
				"x-api-key": "k",
				nested: { client_secret: "s", privateKey: "p", credentials: "c", accessToken: "t" },
				tokens: ["a"],
				tokenizer: "cl100k",
				key: "Enter",
				empty: { password: "" },
			},
			1000,
		);
		expect(capped.value).toEqual({
			user: "me",
			password: "[redacted]",
			DB_PASSWORD: "[redacted]",
			apiKey: "[redacted]",
			"x-api-key": "[redacted]",
			nested: {
				client_secret: "[redacted]",
				privateKey: "[redacted]",
				credentials: "[redacted]",
				accessToken: "[redacted]",
			},
			tokens: ["a"],
			tokenizer: "cl100k",
			key: "Enter",
			empty: { password: "" },
		});
		expect(isSecretName("DB_PASSWORD")).toBe(true);
		expect(isSecretName("max_tokens")).toBe(false);
	});

	test("every value inside a secret-named container is masked, at any depth, arrays included", () => {
		const value = {
			credentials: { value: "abc123def456", pin: 4829, enabled: true, none: null, empty: "" },
			apiKey: { current: "rot-current-1", previous: "rot-previous-2" },
			secrets: ["hunter2hunter2", { nested: ["deep-one"] }],
			auth: { headers: { x: "header-value-1" } },
			proxyAuth: { user: "u-name" },
			Authorization: "Basic dXNlcjpwYXNz",
			path: "kv/app",
			author: "Ada",
		};
		const masked = {
			credentials: {
				value: "[redacted]",
				pin: "[redacted]",
				enabled: "[redacted]",
				none: null,
				empty: "",
			},
			apiKey: { current: "[redacted]", previous: "[redacted]" },
			secrets: ["[redacted]", { nested: ["[redacted]"] }],
			auth: { headers: { x: "[redacted]" } },
			proxyAuth: { user: "[redacted]" },
			Authorization: "[redacted]",
			path: "kv/app",
			author: "Ada",
		};
		expect(redactor.capJson(value, 1000).value).toEqual(masked);
		expect(redactor.capJsonWithin(value, [1000, 240], 10_000).value).toEqual(masked);
		expect(redactor.capJson([{ details: value }], 1000).value).toEqual([{ details: masked }]);
		expect(maskSecretFields(value)).toEqual(masked);
		expect(maskSecretFields({ path: "kv/app" })).toEqual({ path: "kv/app" });
		let deep: unknown = { password: "deep-secret", list: ["deep-item"] };
		for (let level = 0; level < 60; level++) deep = { level: deep };
		for (const shown of [maskSecretFields(deep), redactor.capJson(deep, 1000).value]) {
			expect(JSON.stringify(shown)).not.toContain("deep-secret");
			expect(JSON.stringify(shown)).not.toContain("deep-item");
		}
		for (const name of ["auth", "proxyAuth", "oauth", "Authorization", "x_authorization"])
			expect(isSecretName(name)).toBe(true);
		for (const name of ["author", "authors", "authority", "authMode", "authenticated"])
			expect(isSecretName(name)).toBe(false);
	});

	test("JSON text pairs follow the same key rule", () => {
		expect(redactor.redact('{"privateKey": "abc", "tokenizer": "cl100k", "password": ""}')).toBe(
			'{"privateKey": "[redacted]", "tokenizer": "cl100k", "password": ""}',
		);
		expect(redactor.redact('{"note": "a \\"quote\\"", "secret": "a\\"b"}')).toBe(
			'{"note": "a \\"quote\\"", "secret": "[redacted]"}',
		);
	});

	test("a secret-named JSON value cut before its closing quote is still masked", () => {
		const long = `{"password": "${"s3cret".repeat(400)}"}`;
		expect(redactor.redact('{"apiKey": "abc123')).toBe('{"apiKey": "[redacted]"');
		expect(redactor.cap(long, 100).text).not.toContain("s3cret");
		expect(redactor.label(`${" ".repeat(1975)}{"apiKey": "${"abc123".repeat(10)}"}`, 140)).toBe(
			'{"apiKey": "[redacted]"}',
		);
		expect(redactor.redact('{"note": "open\n"next": 1}')).toBe('{"note": "open\n"next": 1}');
	});

	test("an ANSI-coloured secret is masked: controls go before the patterns run", () => {
		expect(redactor.clean(`${ESC}[31mAPI_KEY=supersecret${ESC}[0m`)).toBe("API_KEY=[redacted]");
	});

	test("a home that names no user (the root, one segment) rewrites nothing", () => {
		for (const home of ["/", "/root", "C:\\"]) {
			const plain = createRedactor(home);
			expect(plain.redact("read /usr/lib/x.ts and https://example.com/a")).toBe(
				"read /usr/lib/x.ts and https://example.com/a",
			);
			expect(secretFindings("/usr/lib and a / b", home)).toEqual([]);
		}
		expect(createRedactor("/home/alice/").redact("/home/alice/x")).toBe("~/x");
		expect(secretFindings("C:\\Users\\alice\\x", "C:\\Users\\alice")).toEqual(["homePath"]);
	});

	test("the post-export check names what masking would still change, and passes masked text", () => {
		expect(secretFindings(`see ${HOME}/x and sk-ant-abcdefghijklmnopqrstuv1234`, HOME)).toEqual([
			"homePath",
			"keyShape",
		]);
		expect(secretFindings("TOKEN=[redacted] Bearer [redacted] ~/x [redacted]", HOME)).toEqual([]);
		expect(secretFindings("/Users/bob/notes", HOME)).toEqual(["homePath"]);
	});

	test("labels collapse whitespace and end in an ellipsis", () => {
		expect(redactor.label("  one\n two   three ", 50)).toBe("one two three");
		expect(redactor.label("abcdefghij", 5)).toBe("abcd…");
		expect(redactor.label("\n  \n first line \nsecond", 50, true)).toBe("first line");
	});
});

describe("masking before any window is cut", () => {
	const key = rsa4096Key();
	const max = 4000;
	const headChars = Math.round(max * 0.7);
	const tailChars = max - headChars;
	const shown = (capped: { text: string }) => capped.text;

	test("a key after a long prefix is masked in the kept tail", () => {
		const text = `${diagnostics(12_000)}${key.block}\n`;
		const capped = redactor.capHeadTail(text, max);
		expect(capped.cut).toBeDefined();
		expect(keyLeaks(shown(capped), key)).toEqual([]);
		expect(shown(capped)).not.toContain("END RSA PRIVATE KEY");
		expect(shown(capped).endsWith("[redacted]\n")).toBe(true);
		expect(secretFindings(shown(capped), HOME)).toEqual([]);
	});

	test("a key split exactly at the head cut or the tail's start is masked on both sides", () => {
		const pad = (chars: number) => diagnostics(chars);
		const cases = [
			`${pad(headChars - 200)}${key.block}${pad(20_000)}`,
			`${pad(headChars - key.block.length)}${key.block}${pad(20_000)}`,
			`${pad(headChars)}${key.block}${pad(20_000)}`,
			`${pad(20_000)}${key.block}${pad(tailChars - 200)}`,
			`${pad(20_000)}${key.block}${pad(tailChars)}`,
			`${pad(20_000)}${key.block}`,
			`${pad(20_000)}${key.block.slice(0, 40)}`,
		];
		for (const text of cases) {
			const capped = redactor.capHeadTail(text, max);
			expect(keyLeaks(shown(capped), key)).toEqual([]);
			expect(secretFindings(shown(capped), HOME)).toEqual([]);
			const head = redactor.cap(text, headChars + 100);
			expect(keyLeaks(head.text, key)).toEqual([]);
		}
	});

	test("past the window plus its context, each window is masked with the context around it", () => {
		const prefix = diagnostics(3 * MASK_CONTEXT);
		for (const text of [
			`${prefix}${key.block}`,
			`${prefix}${key.block}${diagnostics(tailChars - 300)}`,
			`${diagnostics(headChars - 300)}${key.block}${prefix}`,
		]) {
			expect(keyLeaks(redactor.capHeadTail(text, max).text, key)).toEqual([]);
			expect(keyLeaks(redactor.cap(text, headChars).text, key)).toEqual([]);
		}
	});

	test("labels, excerpts and JSON string caps mask the whole text first", () => {
		const text = `${key.lines.slice(10).join("\n")}\n-----END RSA PRIVATE KEY-----`;
		expect(keyLeaks(redactor.label(text, 120), key)).toEqual([]);
		expect(keyLeaks(redactor.label(text, 120, true), key)).toEqual([]);
		const json = redactor.capJsonWithin(
			{ out: `${diagnostics(3000)}${key.block}` },
			[3100],
			10_000,
		);
		expect(keyLeaks(JSON.stringify(json.value), key)).toEqual([]);
		const escaped = JSON.stringify({ privateKeyPem: key.block }).replace("privateKeyPem", "pem");
		expect(keyLeaks(redactor.cap(escaped.slice(400), 200).text, key)).toEqual([]);
	});

	test("prompt sentences, error lines and task paragraphs are cut from masked text", () => {
		const encrypted = key.block.replace(
			"-----\n",
			"-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF\n\n",
		);
		const prompt = `Please rotate this key now.\n${encrypted.replaceAll("\n", " \n")}`;
		const sentences = promptSentences(prompt.replace(/[+/]/g, " "), redactor, 1);
		expect(sentences.length).toBeGreaterThan(0);
		expect(keyLeaks(JSON.stringify(sentences), key)).toEqual([]);
		const ending = `${key.lines.slice(3).join("\n")}\n-----END RSA PRIVATE KEY-----`;
		const failure = failureFacts("bash", ending, redactor);
		expect(keyLeaks(JSON.stringify(failure), key)).toEqual([]);
		const task = `Check it.\n\n${encrypted}\n\nThen report.`;
		const spawn = callLabel(redactor, SUBAGENT_SPAWN_TOOL, {
			subagent_type: "scout",
			task: ending,
		});
		expect(spawn).toBe("scout: [redacted]");
		expect(keyLeaks(JSON.stringify(taskParagraphs(task, redactor)), key)).toEqual([]);
	});

	test("the post-export check finds a key's interior without its markers", () => {
		const interior = key.lines.slice(5, 9).join("\n");
		const ending = `${key.lines.slice(-3).join("\n")}\n-----END RSA PRIVATE KEY-----`;
		for (const text of [interior, ending, `x\n${interior}\n`, JSON.stringify(interior)]) {
			expect(secretFindings(text, HOME)).toEqual(["privateKey"]);
			expect(secretFindings(redactor.clean(text), HOME)).toEqual([]);
			expect(keyLeaks(redactor.clean(text), key)).toEqual([]);
		}
		expect(secretFindings("-----END PRIVATE KEY-----", HOME)).toEqual(["privateKey"]);
		expect(redactor.redact(`Ends with the -----END RSA PRIVATE KEY----- line.`)).toBe(
			"Ends with the [redacted] line.",
		);
		expect(secretFindings(`${"a".repeat(64)}\nshort line\n`, HOME)).toEqual([]);
	});

	test("a 5 MB result is masked in bounded time, its windows still masked", () => {
		const big = `${diagnostics(5_000_000)}${key.block}\n${diagnostics(tailChars - 500)}`;
		redactor.capHeadTail(big.slice(0, 200_000), max);
		const started = performance.now();
		const capped = redactor.capHeadTail(big, 16_000);
		const ms = performance.now() - started;
		expect(keyLeaks(capped.text, key)).toEqual([]);
		expect(capped.chars).toBe(big.length);
		withinBudget(ms, 15);
		const labelled = performance.now();
		redactor.label(big, 120);
		redactor.cap(big, 4000);
		withinBudget(performance.now() - labelled, 10);
	});
});
