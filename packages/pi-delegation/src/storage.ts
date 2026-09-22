import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { parseTranscript, type Transcript } from "./history";
import { DelegationError, type DelegationErrorCode } from "./types";

export const DEFAULT_SCOPE = "default";

export function defaultDelegationRoot(): string {
	return join(getAgentDir(), "delegation");
}

export function delegationSessionDir(
	delegationRoot: string,
	scope: string,
	parentSessionId: string,
): string {
	return join(delegationRoot, scope, parentSessionId);
}

export function deriveChildSessionFile(
	delegationRoot: string,
	scope: string,
	parentSessionId: string,
	childSessionId: string,
): string | undefined {
	const dir = delegationSessionDir(delegationRoot, scope, parentSessionId);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return undefined;
	}
	const match = entries.find((name) => name.endsWith(`_${childSessionId}.jsonl`));
	return match ? join(dir, match) : undefined;
}

export function assertSegment(value: string, code: DelegationErrorCode): void {
	if (typeof value !== "string" || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(value)) {
		throw new DelegationError(code, `Invalid storage identity segment: ${value}`);
	}
}

export function resourceSessionDir(root: string, scope: string, resourceId: string): string {
	assertSegment(scope, "invalid-child-record");
	assertSegment(resourceId, "invalid-child-record");
	return join(resolve(root), scope, ".resources", resourceId);
}

export function locateResourceTranscript(
	root: string,
	scope: string,
	resourceId: string,
	sessionId: string,
): {
	file: string;
	transcript: Transcript;
} {
	assertSegment(sessionId, "invalid-child-record");
	const dir = resourceSessionDir(root, scope, resourceId);
	try {
		for (const path of [
			join(resolve(root), scope),
			join(resolve(root), scope, ".resources"),
			dir,
		]) {
			if (!lstatSync(path).isDirectory())
				throw new DelegationError(
					"invalid-child-transcript",
					"Resource directory is not a regular directory",
				);
		}
		const names = readdirSync(dir).filter((name) => name.endsWith(`_${sessionId}.jsonl`));
		if (names.length === 0)
			throw new DelegationError(
				"child-transcript-unavailable",
				`Missing transcript for ${sessionId}`,
			);
		if (names.length !== 1)
			throw new DelegationError(
				"invalid-child-transcript",
				`Ambiguous transcript for ${sessionId}`,
			);
		const name = names[0];
		if (!name) throw new DelegationError("child-transcript-unavailable", "Missing transcript");
		const file = join(dir, name);
		if (!lstatSync(file).isFile())
			throw new DelegationError("invalid-child-transcript", "Transcript is not a regular file");
		const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			if (!fstatSync(fd).isFile())
				throw new DelegationError("invalid-child-transcript", "Transcript is not a regular file");
			const transcript = parseTranscript(readFileSync(fd, "utf8"), sessionId);
			return { file, transcript };
		} finally {
			closeSync(fd);
		}
	} catch (error) {
		if (error instanceof DelegationError) {
			if (error.code === "invalid-history")
				throw new DelegationError("invalid-child-transcript", error.message);
			throw error;
		}
		throw new DelegationError(
			"child-transcript-unavailable",
			`Cannot read resource transcript: ${String(error)}`,
		);
	}
}
