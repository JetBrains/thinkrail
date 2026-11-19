import { describe, expect, it, mock } from "bun:test";
import type { ExtensionHostServices } from "@thinkrail/extension-api/server";
import { runExtensionHostServices } from "./hostServices";
import type { ServerExtensionEntry } from "./registry";

function setup() {
	const disabled = new Set<string>();
	const warnings: string[] = [];
	const services = mock(
		(name: string, signal: AbortSignal) =>
			({
				dataDir: `/data/extensions/${name}`,
				log: { info: () => {}, warn: (message: string) => warnings.push(`${name}: ${message}`) },
				signal,
			}) as unknown as ExtensionHostServices,
	);
	const stopBoard = mock(() => {});
	const board = mock((_host: ExtensionHostServices) => ({ stop: stopBoard }));
	const broken = mock((): { stop?: () => void } => {
		throw new Error("cannot start");
	});
	const stopSlow = mock(async () => {
		throw new Error("cannot stop");
	});
	const slow = mock(() => ({ stop: stopSlow }));
	const entries: ServerExtensionEntry[] = [
		{
			specifier: "@acme/board/server",
			extension: { name: "board", extensions: [], hostService: board },
		},
		{ specifier: "@acme/plain/server", extension: { name: "plain", extensions: [] } },
		{
			specifier: "@acme/broken/server",
			extension: { name: "broken", extensions: [], hostService: broken },
		},
		{
			specifier: "@acme/slow/server",
			extension: { name: "slow", extensions: [], hostService: slow },
		},
	];
	const runner = runExtensionHostServices({
		isDisabled: (name) => disabled.has(name),
		services,
		entries,
	});
	return {
		runner,
		disabled,
		warnings,
		board,
		stopBoard,
		broken,
		slow,
		stopSlow,
		services,
	};
}

describe("runExtensionHostServices", () => {
	it("starts each enabled service once with its own services, isolating one that fails to start", () => {
		const { runner, board, broken, slow, warnings, services } = setup();
		runner.sync();
		runner.sync();
		expect(board).toHaveBeenCalledTimes(1);
		expect(board.mock.calls[0]?.[0]?.dataDir).toBe("/data/extensions/board");
		expect(slow).toHaveBeenCalledTimes(1);
		expect(broken).toHaveBeenCalledTimes(2);
		expect(warnings).toEqual([
			"broken: its host service failed to start",
			"broken: its host service failed to start",
		]);
		expect(
			services.mock.calls.filter(([name]) => name === "broken").map(([, signal]) => signal.aborted),
		).toEqual([true, true]);
	});

	it("stops a service when its extension is switched off and starts it again when switched on", async () => {
		const { runner, disabled, board, stopBoard } = setup();
		runner.sync();
		disabled.add("board");
		runner.sync();
		await Bun.sleep(0);
		expect(stopBoard).toHaveBeenCalledTimes(1);
		runner.sync();
		expect(board).toHaveBeenCalledTimes(1);
		disabled.delete("board");
		runner.sync();
		expect(board).toHaveBeenCalledTimes(2);
	});

	it("aborts a service's signal once it stopped, and a restart gets a fresh one", async () => {
		const { runner, disabled, board } = setup();
		runner.sync();
		const first = board.mock.calls[0]?.[0]?.signal;
		expect(first?.aborted).toBe(false);
		disabled.add("board");
		runner.sync();
		await Bun.sleep(0);
		expect(first?.aborted).toBe(true);
		disabled.delete("board");
		runner.sync();
		expect(board.mock.calls[1]?.[0]?.signal.aborted).toBe(false);
	});

	it("never starts a service of an extension that is off", () => {
		const { runner, disabled, board } = setup();
		disabled.add("board");
		runner.sync();
		expect(board).not.toHaveBeenCalled();
	});

	it("stops every running service with the host, logs a failing stop and starts nothing after", async () => {
		const { runner, board, stopBoard, stopSlow, warnings, services } = setup();
		runner.sync();
		await runner.stop();
		expect(stopBoard).toHaveBeenCalledTimes(1);
		expect(stopSlow).toHaveBeenCalledTimes(1);
		expect(warnings).toContain("slow: its host service failed to stop");
		expect(services.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
		runner.sync();
		expect(board).toHaveBeenCalledTimes(1);
		await runner.stop();
		expect(stopBoard).toHaveBeenCalledTimes(1);
	});
});
