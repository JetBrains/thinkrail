import {
	type AnnotationSide,
	DEFAULT_VIRTUAL_FILE_METRICS,
	type VirtualFileMetrics,
	Virtualizer,
} from "@pierre/diffs";
import { type RefCallback, useCallback, useMemo, useState } from "react";
import { useOptionalResourcePreferences } from "../../host";

type ConnectedInstance = Parameters<Virtualizer["connect"]>[1];

interface LinePositioned {
	getLinePosition(lineNumber: number, side?: AnnotationSide): { top: number } | undefined;
}

function isLinePositioned(
	instance: ConnectedInstance,
): instance is ConnectedInstance & LinePositioned {
	return typeof Reflect.get(instance, "getLinePosition") === "function";
}

export class PierreVirtualizer extends Virtualizer {
	private connected: { container: HTMLElement; instance: LinePositioned } | undefined;

	override connect(container: HTMLElement, instance: ConnectedInstance): () => void {
		if (isLinePositioned(instance)) this.connected = { container, instance };
		return super.connect(container, instance);
	}

	override disconnect(container: HTMLElement): void {
		if (this.connected?.container === container) this.connected = undefined;
		super.disconnect(container);
	}

	override cleanUp(): void {
		this.connected = undefined;
		super.cleanUp();
	}

	revealLine(lineNumber: number, side?: AnnotationSide): boolean {
		const root = this.getRoot();
		const connected = this.connected;
		if (!(root instanceof HTMLElement) || !connected) return false;
		const position = connected.instance.getLinePosition(lineNumber, side);
		if (!position) return false;
		const top = this.getOffsetInScrollContainer(connected.container) + position.top;
		this.scrollTo({ top: top - root.clientHeight / 2, behavior: "instant" });
		return true;
	}
}

const OVERSCROLL_SIZE = 400;
const HUNK_LINE_COUNT = 5;

function codeLineHeight(): number {
	const height = getComputedStyle(document.documentElement).getPropertyValue(
		"--tr-code-row-height",
	);
	return Number.parseFloat(height) || DEFAULT_VIRTUAL_FILE_METRICS.lineHeight;
}

export function usePierreVirtualizer<T extends HTMLElement>(
	attachScroller: RefCallback<T>,
): {
	virtualizer: PierreVirtualizer;
	metrics: VirtualFileMetrics;
	attach: RefCallback<T>;
	/**
	 * The row height the metrics were built for. Pierre reads metrics once, when its instance is
	 * created, so a component that renders one must key itself on this value to pick up a change.
	 */
	lineHeight: number;
} {
	const [virtualizer] = useState(() => new PierreVirtualizer({ overscrollSize: OVERSCROLL_SIZE }));
	// The host knows the scaled row height. Reading the CSS property instead would lag by a frame —
	// `applyFontScale` writes it from an effect, after the render that changed the reader's choice.
	const lineHeight = useOptionalResourcePreferences()?.codeRowHeight ?? codeLineHeight();
	const metrics = useMemo<VirtualFileMetrics>(
		() => ({ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight, hunkLineCount: HUNK_LINE_COUNT }),
		[lineHeight],
	);
	const attach = useCallback<RefCallback<T>>(
		(node) => {
			if (node) virtualizer.setup(node);
			else virtualizer.cleanUp();
			attachScroller(node);
		},
		[attachScroller, virtualizer],
	);
	return { virtualizer, metrics, attach, lineHeight };
}
