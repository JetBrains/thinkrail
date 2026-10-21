import type { MergeMethod } from "@thinkrail/contracts";
import { STORAGE_PREFIX } from "../constants/branding";
import { getTransport } from "../transport";

export interface MergePrefs {
	method?: MergeMethod;
	deleteBranch?: boolean;
}

const FALLBACK_ORDER: MergeMethod[] = ["squash", "merge", "rebase"];
const METHODS = new Set<string>(FALLBACK_ORDER);

function storageKey(projectId: string): string {
	return `${STORAGE_PREFIX}merge-pr:${getTransport().httpBase()}:${projectId}`;
}

export function loadMergePrefs(projectId: string): MergePrefs {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "null");
		if (typeof raw !== "object" || raw === null) return {};
		const { method, deleteBranch } = raw as Record<string, unknown>;
		return {
			...(typeof method === "string" && METHODS.has(method)
				? { method: method as MergeMethod }
				: {}),
			...(typeof deleteBranch === "boolean" ? { deleteBranch } : {}),
		};
	} catch {
		return {};
	}
}

export function saveMergePrefs(projectId: string, prefs: Required<MergePrefs>): void {
	try {
		localStorage.setItem(storageKey(projectId), JSON.stringify(prefs));
	} catch {}
}

export function allowedMergeMethods(reported: MergeMethod[] | undefined): MergeMethod[] {
	if (!reported || reported.length === 0) return FALLBACK_ORDER;
	return FALLBACK_ORDER.filter((method) => reported.includes(method));
}

export function defaultMergeMethod(allowed: MergeMethod[], remembered?: MergeMethod): MergeMethod {
	if (remembered && allowed.includes(remembered)) return remembered;
	return allowed[0] ?? "squash";
}
