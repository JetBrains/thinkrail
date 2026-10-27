import {
	RiAlertLine as AlertTriangle,
	RiRefreshLine as RefreshCw,
	RiArrowGoBackLine as RotateCcw,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
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

export type ErrorBoundaryReporter = (error: Error, reportId: string | undefined) => void;

let reporter: ErrorBoundaryReporter | null = null;

export function setErrorBoundaryReporter(next: ErrorBoundaryReporter | null): void {
	reporter = next;
}

type Props = {
	children: ReactNode;
	label?: string;
	reportId?: string;
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
		try {
			reporter?.(error, this.props.reportId);
		} catch {}
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
	const t = useT();
	return (
		<div
			data-testid="error-boundary-fallback"
			role="alert"
			className="flex h-full min-h-0 flex-col items-center justify-center gap-8 overflow-auto p-16 text-center"
		>
			<AlertTriangle className="size-24 text-feedback-error" />
			<p className="tr-title-compact text-text-default">
				{label
					? t("components.errorBoundary.panelTitle", { label })
					: t("components.errorBoundary.title")}
			</p>
			<p className="max-w-[28rem] tr-text-metadata text-text-muted">
				{isChunkError
					? t("components.errorBoundary.chunkError")
					: error.message || t("components.errorBoundary.unexpected")}
			</p>
			<div className="mt-4 flex items-center gap-8">
				{isChunkError ? (
					<Button
						variant="outline"
						size="m"
						iconLeft={RefreshCw}
						data-testid="error-reload"
						onClick={() => window.location.reload()}
					>
						{t("components.errorBoundary.reload")}
					</Button>
				) : (
					<Button
						variant="outline"
						size="m"
						iconLeft={RotateCcw}
						data-testid="error-retry"
						onClick={reset}
					>
						{t("components.errorBoundary.tryAgain")}
					</Button>
				)}
			</div>
		</div>
	);
}
