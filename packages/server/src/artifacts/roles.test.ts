import { expect, test } from "bun:test";
import { artifactRole, replyPathCandidates } from "./roles";

test("a signal decides first: what the agent published, the user's pick, then what it showed or linked", () => {
	expect(artifactRole("_work/a.html", { published: true, picked: true })).toEqual({
		role: "result",
		reason: "published",
	});
	expect(artifactRole("_scratch/a.png", { picked: true })).toEqual({
		role: "result",
		reason: "picked",
	});
	expect(artifactRole("tools/rules.mjs", { presented: "shown" })).toEqual({
		role: "result",
		reason: "shown",
	});
	expect(artifactRole("e2e.log", { presented: "linked" })).toEqual({
		role: "result",
		reason: "linked",
	});
});

test("without a signal every file is a working file, whatever its kind", () => {
	const role = (path: string) => artifactRole(path, {}).reason;
	expect(role("mockups/features/_scratch/w1/v1.png")).toBe("working-folder");
	expect(role("gallery/.cache/x.md")).toBe("working-folder");
	expect(role("gallery/analyzers/images/tool/1.png")).toBe("working-folder");
	expect(role("pr-triage/batch_2/pr-1.md")).toBe("working-folder");
	expect(role("pr-triage/notes2/732.md")).toBe("working-folder");
	expect(role("mockups/features/12-inbox/rules.mjs")).toBe("script");
	expect(role("pr-triage/pr-1214.json")).toBe("data");
	expect(role("pr-triage/README")).toBe("data");
	expect(role("research_notes/topic/summary.md")).toBe("unshown");
	expect(role("mockups/session-analytics/index.html")).toBe("unshown");
	expect(role("screenshots/after.png")).toBe("unshown");
	expect(artifactRole("reports/r.md", {}).role).toBe("working");
	expect(artifactRole("screenshots/after.png", {}).role).toBe("working");
});

test("a reply's paths come from links, code spans and plain words, cleaned of punctuation", () => {
	const text = [
		"Opened [the gallery](gallery/analyzers/index.html) and the report",
		"`.thinkrail/context/reports/Анализ сессий агентов.md`.",
		"Files are in .thinkrail/context/: pr-body.md, (TASK-x.md)",
		"See [notes](research_notes/%D0%90.md#top) and @mockups/a.html, ./b.md!",
	].join("\n");
	const candidates = replyPathCandidates(text);
	expect(candidates).toContain("gallery/analyzers/index.html");
	expect(candidates).toContain(".thinkrail/context/reports/Анализ сессий агентов.md");
	expect(candidates).toContain("pr-body.md");
	expect(candidates).toContain("TASK-x.md");
	expect(candidates).toContain("research_notes/А.md");
	expect(candidates).toContain("mockups/a.html");
	expect(candidates).toContain("b.md");
});
