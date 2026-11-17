import type { ToolRenderer } from "@thinkrail/extension-api/web";
import { Component, type ReactNode } from "react";
import { reportBoundaryError } from "../components/ErrorBoundary";

const reported = new WeakSet<object>();

export function reportToolPresentationError(
	source: object,
	error: unknown,
	reportId: string,
): void {
	if (reported.has(source)) return;
	reported.add(source);
	reportBoundaryError(error instanceof Error ? error : new Error(String(error)), reportId);
}

interface Props {
	renderer: ToolRenderer;
	toolCallId: string;
	fallback: ReactNode;
	children: ReactNode;
}

interface State {
	failed: boolean;
	renderer: ToolRenderer;
	toolCallId: string;
}

export class ToolRendererBoundary extends Component<Props, State> {
	override state: State = {
		failed: false,
		renderer: this.props.renderer,
		toolCallId: this.props.toolCallId,
	};

	static getDerivedStateFromError(): Partial<State> {
		return { failed: true };
	}

	static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
		return props.renderer === state.renderer && props.toolCallId === state.toolCallId
			? null
			: { failed: false, renderer: props.renderer, toolCallId: props.toolCallId };
	}

	override componentDidCatch(error: Error): void {
		reportToolPresentationError(this.props.renderer, error, "tool-renderer");
	}

	override render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
