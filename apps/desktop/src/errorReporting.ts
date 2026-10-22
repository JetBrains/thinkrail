export type DesktopErrorReporter = (error: unknown, scope: string) => void;

let reporter: DesktopErrorReporter | null = null;

export function setDesktopErrorReporter(next: DesktopErrorReporter | null): void {
	reporter = next;
}

export function desktopError(scope: string, message: string, error?: unknown): void {
	if (error === undefined) console.error(`[desktop] ${message}`);
	else console.error(`[desktop] ${message}`, error);
	if (error === undefined || !reporter) return;
	try {
		reporter(error, scope);
	} catch {}
}
