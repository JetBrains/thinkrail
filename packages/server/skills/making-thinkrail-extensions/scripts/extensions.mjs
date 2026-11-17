#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: node extensions.mjs <command>
  where             the data dir, extensions.json, status.json and the host's extension API
  add <folder>      declare a built extension folder, wait for the host, print its status
  reload <folder>   make the host load a rebuilt folder again, wait, print its status
  remove <folder>   undeclare a folder (the folder itself is kept), wait for the host
  status [folder]   print the host's last status, or one folder's entry`;

const WAIT_MS = Number(process.env.THINKRAIL_EXTENSIONS_WAIT_MS ?? 120_000);
const dataDir = resolve(process.env.THINKRAIL_DATA_DIR || join(homedir(), ".thinkrail"));
const declarationsPath = join(dataDir, "extensions.json");
const statusPath = join(dataDir, "extensions", "status.json");

function stop(code, message) {
	console.error(message);
	process.exit(code);
}

function folderOf(source) {
	if (source.startsWith("file://")) return normalize(fileURLToPath(source));
	if (source === "~" || source.startsWith("~/")) return normalize(join(homedir(), source.slice(1)));
	return normalize(source);
}

function readDeclarations() {
	if (!existsSync(declarationsPath)) return { extensions: [] };
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(declarationsPath, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		stop(
			2,
			`${declarationsPath} is not valid JSON (${error.message}). Nothing was written: fix the file first — the host ignores it until it parses.`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		stop(
			2,
			`${declarationsPath} must be an object like { "extensions": [] }. Nothing was written.`,
		);
	}
	const list = parsed.extensions ?? [];
	if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string")) {
		stop(2, `"extensions" in ${declarationsPath} must be a list of strings. Nothing was written.`);
	}
	return { ...parsed, extensions: list };
}

function writeDeclarations(value) {
	const temporary = `${declarationsPath}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`);
	renameSync(temporary, declarationsPath);
}

function readStatus() {
	try {
		return JSON.parse(readFileSync(statusPath, "utf8"));
	} catch {
		return undefined;
	}
}

function entryFor(status, folder) {
	return status?.extensions?.find(
		(entry) => typeof entry.source === "string" && folderOf(entry.source) === folder,
	);
}

function folderArgument(raw) {
	if (!raw) stop(2, USAGE);
	return resolve(folderOf(raw));
}

async function waitForHost(since, ready) {
	const deadline = Date.now() + WAIT_MS;
	while (Date.now() < deadline) {
		const status = readStatus();
		if (status && Date.parse(status.updatedAt) >= since && ready(status)) return status;
		await new Promise((done) => setTimeout(done, 250));
	}
	stop(
		3,
		`The host did not report on the change within ${Math.round(WAIT_MS / 1000)}s (${statusPath}). Is ThinkRail running with this data dir? An older ThinkRail writes no status file: check Settings → Extensions instead.`,
	);
}

function report(status, folder) {
	if (status.fileError) console.log(`extensions.json was refused: ${status.fileError}`);
	const entry = entryFor(status, folder);
	console.log(JSON.stringify(entry ?? { source: folder, state: "not declared" }, null, 2));
	if (entry?.state === "loaded" && Array.isArray(entry.tools) && entry.tools.length === 0) {
		console.error(
			"Note: its server half registered no tools — a factory threw or never called pi.registerTool.",
		);
	}
	process.exit(entry?.state === "loaded" ? 0 : 1);
}

const [command, argument] = process.argv.slice(2);

if (command === "where") {
	const status = readStatus();
	console.log(
		JSON.stringify(
			{
				dataDir,
				declarations: declarationsPath,
				status: statusPath,
				api: status?.api ?? null,
				hostReported: status?.updatedAt ?? null,
			},
			null,
			2,
		),
	);
} else if (command === "status") {
	const status = readStatus();
	if (!status)
		stop(3, `No ${statusPath} yet: the host has not reported (or is older than this skill).`);
	if (argument) report(status, folderArgument(argument));
	else console.log(JSON.stringify(status, null, 2));
} else if (command === "add" || command === "reload") {
	const folder = folderArgument(argument);
	if (!existsSync(join(folder, "package.json"))) stop(2, `No package.json in ${folder}.`);
	const declarations = readDeclarations();
	const since = Date.now();
	if (command === "reload") {
		const now = new Date();
		utimesSync(join(folder, "package.json"), now, now);
	}
	if (!declarations.extensions.some((source) => folderOf(source) === folder)) {
		declarations.extensions.push(folder);
	}
	writeDeclarations(declarations);
	const status = await waitForHost(
		since,
		(next) => next.fileError !== undefined || entryFor(next, folder)?.state !== undefined,
	);
	report(status, folder);
} else if (command === "remove") {
	const folder = folderArgument(argument);
	const declarations = readDeclarations();
	const since = Date.now();
	declarations.extensions = declarations.extensions.filter((source) => folderOf(source) !== folder);
	writeDeclarations(declarations);
	await waitForHost(since, (next) => entryFor(next, folder) === undefined);
	console.log(`Removed ${folder} from ${declarationsPath}; the folder itself is untouched.`);
} else {
	stop(2, USAGE);
}
