import { RiAlertLine, RiArrowGoBackLine, RiSparkling2Line } from "@remixicon/react";
import { redactLaunchToken } from "@thinkrail/contracts";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconTooltip } from "../components/ui/tooltip";
import { cn } from "../lib";
import { getTransport } from "../transport";
import { askAgentToFix, fixPrompt } from "./askAgent";

export type SurfaceLayout = "fill" | "inline" | "status";

export const reportSurfaceError = ({
	name,
	surfaceId,
	message,
}: {
	name: string;
	surfaceId: string;
	message: string;
}) =>
	void getTransport()
		.request("ext.reportError", { name, surfaceId, message: redactLaunchToken(message) })
		.catch(() => {});

interface SurfaceErrorProps {
	name: string;
	surfaceId?: string;
	title: string;
	error: string;
	onRetry?: () => void;
	layout?: SurfaceLayout;
}

const askToFix = ({
	name,
	surfaceId,
	error,
}: Pick<SurfaceErrorProps, "name" | "surfaceId" | "error">) =>
	void askAgentToFix(fixPrompt({ name, error, ...(surfaceId ? { surfaceId } : {}) }));

const SurfaceErrorChip = ({ name, surfaceId, title, error }: SurfaceErrorProps) => (
	<IconTooltip label={`${title}: ${error.split("\n")[0] ?? ""}`}>
		<button
			type="button"
			aria-label={title}
			data-testid="ext-surface-error"
			data-ext={name}
			onClick={() => askToFix({ name, error, ...(surfaceId ? { surfaceId } : {}) })}
			className="flex items-center rounded-[var(--radius-sm)] p-4 text-feedback-error hover:bg-control-bg-hovered"
		>
			<RiAlertLine className="size-16" />
		</button>
	</IconTooltip>
);

export const SurfaceError = ({ layout = "fill", ...props }: SurfaceErrorProps) => {
	const error = redactLaunchToken(props.error);
	if (layout === "status") return <SurfaceErrorChip {...props} error={error} />;
	const { name, surfaceId, title, onRetry } = props;
	return (
		<div
			role="alert"
			data-testid="ext-surface-error"
			data-ext={name}
			className={cn(
				"flex min-h-0 flex-col gap-8 overflow-auto p-12",
				layout === "inline" ? "items-start" : "h-full items-center justify-center text-center",
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
					onClick={() => askToFix({ name, error, ...(surfaceId ? { surfaceId } : {}) })}
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
};

interface BoundaryProps {
	name: string;
	surfaceId: string;
	resetKey: string;
	layout: SurfaceLayout;
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
		reportSurfaceError({
			name: this.props.name,
			surfaceId: this.props.surfaceId,
			message: [error.stack ?? error.message, info.componentStack ?? ""].join("\n").trim(),
		});
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
				layout={this.props.layout}
			/>
		);
	}
}
