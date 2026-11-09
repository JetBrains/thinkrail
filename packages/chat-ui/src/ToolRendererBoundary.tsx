import type { ToolRenderer, ToolStatus } from "@thinkrail/extension-api/web";
import { Component, type ReactNode } from "react";

export type ToolPresentationErrorReporter = (error: Error, reportId: string | undefined) => void;

let reporter: ToolPresentationErrorReporter | null = null;
const reported = new WeakSet<object>();

export function setToolPresentationErrorReporter(next: ToolPresentationErrorReporter | null): void {
	reporter = next;
}

export function reportToolPresentationError(
	source: object,
	error: unknown,
	reportId: string,
): void {
	if (reported.has(source)) return;
	reported.add(source);
	reporter?.(error instanceof Error ? error : new Error(String(error)), reportId);
}

interface Props {
	renderer: ToolRenderer;
	toolCallId: string;
	status: ToolStatus;
	streaming: boolean;
	fallback: ReactNode;
	children: ReactNode;
}

type Attempt = Pick<Props, "renderer" | "toolCallId" | "status" | "streaming">;

interface State extends Attempt {
	failed: boolean;
}

function attemptOf({ renderer, toolCallId, status, streaming }: Attempt): Attempt {
	return { renderer, toolCallId, status, streaming };
}

export class ToolRendererBoundary extends Component<Props, State> {
	override state: State = { failed: false, ...attemptOf(this.props) };

	static getDerivedStateFromError(): Partial<State> {
		return { failed: true };
	}

	static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
		return props.renderer === state.renderer &&
			props.toolCallId === state.toolCallId &&
			props.status === state.status &&
			props.streaming === state.streaming
			? null
			: { failed: false, ...attemptOf(props) };
	}

	override componentDidCatch(error: Error): void {
		reportToolPresentationError(this.props.renderer, error, "tool-renderer");
	}

	override render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
