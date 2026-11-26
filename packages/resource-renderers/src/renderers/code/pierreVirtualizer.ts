import {
	type AnnotationSide,
	DEFAULT_VIRTUAL_FILE_METRICS,
	type VirtualFileMetrics,
	Virtualizer,
} from "@pierre/diffs";
import { onFontsChange } from "@thinkrail/ui/fonts";
import {
	type RefCallback,
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";

type ConnectedInstance = Parameters<Virtualizer["connect"]>[1];

const NEAREST_MARGIN_LINES = 3;

interface LinePositioned {
	getLinePosition(lineNumber: number, side?: AnnotationSide): { top: number } | undefined;
}

interface MetricsAware {
	setMetrics(metrics: VirtualFileMetrics): void;
}

function isLinePositioned(
	instance: ConnectedInstance,
): instance is ConnectedInstance & LinePositioned {
	return typeof Reflect.get(instance, "getLinePosition") === "function";
}

function isMetricsAware(instance: ConnectedInstance): instance is ConnectedInstance & MetricsAware {
	return typeof Reflect.get(instance, "setMetrics") === "function";
}

export class PierreVirtualizer extends Virtualizer {
	private connected: { container: HTMLElement; instance: LinePositioned } | undefined;
	private readonly instances = new Map<HTMLElement, ConnectedInstance>();
	private metrics: VirtualFileMetrics | undefined;

	override connect(container: HTMLElement, instance: ConnectedInstance): () => void {
		this.instances.set(container, instance);
		if (isLinePositioned(instance)) this.connected = { container, instance };
		return super.connect(container, instance);
	}

	override disconnect(container: HTMLElement): void {
		this.instances.delete(container);
		if (this.connected?.container === container) this.connected = undefined;
		super.disconnect(container);
	}

	override cleanUp(): void {
		this.instances.clear();
		this.connected = undefined;
		super.cleanUp();
	}

	setMetrics(metrics: VirtualFileMetrics): void {
		const previous = this.metrics;
		this.metrics = metrics;
		if (previous === undefined || previous.lineHeight === metrics.lineHeight) return;
		for (const instance of this.instances.values()) {
			if (!isMetricsAware(instance)) continue;
			instance.setMetrics(metrics);
			this.instanceChanged(instance, true);
		}
	}

	revealLine(
		lineNumber: number,
		side?: AnnotationSide,
		block: "center" | "nearest" = "center",
	): boolean {
		const root = this.getRoot();
		const connected = this.connected;
		if (!(root instanceof HTMLElement) || !connected) return false;
		const position = connected.instance.getLinePosition(lineNumber, side);
		if (!position) return false;
		const top = this.getOffsetInScrollContainer(connected.container) + position.top;
		if (block === "center") {
			this.scrollTo({ top: top - root.clientHeight / 2, behavior: "instant" });
		} else {
			const lineHeight = this.metrics?.lineHeight ?? 0;
			const margin = lineHeight * NEAREST_MARGIN_LINES;
			const bottom = top + lineHeight + margin;
			if (top - margin < root.scrollTop) {
				this.scrollTo({ top: top - margin, behavior: "instant" });
			} else if (bottom > root.scrollTop + root.clientHeight) {
				this.scrollTo({ top: bottom - root.clientHeight, behavior: "instant" });
			}
		}
		return top >= root.scrollTop && top < root.scrollTop + root.clientHeight;
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

export type AttachPierreScroller<T extends HTMLElement> = (
	node: T | null,
	content?: HTMLElement,
) => void;

export function usePierreVirtualizer<T extends HTMLElement>(
	attachScroller: RefCallback<T>,
): {
	virtualizer: PierreVirtualizer;
	metrics: VirtualFileMetrics;
	attach: AttachPierreScroller<T>;
} {
	const [virtualizer] = useState(() => new PierreVirtualizer({ overscrollSize: OVERSCROLL_SIZE }));
	const lineHeight = useSyncExternalStore(onFontsChange, codeLineHeight);
	const metrics = useMemo<VirtualFileMetrics>(
		() => ({ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight, hunkLineCount: HUNK_LINE_COUNT }),
		[lineHeight],
	);
	useEffect(() => virtualizer.setMetrics(metrics), [virtualizer, metrics]);
	const attach = useCallback<AttachPierreScroller<T>>(
		(node, content) => {
			if (node) virtualizer.setup(node, content);
			else virtualizer.cleanUp();
			attachScroller(node);
		},
		[attachScroller, virtualizer],
	);
	return { virtualizer, metrics, attach };
}
