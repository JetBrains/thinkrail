import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { shallowEqualArrays } from "../lib";

const CHUNK_ERROR_PATTERNS = [
	"dynamically imported module", // "Failed to fetch dynamically imported module: …"
	"importing a module script failed", // Safari
	"error loading dynamically imported module",
	"outdated optimize dep", // Vite dev: pre-bundled deps went stale
];

export function isChunkLoadError(error: unknown): boolean {
	const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
	return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

type Props = {
	children: ReactNode;
	label?: string;
	resetKeys?: readonly unknown[];
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info);
	}

	override componentDidUpdate(prev: Props): void {
		if (this.state.error && !shallowEqualArrays(prev.resetKeys, this.props.resetKeys)) {
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
			className="flex h-full min-h-0 flex-col items-center justify-center gap-8 overflow-auto p-16 text-center"
		>
			<AlertTriangle className="size-24 text-feedback-error" />
			<p className="tr-title-compact text-text-default">
				{label ? `The ${label} panel hit an error` : "Something went wrong"}
			</p>
			<p className="max-w-[28rem] tr-text-metadata text-text-muted">
				{isChunkError
					? "Failed to load part of the app (a stale or unreachable resource). Reloading usually fixes it."
					: error.message || "An unexpected error occurred while rendering this view."}
			</p>
			<div className="mt-4 flex items-center gap-8">
				{isChunkError ? (
					<button
						type="button"
						data-testid="error-reload"
						onClick={() => window.location.reload()}
						className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						<RefreshCw className="size-16" /> Reload page
					</button>
				) : (
					<button
						type="button"
						data-testid="error-retry"
						onClick={reset}
						className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						<RotateCcw className="size-16" /> Try again
					</button>
				)}
			</div>
		</div>
	);
}
