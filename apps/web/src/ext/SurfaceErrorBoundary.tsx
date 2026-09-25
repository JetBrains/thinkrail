import { RiAlertLine, RiArrowGoBackLine, RiSparkling2Line } from "@remixicon/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "../lib";
import { getTransport } from "../transport";
import { askAgentToFix, fixPrompt } from "./askAgent";

export const SurfaceError = ({
	name,
	surfaceId,
	title,
	error,
	onRetry,
	compact = false,
}: {
	name: string;
	surfaceId?: string;
	title: string;
	error: string;
	onRetry?: () => void;
	compact?: boolean;
}) => (
	<div
		role="alert"
		data-testid="ext-surface-error"
		data-ext={name}
		className={cn(
			"flex min-h-0 flex-col gap-8 overflow-auto p-12",
			compact ? "items-start" : "h-full items-center justify-center text-center",
		)}
	>
		<p className="flex items-center gap-4 tr-title-compact text-text-default">
			<RiAlertLine className="size-16 shrink-0 text-feedback-error" /> {title}
		</p>
		<pre className="max-w-full overflow-auto whitespace-pre-wrap tr-code-text text-text-muted">
			{error}
		</pre>
		<div className="flex items-center gap-8">
			<button
				type="button"
				data-testid="ext-ask-agent"
				onClick={() =>
					void askAgentToFix(fixPrompt({ name, error, ...(surfaceId ? { surfaceId } : {}) }))
				}
				className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
			>
				<RiSparkling2Line className="size-16" /> Ask agent to fix
			</button>
			{onRetry ? (
				<button
					type="button"
					onClick={onRetry}
					className="flex items-center gap-4 rounded-[var(--radius-sm)] px-12 py-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<RiArrowGoBackLine className="size-16" /> Try again
				</button>
			) : null}
		</div>
	</div>
);

interface BoundaryProps {
	name: string;
	surfaceId: string;
	resetKey: string;
	children: ReactNode;
}

interface BoundaryState {
	error: Error | null;
}

export class SurfaceErrorBoundary extends Component<BoundaryProps, BoundaryState> {
	override state: BoundaryState = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		const message = [error.stack ?? error.message, info.componentStack ?? ""].join("\n").trim();
		void getTransport()
			.request("ext.reportError", {
				name: this.props.name,
				surfaceId: this.props.surfaceId,
				message,
			})
			.catch(() => {});
	}

	override componentDidUpdate(prev: BoundaryProps): void {
		if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
	}

	reset = () => this.setState({ error: null });

	override render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<SurfaceError
				name={this.props.name}
				surfaceId={this.props.surfaceId}
				title={`Extension ${this.props.name} crashed`}
				error={error.message}
				onRetry={this.reset}
			/>
		);
	}
}
