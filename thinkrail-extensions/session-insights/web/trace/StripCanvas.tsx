import { cn } from "@thinkrail/ui/utils";
import { useEffect, useRef, useState } from "react";

export type StripDraw = (context: CanvasRenderingContext2D, width: number, height: number) => void;

/** A small decorative canvas sized to its box, redrawn whenever `draw` or the box changes. */
export function StripCanvas({
	draw,
	className,
	testId,
	fill = false,
}: {
	draw: StripDraw | null;
	className: string;
	testId?: string;
	/** Fill a box sized by its layout (a grid cell) instead of sizing it: the canvas adds no height. */
	fill?: boolean;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const measure = () => setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas || !draw || size.width <= 0 || size.height <= 0) return;
		const ratio = window.devicePixelRatio || 1;
		const width = Math.round(size.width * ratio);
		const height = Math.round(size.height * ratio);
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		draw(context, size.width, size.height);
	}, [draw, size]);
	return (
		<div aria-hidden="true" className={cn(fill && "relative", className)}>
			<canvas
				ref={ref}
				data-testid={testId}
				className={fill ? "absolute inset-0 size-full" : "block size-full"}
			/>
		</div>
	);
}
