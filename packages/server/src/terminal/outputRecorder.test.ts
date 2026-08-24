import { describe, expect, test } from "bun:test";
import { createOutputRecorder } from "./outputRecorder";

const ESC = "\u001b";

const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;

function body(snapshot: string): string {
	const lastEscape = snapshot.lastIndexOf(`${ESC}[?`);
	if (lastEscape === -1) return snapshot.replace(`${ESC}[0m`, "");
	return snapshot.slice(
		snapshot.indexOf("h", lastEscape) + 1 || snapshot.indexOf("l", lastEscape) + 1,
	);
}

describe("outputRecorder", () => {
	test("replays what the shell printed", () => {
		const recorder = createOutputRecorder();
		recorder.push("$ echo hi\r\n");
		recorder.push("hi\r\n");
		expect(recorder.snapshot()).toContain("$ echo hi\r\nhi\r\n");
	});

	test("nothing recorded replays nothing — not a bare preamble", () => {
		expect(createOutputRecorder().snapshot()).toBe("");
	});

	test("normalizes the pen so a trimmed colour run cannot bleed into a fresh terminal", () => {
		const recorder = createOutputRecorder();
		recorder.push("plain\r\n");
		expect(recorder.snapshot().startsWith(`${ESC}[0m`)).toBe(true);
	});

	describe("bounded window", () => {
		test("drops the oldest output and keeps the newest", () => {
			const recorder = createOutputRecorder({ maxChars: 64 });
			for (let i = 0; i < 40; i++) recorder.push(`line-${i}\n`);
			const text = body(recorder.snapshot());
			expect(text.length).toBeLessThanOrEqual(64);
			expect(text).toContain("line-39");
			expect(text).not.toContain("line-0\n");
		});

		test("trims at a line boundary, never mid-line", () => {
			const recorder = createOutputRecorder({ maxChars: 20 });
			for (let i = 0; i < 10; i++) recorder.push(`abcdefgh-${i}\n`);
			for (const line of body(recorder.snapshot()).split("\n")) {
				if (line !== "") expect(line).toMatch(/^abcdefgh-\d$/);
			}
		});

		test("never opens mid escape sequence", () => {
			const recorder = createOutputRecorder({ maxChars: 24 });
			for (let i = 0; i < 12; i++) recorder.push(`${ESC}[31mred-${i}${ESC}[0m\n`);
			const text = body(recorder.snapshot());
			const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
			expect(text.match(sgr)?.every((code) => code.startsWith(`${ESC}[`)) ?? true).toBe(true);
			expect(/^[0-9;]*m/.test(text)).toBe(false);
		});

		test("drops everything rather than emitting a fragment when no line boundary survives", () => {
			const recorder = createOutputRecorder({ maxChars: 4 });
			recorder.push("no-newlines-at-all-anywhere");
			expect(body(recorder.snapshot())).toBe("");
		});
	});

	describe("alt screen", () => {
		test("a full-screen app is not recorded, and the normal buffer survives it", () => {
			const recorder = createOutputRecorder();
			recorder.push("before vim\r\n");
			recorder.push(ALT_ON);
			recorder.push("~\r\n~\r\n~\r\nVIM - Vi IMproved\r\n");
			recorder.push(ALT_OFF);
			recorder.push("after vim\r\n");

			const text = body(recorder.snapshot());
			expect(text).toContain("before vim");
			expect(text).toContain("after vim");
			expect(text).not.toContain("VIM - Vi IMproved");
		});

		test("output while the alt screen is open stays out even across many reads", () => {
			const recorder = createOutputRecorder();
			recorder.push("prompt\r\n");
			recorder.push(ALT_ON);
			for (let i = 0; i < 20; i++) recorder.push(`htop-row-${i}\r\n`);
			expect(body(recorder.snapshot())).not.toContain("htop-row-");
		});

		test("a switch split across two reads is still seen", () => {
			const recorder = createOutputRecorder();
			recorder.push("before\r\n");
			recorder.push(`${ESC}[?10`);
			recorder.push("49h");
			recorder.push("VIM SCREEN\r\n");
			recorder.push(ALT_OFF);
			recorder.push("after\r\n");

			const text = body(recorder.snapshot());
			expect(text).toContain("before");
			expect(text).toContain("after");
			expect(text).not.toContain("VIM SCREEN");
		});

		test("enter and exit inside one read keep both sides of it", () => {
			const recorder = createOutputRecorder();
			recorder.push(`head ${ALT_ON}HIDDEN${ALT_OFF} tail\r\n`);

			const text = body(recorder.snapshot());
			expect(text).toContain("head ");
			expect(text).toContain(" tail");
			expect(text).not.toContain("HIDDEN");
		});

		test("the switch sequence itself is never replayed", () => {
			const recorder = createOutputRecorder();
			recorder.push("visible\r\n");
			recorder.push(ALT_ON);
			recorder.push("hidden");
			recorder.push(ALT_OFF);
			expect(recorder.snapshot()).not.toContain("[?1049");
		});

		test("a lone escape byte in ordinary output does not stall recording", () => {
			const recorder = createOutputRecorder();
			recorder.push("start\r\n");
			recorder.push(`${ESC}`);
			recorder.push("(B plain text\r\n");
			expect(body(recorder.snapshot())).toContain("plain text");
		});

		test("the legacy 47 / 1047 switches count too", () => {
			const recorder = createOutputRecorder();
			recorder.push("normal\r\n");
			recorder.push(`${ESC}[?47h`);
			recorder.push("hidden\r\n");
			recorder.push(`${ESC}[?47l`);
			expect(body(recorder.snapshot())).not.toContain("hidden");
		});
	});

	describe("mode restoration", () => {
		test("re-emits observed modes so a fresh terminal agrees with the live shell", () => {
			const recorder = createOutputRecorder();
			recorder.push(`${ESC}[?2004h${ESC}[?1h$ `);
			const snapshot = recorder.snapshot();
			expect(snapshot).toContain(`${ESC}[?2004h`);
			expect(snapshot).toContain(`${ESC}[?1h`);
		});

		test("re-emits the LAST value, not merely the fact it was seen", () => {
			const recorder = createOutputRecorder();
			recorder.push(`${ESC}[?25h visible `);
			recorder.push(`${ESC}[?25l hidden `);
			expect(recorder.snapshot().startsWith(`${ESC}[0m${ESC}[?25l`)).toBe(true);
		});

		test("handles several modes set in one sequence", () => {
			const recorder = createOutputRecorder();
			recorder.push(`${ESC}[?2004;1h x`);
			const snapshot = recorder.snapshot();
			expect(snapshot).toContain(`${ESC}[?2004h`);
			expect(snapshot).toContain(`${ESC}[?1h`);
		});

		test("never restores mouse tracking, which a fresh prompt would echo back as garbage", () => {
			const recorder = createOutputRecorder();
			recorder.push(`${ESC}[?1000;1002;1003;1006h x`);
			const snapshot = recorder.snapshot();
			for (const mode of [1000, 1002, 1003, 1006]) {
				expect(snapshot).not.toContain(`${ESC}[?${mode}h`);
			}
		});

		test("leaves untouched modes alone rather than asserting xterm's defaults", () => {
			const recorder = createOutputRecorder();
			recorder.push("plain output\r\n");
			expect(recorder.snapshot()).not.toContain(`${ESC}[?7`);
			expect(recorder.snapshot()).not.toContain(`${ESC}[?25`);
		});

		test("survives the window trimming away the sequence that set them", () => {
			const recorder = createOutputRecorder({ maxChars: 16 });
			recorder.push(`${ESC}[?2004h`);
			for (let i = 0; i < 20; i++) recorder.push(`filler-${i}\n`);
			expect(recorder.snapshot()).toContain(`${ESC}[?2004h`);
		});
	});

	describe("restore", () => {
		test("seeds a revived terminal with its predecessor's output", () => {
			const recorder = createOutputRecorder();
			recorder.restore("from the previous run\r\n");
			expect(recorder.snapshot()).toContain("from the previous run");
		});

		test("bounds what it is handed", () => {
			const recorder = createOutputRecorder({ maxChars: 32 });
			recorder.restore(Array.from({ length: 50 }, (_, i) => `old-${i}\n`).join(""));
			expect(body(recorder.snapshot()).length).toBeLessThanOrEqual(32);
		});

		test("live output appends after restored output", () => {
			const recorder = createOutputRecorder();
			recorder.restore("previous run\r\n");
			recorder.push("this run\r\n");
			const text = body(recorder.snapshot());
			expect(text.indexOf("previous run")).toBeLessThan(text.indexOf("this run"));
		});

		test("keeps mode sequences out of the body rather than copying a snapshot verbatim", () => {
			const recorder = createOutputRecorder();
			recorder.restore(`${ESC}[0m${ESC}[?2004h$ old prompt\r\n`);
			expect(body(recorder.snapshot())).not.toContain(`${ESC}[?`);
			expect(recorder.snapshot()).toContain(`${ESC}[?2004h`);
		});

		test("a recording persisted by a host that still replayed mouse tracking is scrubbed", () => {
			const recorder = createOutputRecorder();
			recorder.restore(`${ESC}[0m${ESC}[?1000h${ESC}[?1006h$ old prompt\r\n`);
			const snapshot = recorder.snapshot();
			expect(snapshot).not.toContain(`${ESC}[?1000`);
			expect(snapshot).not.toContain(`${ESC}[?1006`);
			expect(snapshot).toContain("old prompt");
		});

		test("restoring across successive runs never compounds the preamble", () => {
			const first = createOutputRecorder();
			first.push(`${ESC}[?2004h$ `);
			const second = createOutputRecorder();
			second.restore(first.snapshot());
			const third = createOutputRecorder();
			third.restore(second.snapshot());
			expect(third.snapshot().split(`${ESC}[?2004h`).length - 1).toBe(1);
		});
	});

	test("dispose stops recording and forgets what it held", () => {
		const recorder = createOutputRecorder();
		recorder.push("secret\r\n");
		recorder.dispose();
		recorder.push("more\r\n");
		expect(recorder.snapshot()).toBe("");
	});
});

describe("replay disabled", () => {
	test("a zero budget records nothing", () => {
		const recorder = createOutputRecorder({ maxChars: 0 });
		recorder.push("$ echo hi\r\nhi\r\n");
		expect(recorder.snapshot()).toBe("");
	});

	test("a zero budget also refuses a restored recording", () => {
		const recorder = createOutputRecorder({ maxChars: 0 });
		recorder.restore("from the previous run\r\n");
		expect(recorder.snapshot()).toBe("");
	});
});
