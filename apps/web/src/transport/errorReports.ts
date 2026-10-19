import {
	CLIENT_ERROR_REPORT_PROTOCOL_VERSION,
	type ClientErrorKind,
	type ClientErrorReport,
} from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport } from "./wireTransport";

const MAX_REPORTS_PER_PAGE = 50;
const MAX_PENDING = 10;

let sent = 0;
let pending: ClientErrorReport[] = [];
let unsubscribe: (() => void) | null = null;

export function supportsClientErrorReports(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CLIENT_ERROR_REPORT_PROTOCOL_VERSION;
}

export function clientErrorReport(
	kind: ClientErrorKind,
	error: unknown,
	boundary?: string,
): ClientErrorReport {
	const real = error instanceof Error ? error : null;
	return {
		kind,
		type: real?.name || (kind === "rejection" ? "UnhandledRejection" : "Error"),
		message: real ? real.message : typeof error === "string" ? error : "",
		...(real?.stack ? { stack: real.stack } : {}),
		...(boundary ? { boundary } : {}),
	};
}

function deliver(report: ClientErrorReport, protocolVersion: number): void {
	if (!supportsClientErrorReports(protocolVersion) || sent >= MAX_REPORTS_PER_PAGE) return;
	sent++;
	try {
		getTransport()
			.request("client.reportError", report)
			.catch(() => {});
	} catch {}
}

export function reportClientError(report: ClientErrorReport): void {
	try {
		const version = useAppStore.getState().protocolVersion;
		if (version !== null) {
			deliver(report, version);
			return;
		}
		if (pending.length < MAX_PENDING) pending.push(report);
		unsubscribe ??= useAppStore.subscribe((state) => {
			if (state.protocolVersion === null) return;
			unsubscribe?.();
			unsubscribe = null;
			const queued = pending;
			pending = [];
			for (const item of queued) deliver(item, state.protocolVersion);
		});
	} catch {}
}

export function installClientErrorReporting(target: Window = window): () => void {
	const onError = (event: ErrorEvent) => {
		if (event.error !== undefined || event.message) {
			reportClientError(clientErrorReport("window", event.error ?? event.message));
		}
	};
	const onRejection = (event: PromiseRejectionEvent) => {
		reportClientError(clientErrorReport("rejection", event.reason));
	};
	target.addEventListener("error", onError);
	target.addEventListener("unhandledrejection", onRejection);
	return () => {
		target.removeEventListener("error", onError);
		target.removeEventListener("unhandledrejection", onRejection);
	};
}

export function resetClientErrorReportsForTests(): void {
	sent = 0;
	pending = [];
	unsubscribe?.();
	unsubscribe = null;
}
