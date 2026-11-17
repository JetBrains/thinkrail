import { CodedError } from "@thinkrail/shared/codedError";
import { type InstalledExtensions, installedExtensions } from "../extensions";

function runtime(): InstalledExtensions {
	const current = installedExtensions();
	if (!current) throw new Error("Installed extensions are not running on this host.");
	return current;
}

function sourceOf(params: { source?: unknown }): string {
	if (typeof params.source !== "string" || !params.source.trim()) {
		throw new CodedError("EXTENSION_UNKNOWN", "An extension source is required.");
	}
	return params.source.trim();
}

export async function extensionsRemove(params: { source: string }): Promise<{ ok: true }> {
	await runtime().remove(sourceOf(params));
	return { ok: true };
}

export async function extensionsUpdate(params: { source: string }): Promise<{ ok: true }> {
	await runtime().update(sourceOf(params));
	return { ok: true };
}

export function extensionsCheckUpdates(params: { force?: boolean }): Promise<{ source: string }[]> {
	return runtime().checkUpdates({ force: params.force === true });
}
