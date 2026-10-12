import { describe, expect, test } from "bun:test";
import type { ProjectTrustSummary } from "@thinkrail/contracts";
import {
	canStopTrusting,
	deriveProjectTrustNotice,
	stopTrustingText,
	trustEnablesText,
	trustedNoticeText,
	trustGrantParams,
	untrustedNoticeText,
} from "./projectTrust";

const summary = (over: Partial<ProjectTrustSummary> = {}): ProjectTrustSummary => ({
	aliasSkills: [],
	piResources: [],
	mcpServers: 0,
	...over,
});

describe("deriveProjectTrustNotice", () => {
	test("stays hidden until both the record and the summary are known, and when nothing is gated", () => {
		expect(deriveProjectTrustNotice(undefined, summary({ piResources: ["prompts"] }))).toEqual({
			kind: "hidden",
		});
		expect(deriveProjectTrustNotice({}, null)).toEqual({ kind: "hidden" });
		expect(deriveProjectTrustNotice({}, summary())).toEqual({ kind: "hidden" });
	});

	test("protocol 81 summaries without an MCP count keep their original trust meaning", () => {
		expect(deriveProjectTrustNotice({}, { aliasSkills: [], piResources: [] })).toEqual({
			kind: "hidden",
		});
		const notice = deriveProjectTrustNotice({}, { aliasSkills: [], piResources: ["settings"] });
		expect(notice).toMatchObject({ kind: "untrusted", mcpServers: 0 });
		if (notice.kind !== "untrusted") throw new Error("expected trust notice");
		expect(trustEnablesText(notice)).toBe("Trust lets its settings run code on this machine.");
	});

	test("evaluates alias and native trust separately and reports only what is still off", () => {
		const gated = summary({ aliasSkills: ["a", "b"], piResources: ["prompts", "extensions"] });
		expect(deriveProjectTrustNotice({ piResourceTrust: "untrusted" }, gated)).toEqual({
			kind: "untrusted",
			aliasSkills: 2,
			piResources: ["prompts", "extensions"],
			mcpServers: 0,
		});
		expect(deriveProjectTrustNotice({ piResourceTrust: "granted" }, gated)).toEqual({
			kind: "untrusted",
			aliasSkills: 2,
			piResources: [],
			mcpServers: 0,
		});
		expect(
			deriveProjectTrustNotice({ trusted: true, acknowledgedSkills: ["a", "b"] }, gated),
		).toEqual({
			kind: "untrusted",
			aliasSkills: 0,
			piResources: ["prompts", "extensions"],
			mcpServers: 0,
		});
	});

	test("a repository whose only gated content is .pi/mcp.json still asks for pi-level trust", () => {
		const mcpOnly = summary({ mcpServers: 2 });
		expect(deriveProjectTrustNotice({}, mcpOnly)).toEqual({
			kind: "untrusted",
			aliasSkills: 0,
			piResources: [],
			mcpServers: 2,
		});
		expect(deriveProjectTrustNotice({ piResourceTrust: "granted" }, mcpOnly)).toEqual({
			kind: "trusted",
			aliasSkills: 0,
		});
	});

	test("after both grants it asks to review newly arrived aliases, else reads as trusted", () => {
		const granted = { trusted: true, piResourceTrust: "granted" as const };
		expect(
			deriveProjectTrustNotice(
				{ ...granted, acknowledgedSkills: ["a"] },
				summary({ aliasSkills: ["a", "b"] }),
			),
		).toEqual({ kind: "unacknowledged", names: ["b"] });
		expect(deriveProjectTrustNotice(granted, summary({ piResources: ["themes"] }))).toEqual({
			kind: "trusted",
			aliasSkills: 0,
		});
	});
});

describe("notice copy", () => {
	const untrusted = (
		aliasSkills: number,
		piResources: ProjectTrustSummary["piResources"],
		mcpServers = 0,
	) => ({ kind: "untrusted", aliasSkills, piResources, mcpServers }) as const;

	test("names what is gated", () => {
		expect(untrustedNoticeText(untrusted(1, ["prompts"]))).toBe(
			"This project ships 1 skill and its own Pi resources — off until you trust it.",
		);
		expect(untrustedNoticeText(untrusted(3, []))).toBe(
			"This project ships 3 skills — off until you trust it.",
		);
		expect(trustedNoticeText({ kind: "trusted", aliasSkills: 2 })).toBe(
			"2 project skills trusted.",
		);
		expect(trustedNoticeText({ kind: "trusted", aliasSkills: 0 })).toBe(
			"Project resources trusted.",
		);
	});

	test("names exactly the kinds present, and says code runs only for extensions or settings", () => {
		expect(trustEnablesText(untrusted(3, []))).toBeNull();
		expect(trustEnablesText(untrusted(0, ["prompts"]))).toBe("Trust loads its prompts.");
		expect(trustEnablesText(untrusted(0, ["subagents", "skills", "systemPrompt"]))).toBe(
			"Trust loads its skills, system prompt and subagent definitions.",
		);
		expect(trustEnablesText(untrusted(0, ["extensions"]))).toBe(
			"Trust lets its extensions run code on this machine.",
		);
		expect(trustEnablesText(untrusted(1, ["settings", "prompts", "extensions", "themes"]))).toBe(
			"Trust loads its prompts and themes, and lets its extensions and settings run code on this machine.",
		);
	});

	test("counts repository MCP servers and says trust alone does not start them", () => {
		expect(untrustedNoticeText(untrusted(0, [], 2))).toBe(
			"This project ships 2 MCP servers — off until you trust it.",
		);
		expect(trustEnablesText(untrusted(0, [], 1))).toBe(
			"Trust alone does not start its 1 MCP server.",
		);
		expect(trustEnablesText(untrusted(0, ["extensions"], 2))).toBe(
			"Trust lets its extensions run code on this machine. Trust alone does not start its 2 MCP servers.",
		);
	});
});

test("a grant asks for pi-level resources only when the notice named them", () => {
	expect(
		trustGrantParams("p", {
			kind: "untrusted",
			aliasSkills: 1,
			piResources: ["prompts"],
			mcpServers: 0,
		}),
	).toEqual({ id: "p", trusted: true, resources: true });
	expect(
		trustGrantParams("p", { kind: "untrusted", aliasSkills: 0, piResources: [], mcpServers: 1 }),
	).toEqual({ id: "p", trusted: true, resources: true });
	expect(
		trustGrantParams("p", { kind: "untrusted", aliasSkills: 1, piResources: [], mcpServers: 0 }),
	).toEqual({
		id: "p",
		trusted: true,
	});
});

test("the stop-trusting confirmation names pi resources and reloads only where pi-level trust applies", () => {
	const granted = { trusted: true, piResourceTrust: "granted" } as const;
	expect(stopTrustingText(granted, true)).toBe(
		"Its project skills, Pi resources and MCP servers stop loading; running subagents stop and open chats reload when idle.",
	);
	expect(stopTrustingText({ ...granted, piResourceTrust: "untrusted" }, true)).toBe(
		"Its project skills stop loading in new chats.",
	);
	expect(stopTrustingText(granted, false)).toBe("Its project skills stop loading in new chats.");
});

test("Stop trusting is offered whenever either grant is held", () => {
	expect(canStopTrusting(undefined)).toBe(false);
	expect(canStopTrusting({ piResourceTrust: "untrusted" })).toBe(false);
	expect(canStopTrusting({ trusted: true, piResourceTrust: "untrusted" })).toBe(true);
	expect(canStopTrusting({ piResourceTrust: "granted" })).toBe(true);
});
