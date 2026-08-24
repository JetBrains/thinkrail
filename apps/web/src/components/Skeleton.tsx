const ROWS = [
	{ key: "r1", width: "w-3/4" },
	{ key: "r2", width: "w-1/2" },
	{ key: "r3", width: "w-5/6" },
	{ key: "r4", width: "w-2/3" },
	{ key: "r5", width: "w-4/5" },
	{ key: "r6", width: "w-3/5" },
	{ key: "r7", width: "w-2/5" },
	{ key: "r8", width: "w-11/12" },
	{ key: "r9", width: "w-2/3" },
	{ key: "r10", width: "w-1/2" },
	{ key: "r11", width: "w-4/5" },
	{ key: "r12", width: "w-3/4" },
] as const;

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
	return (
		<div
			role="status"
			aria-label="Loading"
			aria-busy="true"
			data-testid="skeleton-rows"
			className="flex flex-col gap-sm"
		>
			{ROWS.slice(0, Math.min(rows, ROWS.length)).map(({ key, width }) => (
				<span
					key={key}
					className={`h-3 animate-pulse rounded-[var(--radius-sm)] bg-control-bg-hovered ${width}`}
				/>
			))}
		</div>
	);
}
