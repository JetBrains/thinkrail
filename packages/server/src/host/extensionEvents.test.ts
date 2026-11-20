import { describe, expect, test } from "bun:test";
import type { SessionStateRecord, Workspace } from "@thinkrail/contracts";
import type { ExtensionHostServices } from "@thinkrail/extension-api/server";
import { runExtensionHostServices } from "../extensions";
import { createExtensionEventHub } from "./extensionEvents";

function setup() {
	const disabled = new Set<string>();
	const warnings: string[] = [];
	const hub = createExtensionEventHub({
		isDisabled: (name) => disabled.has(name),
		log: (name) => ({ info: () => {}, warn: (message) => warnings.push(`${name}: ${message}`) }),
	});
	return { hub, disabled, warnings };
}

const SIGNAL = new AbortController().signal;
const workspace = { id: "w1", projectId: "p1", name: "One", branch: "one" } as Workspace;
const record = {
	sessionId: "s1",
	workspaceId: "w1",
	projectId: "p1",
	state: { execution: "idle" },
} as SessionStateRecord;

describe("extension event hub", () => {
	test("delivers each event type to its own subscribers only, each with its own copy", () => {
		const { hub } = setup();
		const seen: unknown[] = [];
		hub.bus("board", SIGNAL).subscribe("workspace.updated", (payload) => {
			seen.push(["board", payload]);
			payload.name = "mutated";
		});
		hub
			.bus("other", SIGNAL)
			.subscribe("workspace.updated", (payload) => seen.push(["other", payload.name]));
		hub
			.bus("board", SIGNAL)
			.subscribe("session.state", (payload) => seen.push(["state", payload.sessionId]));
		hub.emit("workspace.updated", workspace);
		hub.emit("agent.settled", { workspaceId: "w1", sessionId: "s1" });
		expect(seen).toEqual([
			["board", { ...workspace, name: "mutated" }],
			["other", "One"],
		]);
		expect(workspace.name).toBe("One");
		hub.emit("session.state", record);
		expect(seen.at(-1)).toEqual(["state", "s1"]);
	});

	test("skips a switched-off extension and stops after unsubscribe or once its run's signal aborts", () => {
		const { hub, disabled } = setup();
		const seen: string[] = [];
		const run = new AbortController();
		const off = hub
			.bus("board", run.signal)
			.subscribe("agent.settled", ({ sessionId }) => seen.push(sessionId));
		hub.bus("board", run.signal).subscribe("workspace.removed", ({ id }) => seen.push(id));
		disabled.add("board");
		hub.emit("agent.settled", { workspaceId: "w1", sessionId: "off" });
		disabled.delete("board");
		hub.emit("agent.settled", { workspaceId: "w1", sessionId: "on" });
		off();
		hub.emit("agent.settled", { workspaceId: "w1", sessionId: "unsubscribed" });
		hub.emit("workspace.removed", { projectId: "p1", id: "w9" });
		run.abort();
		hub.emit("workspace.removed", { projectId: "p1", id: "aborted" });
		hub.bus("board", run.signal).subscribe("workspace.removed", ({ id }) => seen.push(id));
		hub.emit("workspace.removed", { projectId: "p1", id: "late" });
		expect(seen).toEqual(["on", "w9"]);
	});

	test("a run's abort drops only its own subscriptions, not a later run's of the same extension", () => {
		const { hub } = setup();
		const seen: string[] = [];
		const first = new AbortController();
		const second = new AbortController();
		hub.bus("board", first.signal).subscribe("container.removed", () => seen.push("first"));
		hub.bus("board", second.signal).subscribe("container.removed", () => seen.push("second"));
		first.abort();
		hub.emit("container.removed", { id: "c1" });
		expect(seen).toEqual(["second"]);
	});

	test("logs a listener that throws or rejects and still delivers to the others", async () => {
		const { hub, warnings } = setup();
		const seen: string[] = [];
		hub.bus("thrower", SIGNAL).subscribe("container.removed", () => {
			throw new Error("boom");
		});
		hub.bus("rejecter", SIGNAL).subscribe("container.removed", async () => {
			throw new Error("later");
		});
		hub.bus("fine", SIGNAL).subscribe("container.removed", ({ id }) => seen.push(id));
		expect(() => hub.emit("container.removed", { id: "c1" })).not.toThrow();
		await Bun.sleep(0);
		expect(seen).toEqual(["c1"]);
		expect(warnings.sort()).toEqual([
			"rejecter: container.removed listener failed",
			"thrower: container.removed listener failed",
		]);
	});

	test("keeps a restarted host service's event subscriptions when the previous run's stop settles after it", async () => {
		const { hub, disabled } = setup();
		const seen: number[] = [];
		const stops: (() => void)[] = [];
		let runs = 0;
		const runner = runExtensionHostServices({
			isDisabled: (name) => disabled.has(name),
			services: (name, signal) =>
				({ events: hub.bus(name, signal), signal }) as unknown as ExtensionHostServices,
			entries: [
				{
					specifier: "@acme/board/server",
					extension: {
						name: "board",
						extensions: [],
						hostService: (host) => {
							const run = ++runs;
							host.events.subscribe("container.removed", () => seen.push(run));
							return { stop: () => new Promise<void>((resolve) => stops.push(resolve)) };
						},
					},
				},
			],
		});
		runner.sync();
		disabled.add("board");
		runner.sync();
		disabled.delete("board");
		runner.sync();
		for (const resolve of stops) resolve();
		await Bun.sleep(0);
		hub.emit("container.removed", { id: "c1" });
		expect(seen).toEqual([2]);
	});
});
