import type { NativeResizeEdge, NativeWindowChromeAdapter } from "../nativeWindowChrome";

const handleClass: Record<NativeResizeEdge, string> = {
	"north-west": "fixed left-0 top-0 z-[60] size-16 cursor-nw-resize",
	north: "fixed left-12 right-12 top-0 z-50 h-8 cursor-n-resize",
	"north-east": "fixed right-0 top-0 z-[60] size-16 cursor-ne-resize",
	west: "fixed bottom-12 left-0 top-12 z-50 w-8 cursor-w-resize",
	east: "fixed bottom-12 right-0 top-12 z-50 w-8 cursor-e-resize",
	"south-west": "fixed bottom-0 left-0 z-[60] size-16 cursor-sw-resize",
	south: "fixed bottom-0 left-12 right-12 z-50 h-8 cursor-s-resize",
	"south-east": "fixed bottom-0 right-0 z-[60] size-16 cursor-se-resize",
};

const edges = Object.keys(handleClass) as NativeResizeEdge[];

function ResizeHandle({
	edge,
	className,
	onStart,
}: {
	edge: NativeResizeEdge;
	className: string;
	onStart(edge: NativeResizeEdge): void;
}) {
	return (
		<div
			aria-hidden="true"
			data-testid="native-resize-handle"
			data-edge={edge}
			className={`electrobun-webkit-app-region-no-drag ${className}`}
			onMouseDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				onStart(edge);
			}}
		/>
	);
}

export function NativeWindowResizeHandles({
	adapter,
	maximized,
}: {
	adapter: NativeWindowChromeAdapter;
	maximized: boolean;
}) {
	if (adapter.platform === "macos" || maximized) return null;
	if (adapter.platform === "windows") {
		return (
			<ResizeHandle
				edge="north"
				className="fixed left-16 right-[calc(var(--space-64)+var(--space-40)+var(--space-16))] top-12 z-50 h-8 cursor-n-resize"
				onStart={adapter.startResize}
			/>
		);
	}
	return edges.map((edge) => (
		<ResizeHandle
			key={edge}
			edge={edge}
			className={handleClass[edge]}
			onStart={adapter.startResize}
		/>
	));
}
