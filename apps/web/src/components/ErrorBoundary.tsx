import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

// Our single boundary primitive: contains a panel's render/lazy-import crash to that region instead of unmounting the root (bare gray `--bg-dark`); a rejected lazy `import()` (stale Vite chunk → 504) throws through Suspense into here, and we steer that case to a reload.

const CHUNK_ERROR_PATTERNS = [
	"dynamically imported module", // "Failed to fetch dynamically imported module: …"
	"importing a module script failed", // Safari
	"error loading dynamically imported module",
	"outdated optimize dep", // Vite dev: pre-bundled deps went stale
];

/** True when `error` is a failed dynamic `import()` (stale/unreachable chunk) — those recover from a reload, not a retry. Pure so it's unit-testable. */
export function isChunkLoadError(error: unknown): boolean {
	const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
	return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

type Props = {
	children: ReactNode;
	/** Short human name of the wrapped surface (e.g. "Terminals") — shown in the fallback + logs. */
	label?: string;
	/** When any value here changes, a caught error clears and children re-render — wire to the subtree's identity (workspace/tab id) so navigating away auto-recovers. */
	resetKeys?: readonly unknown[];
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		// Keep the crash observable in the console for dev/debugging; the UI already degrades gracefully.
		console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info);
	}

	override componentDidUpdate(prev: Props): void {
		if (this.state.error && !keysEqual(prev.resetKeys, this.props.resetKeys)) {
			this.reset();
		}
	}

	reset = (): void => {
		this.setState({ error: null });
	};

	override render(): ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<PanelErrorFallback
				label={this.props.label}
				error={error}
				reset={this.reset}
				isChunkError={isChunkLoadError(error)}
			/>
		);
	}
}

/** Shallow (`Object.is`) equality of two `resetKeys` arrays — a caught error clears only when this returns false. Pure so it's unit-testable. */
export function keysEqual(
	a: readonly unknown[] | undefined,
	b: readonly unknown[] | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((value, i) => Object.is(value, b[i]));
}

/** Themed, self-contained fallback — token utilities only, so it wears any theme. */
function PanelErrorFallback({
	label,
	error,
	reset,
	isChunkError,
}: {
	label: string | undefined;
	error: Error;
	reset: () => void;
	isChunkError: boolean;
}) {
	return (
		<div
			data-testid="error-boundary-fallback"
			role="alert"
			className="flex h-full min-h-0 flex-col items-center justify-center gap-sm overflow-auto p-lg text-center"
		>
			<AlertTriangle className="size-6 text-red" />
			<p className="text-sm font-medium text-text">
				{label ? `The ${label} panel hit an error` : "Something went wrong"}
			</p>
			<p className="max-w-[28rem] text-xs text-hint">
				{isChunkError
					? "Failed to load part of the app (a stale or unreachable resource). Reloading usually fixes it."
					: error.message || "An unexpected error occurred while rendering this view."}
			</p>
			<div className="mt-xs flex items-center gap-sm">
				{isChunkError ? (
					<button
						type="button"
						data-testid="error-reload"
						onClick={() => window.location.reload()}
						className="flex items-center gap-xs rounded-[var(--radius-md)] border border-border2 bg-elevated px-md py-xs text-sm text-text hover:bg-hover"
					>
						<RefreshCw className="size-4" /> Reload page
					</button>
				) : (
					<button
						type="button"
						data-testid="error-retry"
						onClick={reset}
						className="flex items-center gap-xs rounded-[var(--radius-md)] border border-border2 bg-elevated px-md py-xs text-sm text-text hover:bg-hover"
					>
						<RotateCcw className="size-4" /> Try again
					</button>
				)}
			</div>
		</div>
	);
}
