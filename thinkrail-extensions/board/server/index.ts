import { defineServerExtension, type ExtensionHostServices } from "@thinkrail/extension-api/server";
import { Board } from "./board";
import { boardQueries } from "./queries";
import { createBoardTools } from "./tools";

const boards = new Map<string, Board>();
let current: Board | undefined;

/**
 * One board per data folder, shared by the queries, the host service and the agent tools; a board whose
 * services' signal aborted (a switch-off) gives way to a fresh one on the current run's services.
 */
function boardFor(host: ExtensionHostServices): Board {
	let board = boards.get(host.dataDir);
	if (!board || board.host.signal.aborted) {
		board = new Board(host);
		boards.set(host.dataDir, board);
	}
	current = board;
	return board;
}

export default defineServerExtension({
	name: "board",
	title: "Board",
	description:
		"A board per project whose cards start agent workspaces and move with their progress, with tools for the agent to read cards and file new ones into Triage, roadmap skills to shape, plan, report on, review and close initiatives, and discovery skills to research and score ideas and watch competitors.",
	apiVersion: 1,
	extensions: [],
	skillPackages: ["@thinkrail/ext-board"],
	sessionExtensions: () => [createBoardTools(() => current)],
	queries: (host) => boardQueries(boardFor(host)),
	hostService: (host) => ({ stop: boardFor(host).listen() }),
});
