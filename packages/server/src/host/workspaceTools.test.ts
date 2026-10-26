import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, SessionState, WireModel, Workspace } from "@thinkrail/contracts";
import {
	chatStateLabel,
	clampFinalMessage,
	composePrompt,
	matchWorkspaces,
	prepareAttachments,
	resolveModel,
	resolveProject,
} from "./workspaceTools";

let dir: string;

beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-workspace-tools-")));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const project = (id: string, name: string, slug = name.toLowerCase()): Project => ({
	id,
	name,
	slug,
	path: `/repos/${slug}`,
	lastOpened: 1,
});

test("resolveProject defaults to the caller's project and matches open projects by id, slug, or name", () => {
	const open = [project("p1", "ThinkRail"), project("p2", "Backend", "backend-api")];
	expect(resolveProject(undefined, "p1", open).id).toBe("p1");
	expect(resolveProject("  ", "p1", open).id).toBe("p1");
	expect(resolveProject("p2", "p1", open).id).toBe("p2");
	expect(resolveProject("backend-api", "p1", open).id).toBe("p2");
	expect(resolveProject("thinkrail", "p2", open).id).toBe("p1");
	expect(() => resolveProject("frontend", "p1", open)).toThrow(
		'Unknown project "frontend". Open projects: ThinkRail (thinkrail), Backend (backend-api).',
	);
	expect(() => resolveProject(undefined, "closed", open)).toThrow("not open");
});

test("resolveModel accepts provider/id or a unique id and lists the available models otherwise", () => {
	const models = [
		{ provider: "anthropic", id: "claude" },
		{ provider: "openai", id: "gpt" },
		{ provider: "openrouter", id: "gpt" },
	] as WireModel[];
	expect(resolveModel("openai/gpt", models)).toBe(models[1] as WireModel);
	expect(resolveModel("claude", models)).toBe(models[0] as WireModel);
	expect(() => resolveModel("gpt", models)).toThrow('Ambiguous model "gpt"');
	expect(() => resolveModel("llama", models)).toThrow(
		"Available: anthropic/claude, openai/gpt, openrouter/gpt.",
	);
});

test("attachments: images become prompt images, other files absolute paths; missing files fail", () => {
	writeFileSync(join(dir, "shot.PNG"), Buffer.from([1, 2, 3]));
	writeFileSync(join(dir, "notes.md"), "# notes");
	const prepared = prepareAttachments(["shot.PNG", join(dir, "notes.md")], dir);
	expect(prepared.images).toEqual([
		{ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/png" },
	]);
	expect(prepared.files).toEqual([join(dir, "notes.md")]);
	expect(() => prepareAttachments(["missing.txt"], dir)).toThrow(
		`Attachment not found or not a file: ${join(dir, "missing.txt")}`,
	);
	expect(() => prepareAttachments([dir], dir)).toThrow("not a file");
});

test("composePrompt lists non-image attachments after the prompt", () => {
	expect(composePrompt("Do it", [])).toBe("Do it");
	expect(composePrompt("Do it", ["/a/b.md", "/c.txt"])).toBe(
		"Do it\n\nAttached files:\n- /a/b.md\n- /c.txt",
	);
});

const state = (patch: Partial<SessionState>): SessionState => ({
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
	...patch,
});

test("chatStateLabel maps session state to the agent-facing vocabulary", () => {
	expect(chatStateLabel(undefined)).toBe("idle");
	expect(chatStateLabel(state({}))).toBe("idle");
	expect(chatStateLabel(state({ execution: "running" }))).toBe("working");
	expect(chatStateLabel(state({ backgroundWork: true }))).toBe("working");
	expect(
		chatStateLabel(
			state({
				execution: "running",
				needsInput: { interactionId: "i1", kind: "tool-response", toolCallId: "t1" },
			}),
		),
	).toBe("needs_you");
	expect(chatStateLabel(state({ completion: { completionId: "c", outcome: "succeeded" } }))).toBe(
		"finished",
	);
	expect(
		chatStateLabel(
			state({ completion: { completionId: "c", outcome: "failed", failure: "error" } }),
		),
	).toBe("failed");
	expect(chatStateLabel(state({ completion: { completionId: "c", outcome: "cancelled" } }))).toBe(
		"interrupted",
	);
});

test("clampFinalMessage keeps the tail of a long final message", () => {
	expect(clampFinalMessage("short", 10)).toBe("short");
	expect(clampFinalMessage("0123456789abc", 4)).toBe("…9abc");
});

test("matchWorkspaces finds by id, branch, or name and reports misses", () => {
	const ws = (id: string, name: string, branch: string) =>
		({ id, name, branch, projectId: "p1" }) as Workspace;
	const all = [ws("w1", "Fix login", "fix-login"), ws("w2", "workspace-2", "workspace-2")];
	const { matched, missing } = matchWorkspaces(["w1", "FIX-LOGIN", "workspace-2", "nope"], all);
	expect(matched.map((w) => w.id)).toEqual(["w1", "w2"]);
	expect(missing).toEqual(["nope"]);
});
