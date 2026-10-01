import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withServerFallbackOptOut(text: string | undefined, providerId: string): string {
	const parsed: unknown = text === undefined || text.trim() === "" ? {} : JSON.parse(text);
	if (!isObject(parsed)) throw new Error("models.json is not a JSON object");
	const providers = parsed.providers ?? {};
	if (!isObject(providers)) throw new Error("models.json `providers` is not an object");
	const provider = providers[providerId] ?? {};
	if (!isObject(provider)) throw new Error(`models.json provider "${providerId}" is not an object`);
	const compat = provider.compat ?? {};
	if (!isObject(compat))
		throw new Error(`models.json provider "${providerId}" compat is not an object`);
	const next = {
		...parsed,
		providers: {
			...providers,
			[providerId]: { ...provider, compat: { ...compat, allowedFallbackModels: [] } },
		},
	};
	const indent = /^[ \t]+/m.exec(text ?? "")?.[0] ?? "  ";
	return `${JSON.stringify(next, null, indent)}\n`;
}

async function readIfPresent(path: string): Promise<{ text: string; mode: number } | undefined> {
	try {
		const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
		return { text, mode: info.mode & 0o777 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function writeServerFallbackOptOut(path: string, providerId: string): Promise<void> {
	const current = await readIfPresent(path);
	let next: string;
	try {
		next = withServerFallbackOptOut(current?.text, providerId);
	} catch (error) {
		throw new Error(
			`Couldn't update ${path}: ${error instanceof Error ? error.message : String(error)}. Fix the file and try again.`,
		);
	}
	const mode = current?.mode ?? 0o600;
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(tmp, next, { encoding: "utf8", mode });
	await chmod(tmp, mode);
	await rename(tmp, path);
}
