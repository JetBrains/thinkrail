import { afterEach, expect, test } from "bun:test";
import type { ProjectRefsChangedPayload } from "@thinkrail/contracts";
import { nudgeProjectRefsChanged, setRefsNudgePublisher } from "./refsNudge";

afterEach(() => {
	setRefsNudgePublisher(null);
});

test("publishes exactly one project.refsChanged frame, scoped to the given project", () => {
	const frames: ProjectRefsChangedPayload[] = [];
	setRefsNudgePublisher((payload) => frames.push(payload));

	nudgeProjectRefsChanged("p1");

	expect(frames).toEqual([{ projectId: "p1" }]);
});

test("maps each call to its own project — never one frame per workspace the project happens to have", () => {
	const frames: ProjectRefsChangedPayload[] = [];
	setRefsNudgePublisher((payload) => frames.push(payload));

	// Three calls, three projects worth of intent (p1 twice, p2 once) — every real caller (`git.prefetch`,
	// `git.fetchNow`) already resolved a single project id before calling this, so there is no workspace
	// count left to fan out over; unlike `nudgeBaseRefWorkspaces` (one call → N per-workspace frames), this
	// is one call → exactly one frame, however many workspaces that project has open.
	nudgeProjectRefsChanged("p1");
	nudgeProjectRefsChanged("p2");
	nudgeProjectRefsChanged("p1");

	expect(frames).toEqual([{ projectId: "p1" }, { projectId: "p2" }, { projectId: "p1" }]);
});

test("without an installed publisher the nudge is a silent no-op (unit-test / teardown state)", () => {
	setRefsNudgePublisher(null);
	expect(() => nudgeProjectRefsChanged("p1")).not.toThrow();
});
