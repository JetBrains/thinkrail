import { readFileSync } from "node:fs";
import { type PollUntilOptions, pollUntil } from "./lifecycle";

const RAW_PREVIEW_CHARS = 2_000;

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

export function readSettledJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}

export function describeDocument(path: string): string {
	try {
		const raw = readFileSync(path, "utf8");
		const preview = raw.length > RAW_PREVIEW_CHARS ? `${raw.slice(0, RAW_PREVIEW_CHARS)}…` : raw;
		return `${path} contains ${JSON.stringify(preview)}`;
	} catch (error) {
		return errorCode(error) === "ENOENT"
			? `${path} does not exist`
			: `${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export async function waitForDocument<T>(
	path: string,
	accept: (document: unknown) => T | undefined,
	options: PollUntilOptions,
): Promise<T> {
	let accepted: { value: T } | undefined;
	try {
		await pollUntil(() => {
			const document = readSettledJson(path);
			const value = document === undefined ? undefined : accept(document);
			accepted = value === undefined ? undefined : { value };
			return accepted !== undefined;
		}, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${message}; ${describeDocument(path)}`, { cause: error });
	}
	if (!accepted) throw new Error(`${options.what}: ${describeDocument(path)}`);
	return accepted.value;
}
