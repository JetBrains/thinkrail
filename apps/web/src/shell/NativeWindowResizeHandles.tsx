import type { NativeResizeEdge, NativeWindowChromeAdapter } from "../nativeWindowChrome";

const handleClass: Record<NativeResizeEdge, string> = {
	"north-west": "fixed left-0 top-0 z-50 size-12 cursor-nw-resize",
	north: "fixed left-12 right-12 top-0 z-50 h-8 cursor-n-resize",
	"north-east": "fixed right-0 top-0 z-50 size-12 cursor-ne-resize",
	west: "fixed bottom-12 left-0 top-12 z-50 w-8 cursor-w-resize",
	east: "fixed bottom-12 right-0 top-12 z-50 w-8 cursor-e-resize",
	"south-west": "fixed bottom-0 left-0 z-50 size-12 cursor-sw-resize",
	south: "fixed bottom-0 left-12 right-12 z-50 h-8 cursor-s-resize",
	"south-east": "fixed bottom-0 right-0 z-50 size-12 cursor-se-resize",
};

const edges = Object.keys(handleClass) as NativeResizeEdge[];

export function NativeWindowResizeHandles({
	adapter,
	maximized,
}: {
	adapter: NativeWindowChromeAdapter;
	maximized: boolean;
}) {
	if (adapter.platform === "macos" || maximized) return null;
	return edges.map((edge) => (
		<div
			key={edge}
			aria-hidden="true"
			data-testid="native-resize-handle"
			data-edge={edge}
			className={handleClass[edge]}
			onMouseDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				adapter.startResize(edge);
			}}
		/>
	));
}
