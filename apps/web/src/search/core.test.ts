import { describe, expect, test } from "bun:test";
import { RiChat2Line } from "@remixicon/react";
import { createDoubleShiftDetector, DOUBLE_SHIFT } from "./doubleShift";
import {
	adaptiveCount,
	EMPTY_LEARNING,
	frecencyScore,
	MAX_LEARNING_BYTES,
	parseLearning,
	recordPick,
	serializeLearning,
} from "./learning";
import type { PaletteItem } from "./model";
import { parseSearchQuery, stripScopePrefix, withScopePrefix } from "./query";
import { pickTopHit, rankItems } from "./rank";

const DAY = 86_400_000;

describe("parseSearchQuery", () => {
	test("a prefix selects its scope and is stripped from the text", () => {
		expect(parseSearchQuery(">theme")).toMatchObject({
			scope: "commands",
			text: "theme",
			terms: ["theme"],
		});
		expect(parseSearchQuery("  / refresh.ts")).toMatchObject({
			scope: "files",
			text: "refresh.ts",
		});
		expect(parseSearchQuery("auth")).toMatchObject({ scope: "all", text: "auth" });
	});

	test("#digits is a pull-request number, #text is the specs scope, quotes escape prefixes", () => {
		expect(parseSearchQuery("#812")).toMatchObject({ scope: "all", terms: ["#812"] });
		expect(parseSearchQuery("#shell")).toMatchObject({ scope: "specs", text: "shell" });
		expect(parseSearchQuery('"@team"')).toMatchObject({ scope: "all", terms: ["@team"] });
		expect(parseSearchQuery('"is:running filter" unread')).toMatchObject({
			terms: ["is:running filter", "unread"],
		});
	});

	test("scope prefixes round-trip, so a chip can write its prefix back", () => {
		expect(withScopePrefix("auth", "work")).toBe("@auth");
		expect(withScopePrefix(stripScopePrefix(">auth"), "work")).toBe("@auth");
		expect(withScopePrefix(stripScopePrefix("@auth"), "all")).toBe("auth");
		expect(stripScopePrefix("@auth")).toBe("auth");
		expect(stripScopePrefix("#812")).toBe("#812");
	});
});

describe("double Shift", () => {
	function harness() {
		let time = 1000;
		const detector = createDoubleShiftDetector(() => time);
		const shift = {
			key: "Shift",
			repeat: false,
			isComposing: false,
			keyCode: 16,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
		};
		return {
			detector,
			shift,
			advance: (ms: number) => {
				time += ms;
			},
			tap(gap = 50) {
				detector.keydown(shift);
				time += gap;
				return detector.keyup(shift);
			},
		};
	}

	test("fires on the second release of two quick taps", () => {
		const h = harness();
		expect(h.tap()).toBe(false);
		h.advance(80);
		expect(h.tap()).toBe(true);
	});

	test("a slow second tap starts over", () => {
		const h = harness();
		h.tap();
		h.advance(DOUBLE_SHIFT.stepMs + 1);
		expect(h.tap()).toBe(false);
		h.advance(50);
		expect(h.tap()).toBe(true);
	});

	test("typing, repeats, IME and other modifiers reset the gesture", () => {
		const h = harness();
		h.tap();
		h.detector.keydown({ ...h.shift, key: "a" });
		h.advance(40);
		expect(h.tap()).toBe(false);

		const repeat = harness();
		repeat.tap();
		repeat.detector.keydown(repeat.shift);
		repeat.detector.keydown({ ...repeat.shift, repeat: true });
		expect(repeat.detector.keyup(repeat.shift)).toBe(false);

		const ime = harness();
		ime.tap();
		ime.detector.keydown({ ...ime.shift, keyCode: 229 });
		expect(ime.detector.keyup(ime.shift)).toBe(false);

		const chord = harness();
		chord.tap();
		chord.detector.keydown({ ...chord.shift, metaKey: true });
		expect(chord.detector.keyup(chord.shift)).toBe(false);
	});

	test("a key pressed just before the first tap blocks it", () => {
		const h = harness();
		h.detector.keydown({ ...h.shift, key: "b" });
		h.advance(DOUBLE_SHIFT.otherKeyGuardMs - 10);
		h.tap();
		h.advance(50);
		expect(h.tap()).toBe(false);
	});
});

