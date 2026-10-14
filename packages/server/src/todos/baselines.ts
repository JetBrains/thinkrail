import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";

const BASELINE_SUFFIX = ".baselines.json";

export interface Baseline {
	paths: string[];
	head: string | null;
	shared?: boolean;
}

interface BaselineFile {
	version: 1;
	items: Record<string, Baseline>;
}

function baselinePath(root: string, sessionId: string): string {
	return join(root, WORKSPACE_TODOS_DIR, `${sessionId}${BASELINE_SUFFIX}`);
}

function isBaseline(raw: unknown): raw is Baseline {
	if (typeof raw !== "object" || raw === null) return false;
	const o = raw as Record<string, unknown>;
	return (
		Array.isArray(o.paths) &&
		o.paths.every((p) => typeof p === "string") &&
		(o.head === null || typeof o.head === "string") &&
		(o.shared === undefined || typeof o.shared === "boolean")
	);
}

export function readBaselines(root: string, sessionId: string): Record<string, Baseline> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(baselinePath(root, sessionId), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return {};
		const items = (parsed as Record<string, unknown>).items;
		if (typeof items !== "object" || items === null) return {};
		const out: Record<string, Baseline> = {};
		for (const [id, value] of Object.entries(items)) {
			if (isBaseline(value)) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

export function otherSessionWindows(root: string, sessionId: string): boolean {
	return otherOwners(root, sessionId).some(
		(owner) => Object.keys(readBaselines(root, owner)).length > 0,
	);
}

export function markOtherSessionWindowsShared(root: string, sessionId: string): void {
	for (const owner of otherOwners(root, sessionId)) {
		const items = readBaselines(root, owner);
		const open = Object.values(items);
		if (open.length === 0 || open.every((b) => b.shared)) continue;
		for (const baseline of open) baseline.shared = true;
		try {
			writeBaselines(root, owner, items);
		} catch {}
	}
}

function otherOwners(root: string, sessionId: string): string[] {
	try {
		return readdirSync(join(root, WORKSPACE_TODOS_DIR))
			.filter((n) => n.endsWith(BASELINE_SUFFIX))
			.map((n) => n.slice(0, -BASELINE_SUFFIX.length))
			.filter((owner) => owner !== sessionId);
	} catch {
		return [];
	}
}

export function dropItemBaseline(root: string, sessionId: string, id: string): void {
	const items = readBaselines(root, sessionId);
	if (items[id] === undefined) return;
	delete items[id];
	writeBaselines(root, sessionId, items);
}

export function removeSessionBaselines(root: string, sessionId: string): void {
	try {
		rmSync(baselinePath(root, sessionId), { force: true });
	} catch {}
}

export function writeBaselines(
	root: string,
	sessionId: string,
	items: Record<string, Baseline>,
): void {
	const path = baselinePath(root, sessionId);
	if (Object.keys(items).length === 0) {
		rmSync(path, { force: true });
		return;
	}
	const file: BaselineFile = { version: 1, items };
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}
