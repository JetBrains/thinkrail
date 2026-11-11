import { readFileSync } from "node:fs";
import {
	type InstalledFontFamily,
	type InstalledFontsResult,
	isFontFamilyName,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { type BoundedRun, runBounded } from "../subprocess";

export const INSTALLED_FONTS_FIXTURE_ENV = "THINKRAIL_INSTALLED_FONTS";
const QUERY_TIMEOUT_MS = 15_000;
const FONTCONFIG_MONOSPACED = new Set(["100", "110"]);

const MAC_SCRIPT = `ObjC.import("AppKit");
const manager = $.NSFontManager.sharedFontManager;
JSON.stringify(
	ObjC.deepUnwrap(manager.availableFontFamilies).map((name) => ({
		name,
		monospaceHint: (ObjC.deepUnwrap(manager.availableMembersOfFontFamily(name)) || []).some(
			(member) => (member[3] & 0x400) !== 0,
		),
	})),
);`;

const WINDOWS_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Drawing",
	"$names = @([System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name })",
	"$json = ConvertTo-Json -InputObject $names -Compress",
	"[regex]::Replace($json, '[^\\x00-\\x7F]', { param($m) '\\u{0:x4}' -f [int][char]$m.Value })",
].join("\n");

interface InstalledFontsQuery {
	argv: string[];
	parse: (stdout: string) => InstalledFontFamily[];
}

type QueryRunner = (argv: string[]) => Promise<BoundedRun>;

interface ListInstalledFontsOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	run?: QueryRunner;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function unavailable(message: string): CodedError {
	return new CodedError("INSTALLED_FONTS_UNAVAILABLE", message);
}

function familyOf(item: unknown): InstalledFontFamily {
	const name = typeof item === "object" && item !== null ? Reflect.get(item, "name") : undefined;
	if (typeof item !== "object" || item === null || typeof name !== "string") {
		throw new Error("expected every font family to have a name");
	}
	return { name, monospaceHint: Reflect.get(item, "monospaceHint") === true };
}

function familyList(value: unknown): InstalledFontFamily[] {
	if (!Array.isArray(value)) throw new Error("expected a list of font families");
	return value.map(familyOf);
}

export function parseFcList(stdout: string): InstalledFontFamily[] {
	return stdout
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const tab = line.lastIndexOf("\t");
			if (tab === -1) return { name: line, monospaceHint: false };
			const spacing = line.slice(tab + 1).trim();
			return { name: line.slice(0, tab), monospaceHint: FONTCONFIG_MONOSPACED.has(spacing) };
		});
}

export function parseMacFamilies(stdout: string): InstalledFontFamily[] {
	return familyList(JSON.parse(stdout));
}

export function parseWindowsFamilies(stdout: string): InstalledFontFamily[] {
	const names: unknown = JSON.parse(stdout);
	if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
		throw new Error("expected a list of family names");
	}
	return names.map((name: string) => ({ name, monospaceHint: false }));
}

export function normalizeInstalledFamilies(families: InstalledFontFamily[]): InstalledFontFamily[] {
	const byName = new Map<string, InstalledFontFamily>();
	for (const family of families) {
		const name = family.name.trim();
		if (name.startsWith(".") || !isFontFamilyName(name)) continue;
		const key = name.toLowerCase();
		const seen = byName.get(key);
		byName.set(key, {
			name: seen?.name ?? name,
			monospaceHint: (seen?.monospaceHint ?? false) || family.monospaceHint,
		});
	}
	return [...byName.values()].sort((a, b) =>
		a.name.localeCompare(b.name, "en", { sensitivity: "accent" }),
	);
}

export function installedFontsQuery(platform: NodeJS.Platform): InstalledFontsQuery {
	if (platform === "darwin") {
		return { argv: ["osascript", "-l", "JavaScript", "-e", MAC_SCRIPT], parse: parseMacFamilies };
	}
	if (platform === "win32") {
		const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
		return {
			argv: ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
			parse: parseWindowsFamilies,
		};
	}
	return { argv: ["fc-list", "-f", "%{family[0]}\\t%{spacing}\\n"], parse: parseFcList };
}

function fixtureFamilies(path: string): InstalledFontFamily[] {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw unavailable(`The installed-font fixture could not be read: ${messageOf(error)}`);
	}
	const directive =
		typeof value === "object" && value !== null ? Reflect.get(value, "error") : undefined;
	if (typeof directive === "string") throw unavailable(directive);
	try {
		return familyList(value);
	} catch (error) {
		throw unavailable(`The installed-font fixture is not a font list: ${messageOf(error)}`);
	}
}

function firstLine(text: string): string {
	return text.replaceAll("\r", "").trim().split("\n")[0] ?? "";
}

function queryFailure(tool: string, run: BoundedRun): string {
	if (run.launchFailed) return `${tool} could not be started: ${firstLine(run.err)}`;
	if (run.timedOut) return `${tool} did not answer within ${QUERY_TIMEOUT_MS / 1000} s`;
	const reason = firstLine(run.err);
	return reason ? `${tool} failed: ${reason}` : `${tool} failed`;
}

const runQuery: QueryRunner = (argv) => runBounded(argv, { timeoutMs: QUERY_TIMEOUT_MS });

export async function listInstalledFonts({
	platform = process.platform,
	env = process.env,
	run = runQuery,
}: ListInstalledFontsOptions = {}): Promise<InstalledFontsResult> {
	const fixture = env[INSTALLED_FONTS_FIXTURE_ENV];
	if (fixture) return { families: normalizeInstalledFamilies(fixtureFamilies(fixture)) };
	const query = installedFontsQuery(platform);
	const tool = query.argv[0] ?? "";
	const result = await run(query.argv);
	if (!result.ok) throw unavailable(queryFailure(tool, result));
	let families: InstalledFontFamily[];
	try {
		families = query.parse(result.out);
	} catch (error) {
		throw unavailable(`${tool} printed output that could not be read: ${messageOf(error)}`);
	}
	return { families: normalizeInstalledFamilies(families) };
}