describe("learning", () => {
	test("frecency decays toward zero without rewriting the stored value", () => {
		const now = 100 * DAY;
		const once = recordPick(EMPTY_LEARNING, "", "chat:a", now);
		expect(frecencyScore(once, "chat:a", now)).toBeCloseTo(1, 5);
		expect(frecencyScore(once, "chat:a", now + 14 * DAY)).toBeCloseTo(0.5, 5);
		const twice = recordPick(once, "", "chat:a", now);
		expect(frecencyScore(twice, "chat:a", now)).toBeCloseTo(2, 5);
	});

	test("adaptive picks latch to the typed prefix and decay daily", () => {
		const now = 10 * DAY;
		let snapshot = recordPick(EMPTY_LEARNING, "cal", "command:calendar", now);
		snapshot = recordPick(snapshot, "cal", "command:calendar", now);
		expect(adaptiveCount(snapshot, "cal", "command:calendar", now)).toBeCloseTo(3.8, 5);
		expect(adaptiveCount(snapshot, "ca", "command:calendar", now)).toBeCloseTo(1.9, 5);
		expect(adaptiveCount(snapshot, "calx", "command:calendar", now)).toBe(0);
		expect(adaptiveCount(snapshot, "cal", "command:calendar", now + 30 * DAY)).toBeLessThan(3.8);
	});

	test("round-trips and stays under the byte budget", () => {
		const now = 5 * DAY;
		let snapshot = EMPTY_LEARNING;
		for (let index = 0; index < 2000; index++) {
			snapshot = recordPick(
				snapshot,
				`query-${index % 700}`,
				`chat:${"x".repeat(80)}-${index}`,
				now,
			);
		}
		const text = serializeLearning(snapshot);
		expect(text.length).toBeLessThanOrEqual(MAX_LEARNING_BYTES);
		expect(parseLearning(text, now).version).toBe(1);
		expect(parseLearning("{not json", now)).toBe(EMPTY_LEARNING);
		expect(parseLearning(JSON.stringify({ version: 2 }), now)).toBe(EMPTY_LEARNING);
	});
});

describe("rankItems", () => {
	const item = (id: string, title: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
		id,
		kind: "chat",
		title,
		group: "chats",
		scope: "work",
		icon: RiChat2Line,
		...extra,
	});

	test("tiers decide first; boosts only reorder within a tier", () => {
		const ranked = rankItems(
			[
				item("a", "Fix auth refresh", { contextBoost: 60 }),
				item("b", "Auth flow follow-ups"),
				item("c", "Unrelated"),
			],
			["auth"],
			EMPTY_LEARNING,
			"auth",
			0,
		);
		expect(ranked.map((entry) => entry.item.id)).toEqual(["b", "a"]);
	});

	test("a top hit needs a prefix-or-better lead or a learned latch", () => {
		const items = [item("a", "Auth"), item("b", "Authentication")];
		const ranked = rankItems(items, ["auth"], EMPTY_LEARNING, "auth", 0);
		expect(pickTopHit(ranked)?.item.id).toBe("a");
		const close = rankItems(
			[item("x", "Fix auth"), item("y", "Fix auth too")],
			["auth"],
			EMPTY_LEARNING,
			"auth",
			0,
		);
		expect(pickTopHit(close)).toBeNull();
		let learning = recordPick(EMPTY_LEARNING, "auth", "y", 0);
		learning = recordPick(learning, "auth", "y", 0);
		const latched = rankItems(
			[item("x", "Fix auth"), item("y", "Fix auth too")],
			["auth"],
			learning,
			"auth",
			0,
		);
		expect(pickTopHit(latched)?.item.id).toBe("y");
	});
});
