import type { NativeResizeEdge, NativeWindowChromeAdapter } from "../nativeWindowChrome";

const handleClass: Record<NativeResizeEdge, string> = {
	"north-west": "fixed left-0 top-0 z-50 size-8 cursor-nw-resize",
	north: "fixed left-8 right-8 top-0 z-50 h-4 cursor-n-resize",
	"north-east": "fixed right-0 top-0 z-50 size-8 cursor-ne-resize",
	west: "fixed bottom-8 left-0 top-8 z-50 w-4 cursor-w-resize",
	east: "fixed bottom-8 right-0 top-8 z-50 w-4 cursor-e-resize",
	"south-west": "fixed bottom-0 left-0 z-50 size-8 cursor-sw-resize",
	south: "fixed bottom-0 left-8 right-8 z-50 h-4 cursor-s-resize",
	"south-east": "fixed bottom-0 right-0 z-50 size-8 cursor-se-resize",
};

const edges = Object.keys(handleClass) as NativeResizeEdge[];

export function NativeWindowResizeHandles({
	adapter,
	maximized,
}: {
	adapter: NativeWindowChromeAdapter;
	maximized: boolean;
}) {
	if (adapter.platform !== "linux" || maximized) return null;
	return edges.map((edge) => (
		<div
			key={edge}
			aria-hidden="true"
			data-testid="native-resize-handle"
			data-edge={edge}
			className={handleClass[edge]}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				adapter.startResize(edge);
			}}
		/>
	));
}
