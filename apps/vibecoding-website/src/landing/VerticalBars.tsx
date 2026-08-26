import { useCallback, useEffect, useRef } from "react";

interface VerticalBarsProps {
	backgroundColor?: string;
	lineColor?: string;
	barColor?: string;
	lineWidth?: number;
	animationSpeed?: number;
	pixelSize?: number;
	gridGap?: number;
	className?: string;
}

const noise = (x: number, y: number, t: number): number => {
	const n =
		Math.sin(x * 0.01 + t) * Math.cos(y * 0.01 + t) +
		Math.sin(x * 0.015 - t) * Math.cos(y * 0.005 + t);
	return (n + 1) / 2;
};

export function VerticalBars({
	backgroundColor = "var(--container-workspace-bg)",
	lineColor = "var(--text-muted)",
	barColor = "var(--text-disabled)",
	lineWidth = 0.5,
	animationSpeed = 0.0005,
	pixelSize = 2,
	gridGap = 5,
	className,
}: VerticalBarsProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const timeRef = useRef(0);
	const rafRef = useRef<number | null>(null);
	const animationEnabledRef = useRef(false);
	const mouseRef = useRef({ x: -9999, y: -9999, isDown: false });
	const ripples = useRef<Array<{ x: number; y: number; time: number; intensity: number }>>([]);

	const resolve = (canvas: HTMLCanvasElement, value: string) => {
		const match = value.match(/var\((--[^)]+)\)/);
		const name = match?.[1];
		if (!name) return value;
		return getComputedStyle(canvas).getPropertyValue(name).trim() || value;
	};

	const resizeCanvas = useCallback(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;
		const dpr = window.devicePixelRatio || 1;
		const w = parent.clientWidth;
		const h = parent.clientHeight;
		canvas.width = Math.max(1, Math.floor(w * dpr));
		canvas.height = Math.max(1, Math.floor(h * dpr));
		canvas.style.width = `${w}px`;
		canvas.style.height = `${h}px`;
		const ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(dpr, dpr);
		}
	}, []);

	const getMouseInfluence = (x: number, y: number) => {
		const dx = x - mouseRef.current.x;
		const dy = y - mouseRef.current.y;
		return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 200);
	};

	const getRippleInfluence = (x: number, y: number, now: number) => {
		let total = 0;
		for (const ripple of ripples.current) {
			const age = now - ripple.time;
			if (age >= 2000) continue;
			const dx = x - ripple.x;
			const dy = y - ripple.y;
			const distance = Math.sqrt(dx * dx + dy * dy);
			const radius = (age / 2000) * 300;
			if (Math.abs(distance - radius) < 50) {
				total += (1 - age / 2000) * ripple.intensity * (1 - Math.abs(distance - radius) / 50);
			}
		}
		return Math.min(total, 2);
	};

	const animate = useCallback(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		timeRef.current += animationSpeed;
		const now = Date.now();
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;

		const bg = resolve(canvas, backgroundColor);
		const line = resolve(canvas, lineColor);
		const bar = resolve(canvas, barColor);

		const step = pixelSize + gridGap;
		const snap = (v: number) => Math.round(v / pixelSize) * pixelSize;
		const numLines = Math.max(1, Math.floor(h / step));
		const lineSpacing = h / numLines;

		ctx.globalAlpha = 1;
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);

		for (let i = 0; i < numLines; i++) {
			const y = snap(i * lineSpacing + lineSpacing / 2);
			const mouseInfluence = getMouseInfluence(w / 2, y);

			ctx.globalAlpha = Math.max(0.3, 0.3 + mouseInfluence * 0.35);
			ctx.strokeStyle = line;
			ctx.lineWidth = lineWidth;
			ctx.beginPath();
			ctx.moveTo(0, y + 0.5);
			ctx.lineTo(w, y + 0.5);
			ctx.stroke();

			for (let x = 0; x < w; x += step) {
				const noiseVal = noise(x, y, timeRef.current);
				const mouseInfl = getMouseInfluence(x, y);
				const rippleInfl = getRippleInfluence(x, y, now);
				const totalInfluence = mouseInfl + rippleInfl;
				const threshold = Math.max(0.2, 0.5 - mouseInfl * 0.2 - Math.abs(rippleInfl) * 0.1);
				if (noiseVal <= threshold) continue;

				const baseAnimation = Math.sin(timeRef.current + y * 0.0375) * 20 * noiseVal;
				const mouseAnimation = mouseRef.current.isDown
					? Math.sin(timeRef.current * 3 + x * 0.01) * 10 * mouseInfl
					: 0;
				const rippleAnimation = rippleInfl * Math.sin(timeRef.current * 2 + x * 0.02) * 15;
				const animatedX = snap(x + baseAnimation + mouseAnimation + rippleAnimation);

				const run = 1 + Math.floor(noiseVal * 3 + totalInfluence);

				ctx.globalAlpha = Math.min(1, Math.max(0.7, 0.7 + totalInfluence * 0.3));
				ctx.fillStyle = bar;
				for (let p = 0; p < run; p++) {
					ctx.fillRect(animatedX + p * pixelSize, y - pixelSize, pixelSize, pixelSize);
				}
			}
		}

		ctx.globalAlpha = 1;
		rafRef.current = animationEnabledRef.current ? requestAnimationFrame(animate) : null;
	}, [animationSpeed, backgroundColor, barColor, lineColor, lineWidth, pixelSize, gridGap]);

	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;

		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		const syncAnimation = () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			animationEnabledRef.current = !motion.matches && !document.hidden;
			if (!document.hidden) animate();
		};
		const resize = () => {
			resizeCanvas();
			if (!animationEnabledRef.current && !document.hidden) animate();
		};

		resizeCanvas();
		const observer = new ResizeObserver(resize);
		observer.observe(parent);

		const onMove = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			mouseRef.current.x = e.clientX - rect.left;
			mouseRef.current.y = e.clientY - rect.top;
		};
		const onDown = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			mouseRef.current.isDown = true;
			ripples.current.push({
				x: e.clientX - rect.left,
				y: e.clientY - rect.top,
				time: Date.now(),
				intensity: 1.5,
			});
			const now = Date.now();
			ripples.current = ripples.current.filter((r) => now - r.time < 2000);
		};
		const onUp = () => {
			mouseRef.current.isDown = false;
		};

		parent.addEventListener("mousemove", onMove);
		parent.addEventListener("mousedown", onDown);
		window.addEventListener("mouseup", onUp);
		document.addEventListener("visibilitychange", syncAnimation);
		motion.addEventListener("change", syncAnimation);
		syncAnimation();

		return () => {
			observer.disconnect();
			parent.removeEventListener("mousemove", onMove);
			parent.removeEventListener("mousedown", onDown);
			window.removeEventListener("mouseup", onUp);
			document.removeEventListener("visibilitychange", syncAnimation);
			motion.removeEventListener("change", syncAnimation);
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			animationEnabledRef.current = false;
			ripples.current = [];
		};
	}, [animate, resizeCanvas]);

	return (
		<div className={className} aria-hidden="true">
			<canvas ref={canvasRef} className="block h-full w-full" />
		</div>
	);
}
