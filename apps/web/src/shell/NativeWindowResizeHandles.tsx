import type { NativeResizeEdge, NativeWindowChromeAdapter } from "../nativeWindowChrome";

const handleClass: Record<NativeResizeEdge, string> = {
	"north-west": "fixed left-0 top-0 z-[51] size-16 cursor-nw-resize",
	north: "fixed left-16 right-16 top-0 z-50 h-12 cursor-n-resize",
	"north-east": "fixed right-0 top-0 z-[51] size-16 cursor-ne-resize",
	west: "fixed bottom-16 left-0 top-16 z-50 w-12 cursor-w-resize",
	east: "fixed bottom-16 right-0 top-16 z-50 w-12 cursor-e-resize",
	"south-west": "fixed bottom-0 left-0 z-[51] size-16 cursor-sw-resize",
	south: "fixed bottom-0 left-16 right-16 z-50 h-12 cursor-s-resize",
	"south-east": "fixed bottom-0 right-0 z-[51] size-16 cursor-se-resize",
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
