import { describe, expect, test } from "bun:test";
import type { ProjectTrustSummary } from "@thinkrail/contracts";
import {
	deriveProjectTrustNotice,
	stopTrustingText,
	trustEnablesText,
	trustedNoticeText,
	trustGrantParams,
	untrustedNoticeText,
} from "./projectTrust";

const summary = (over: Partial<ProjectTrustSummary> = {}): ProjectTrustSummary => ({
	aliasSkills: [],
	nativeResources: false,
	...over,
});

describe("deriveProjectTrustNotice", () => {
	test("stays hidden until both the record and the summary are known, and when nothing is gated", () => {
		expect(deriveProjectTrustNotice(undefined, summary({ nativeResources: true }))).toEqual({
			kind: "hidden",
		});
		expect(deriveProjectTrustNotice({}, null)).toEqual({ kind: "hidden" });
		expect(deriveProjectTrustNotice({}, summary())).toEqual({ kind: "hidden" });
	});

	test("evaluates alias and native trust separately and reports only what is still off", () => {
		const gated = summary({ aliasSkills: ["a", "b"], nativeResources: true });
		expect(deriveProjectTrustNotice({ piResourceTrust: "untrusted" }, gated)).toEqual({
			kind: "untrusted",
			aliasSkills: 2,
			nativeResources: true,
		});
		expect(deriveProjectTrustNotice({ piResourceTrust: "granted" }, gated)).toEqual({
			kind: "untrusted",
			aliasSkills: 2,
			nativeResources: false,
		});
		expect(
			deriveProjectTrustNotice({ trusted: true, acknowledgedSkills: ["a", "b"] }, gated),
		).toEqual({ kind: "untrusted", aliasSkills: 0, nativeResources: true });
	});

	test("after both grants it asks to review newly arrived aliases, else reads as trusted", () => {
		const granted = { trusted: true, piResourceTrust: "granted" as const };
		expect(
			deriveProjectTrustNotice(
				{ ...granted, acknowledgedSkills: ["a"] },
				summary({ aliasSkills: ["a", "b"] }),
			),
		).toEqual({ kind: "unacknowledged", names: ["b"] });
		expect(deriveProjectTrustNotice(granted, summary({ nativeResources: true }))).toEqual({
			kind: "trusted",
			aliasSkills: 0,
		});
	});
});

test("notice copy names what is gated and what a grant enables", () => {
	const both = { kind: "untrusted", aliasSkills: 1, nativeResources: true } as const;
	expect(untrustedNoticeText(both)).toBe(
		"This project ships 1 skill and its own pi resources — off until you trust it.",
	);
	expect(trustEnablesText(both)).toBe(
		"Trust loads its skills, prompts, themes, SYSTEM.md and subagent definitions, and lets its extensions and settings run code on this machine.",
	);
	const aliases = {
		kind: "untrusted",
		aliasSkills: 3,
		nativeResources: false,
	} as const;
	expect(untrustedNoticeText(aliases)).toBe(
		"This project ships 3 skills — off until you trust it.",
	);
	expect(trustEnablesText(aliases)).toBeNull();
	expect(trustedNoticeText({ kind: "trusted", aliasSkills: 2 })).toBe("2 project skills trusted.");
	expect(trustedNoticeText({ kind: "trusted", aliasSkills: 0 })).toBe("Project resources trusted.");
});

test("a grant asks for pi-level resources only when the notice named them", () => {
	const notice = { kind: "untrusted", aliasSkills: 1 } as const;
	expect(trustGrantParams("p", { ...notice, nativeResources: true })).toEqual({
		id: "p",
		trusted: true,
		resources: true,
	});
	expect(trustGrantParams("p", { ...notice, nativeResources: false })).toEqual({
		id: "p",
		trusted: true,
	});
});

test("the stop-trusting confirmation names pi resources and reloads only where pi-level trust applies", () => {
	const granted = { trusted: true, piResourceTrust: "granted" } as const;
	expect(stopTrustingText(granted, true)).toBe(
		"Its project skills and pi resources stop loading; open chats reload when idle.",
	);
	expect(stopTrustingText({ ...granted, piResourceTrust: "untrusted" }, true)).toBe(
		"Its project skills stop loading in new chats.",
	);
	expect(stopTrustingText(granted, false)).toBe("Its project skills stop loading in new chats.");
});
